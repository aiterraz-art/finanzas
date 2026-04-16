import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Check,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  buildObjectsFromWorksheetRows,
  canEditTreasury,
  detectWorksheetImportFormat,
  formatTreasuryCurrency,
  formatTreasuryDate,
  normalizeBankImportRow,
} from "@/lib/treasury";
import { useBankAccountPositions, useBankAccounts, useTreasuryCategories } from "@/hooks/useTreasury";
import { cn } from "@/lib/utils";
import type { TreasuryPriority } from "@/lib/treasury";

type BankMovement = {
  id: string;
  fecha_movimiento: string;
  descripcion: string;
  monto: number;
  saldo: number | null;
  estado: string;
  numero_documento: string | null;
  comentario_tesoreria: string | null;
  tipo_conciliacion: string | null;
  bank_account_id: string | null;
  source_hash: string | null;
  columnas_extra: Record<string, string | number | null> | null;
  facturas_pagos?: Array<{
    id: string;
    factura_id: string | null;
    rendicion_id: string | null;
    monto_aplicado: number;
    estado: string;
    facturas?: { numero_documento: string | null; tercero_nombre: string | null }[] | null;
    rendiciones?: { descripcion: string | null; tercero_nombre: string | null }[] | null;
  }>;
  cheques_cartera?: Array<{
    id: string;
    numero_cheque: string;
    librador: string;
    monto: number;
  }>;
  webpay_liquidaciones?: Array<{
    id: string;
    orden_compra: string;
    monto_neto: number;
    facturas?: { numero_documento: string | null }[] | null;
    terceros?: { razon_social: string | null }[] | null;
  }>;
  cash_commitments?: Array<{
    id: string;
    description: string;
    counterparty: string | null;
    amount: number;
    status: string;
    source_type: string;
    archived_at: string | null;
    estado_previo_conciliacion: string | null;
  }>;
};

type MatchCandidate = {
  id: string;
  type: "factura" | "rendicion" | "cheque" | "webpay" | "commitment";
  label: string;
  subtitle: string;
  amount: number;
  dueDate: string | null;
  status?: string | null;
  invoiceNumber?: string | null;
  customerName?: string | null;
};

type ImportSummary = {
  inserted: number;
  duplicates: number;
  rejected: number;
  periodFrom: string | null;
  periodTo: string | null;
  filename: string;
};

const HASH_QUERY_CHUNK = 20;
const INSERT_CHUNK_SIZE = 200;
type InflowMatchSource = "factura" | "cheque" | "webpay";

type QuickExpenseForm = {
  description: string;
  counterparty: string;
  categoryId: string;
  priority: TreasuryPriority;
  notes: string;
  isRecurring: boolean;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
};

const addFrequencyStep = (baseDate: string, frequency: QuickExpenseForm["frequency"]) => {
  const next = new Date(`${baseDate}T12:00:00`);
  if (Number.isNaN(next.getTime())) return baseDate;
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  if (frequency === "biweekly") next.setDate(next.getDate() + 14);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  if (frequency === "quarterly") next.setMonth(next.getMonth() + 3);
  if (frequency === "annual") next.setFullYear(next.getFullYear() + 1);
  return next.toISOString().split("T")[0];
};

export default function BankReconciliation() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [transactions, setTransactions] = useState<BankMovement[]>([]);
  const [latestImport, setLatestImport] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unmatched" | "matched">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [selectedTxn, setSelectedTxn] = useState<BankMovement | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [selectedInflowSource, setSelectedInflowSource] = useState<InflowMatchSource>("factura");
  const [candidateSearchTerm, setCandidateSearchTerm] = useState("");
  const [selectedInvoiceMatches, setSelectedInvoiceMatches] = useState<Record<string, { mode: "full" | "partial"; amount: string }>>({});
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [quickExpenseForm, setQuickExpenseForm] = useState<QuickExpenseForm>({
    description: "",
    counterparty: "",
    categoryId: "",
    priority: "normal",
    notes: "",
    isRecurring: false,
    frequency: "monthly",
  });
  const [savingQuickExpense, setSavingQuickExpense] = useState(false);

  const { data: bankAccounts, refresh: refreshBankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: bankPositions, refresh: refreshPositions } = useBankAccountPositions(selectedEmpresaId);
  const { data: categories } = useTreasuryCategories(selectedEmpresaId);

  const selectedAccount = bankAccounts.find((account) => account.id === selectedAccountId) || null;
  const selectedPosition = bankPositions.find((position) => position.bankAccountId === selectedAccountId) || null;
  const outflowCategories = useMemo(
    () => categories.filter((category) => category.active && category.directionScope !== "inflow"),
    [categories]
  );

  useEffect(() => {
    if (!selectedAccountId && bankAccounts.length > 0) {
      setSelectedAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, selectedAccountId]);

  useEffect(() => {
    if (selectedEmpresaId && selectedAccountId) {
      void fetchTransactions();
      void fetchLatestImport();
    } else {
      setTransactions([]);
      setLatestImport(null);
    }
  }, [selectedEmpresaId, selectedAccountId]);

  useEffect(() => {
    if (!selectedTxn || selectedTxn.monto >= 0) return;
    setQuickExpenseForm({
      description: selectedTxn.descripcion || "",
      counterparty: "",
      categoryId: "",
      priority: "normal",
      notes: "",
      isRecurring: false,
      frequency: "monthly",
    });
  }, [selectedTxn]);

  useEffect(() => {
    if (!selectedTxn || selectedTxn.monto < 0 || selectedInflowSource !== "factura") {
      setCandidateSearchTerm("");
      setSelectedInvoiceMatches({});
    }
  }, [selectedInflowSource, selectedTxn]);

  const syncInvoiceStatuses = async (invoiceIds: string[]) => {
    if (!selectedEmpresaId || invoiceIds.length === 0) return;

    const uniqueIds = Array.from(new Set(invoiceIds));
    const [{ data: invoices, error: invoicesError }, { data: payments, error: paymentsError }] = await Promise.all([
      supabase
        .from("facturas")
        .select("id, monto, fecha_vencimiento")
        .eq("empresa_id", selectedEmpresaId)
        .in("id", uniqueIds),
      supabase
        .from("facturas_pagos")
        .select("factura_id, monto_aplicado")
        .eq("empresa_id", selectedEmpresaId)
        .in("factura_id", uniqueIds)
        .eq("estado", "aplicado"),
    ]);
    if (invoicesError) throw invoicesError;
    if (paymentsError) throw paymentsError;

    const appliedByInvoice = new Map<string, number>();
    for (const payment of payments || []) {
      const facturaId = payment.factura_id as string | null;
      if (!facturaId) continue;
      appliedByInvoice.set(facturaId, (appliedByInvoice.get(facturaId) || 0) + Number(payment.monto_aplicado || 0));
    }

    for (const invoice of invoices || []) {
      const totalAmount = Number(invoice.monto || 0);
      const appliedAmount = appliedByInvoice.get(invoice.id) || 0;
      const dueDate = invoice.fecha_vencimiento || null;
      const isOverdue = Boolean(dueDate && dueDate < new Date().toISOString().split("T")[0]);
      const nextStatus =
        appliedAmount >= totalAmount - 0.01
          ? "pagada"
          : appliedAmount > 0
            ? "abonada"
            : isOverdue
              ? "morosa"
              : "pendiente";

      const { error: updateError } = await supabase
        .from("facturas")
        .update({ estado: nextStatus })
        .eq("id", invoice.id)
        .eq("empresa_id", selectedEmpresaId);
      if (updateError) throw updateError;
    }
  };

  const fetchTransactions = async () => {
    if (!selectedEmpresaId || !selectedAccountId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("movimientos_banco")
        .select(`
          id,
          fecha_movimiento,
          descripcion,
          monto,
          saldo,
          estado,
          numero_documento,
          comentario_tesoreria,
          tipo_conciliacion,
          bank_account_id,
          source_hash,
          columnas_extra,
          facturas_pagos (
            id,
            factura_id,
            rendicion_id,
            monto_aplicado,
            estado,
            facturas (numero_documento, tercero_nombre),
            rendiciones (descripcion, tercero_nombre)
          ),
          cheques_cartera (
            id,
            numero_cheque,
            librador,
            monto
          ),
          webpay_liquidaciones (
            id,
            orden_compra,
            monto_neto,
            facturas (numero_documento),
            terceros (razon_social)
          ),
          cash_commitments (
            id,
            description,
            counterparty,
            amount,
            status,
            source_type,
            archived_at,
            estado_previo_conciliacion
          )
        `)
        .eq("empresa_id", selectedEmpresaId)
        .eq("bank_account_id", selectedAccountId)
        .order("fecha_movimiento", { ascending: false })
        .order("id_secuencial", { ascending: false });
      if (error) throw error;
      setTransactions((data || []) as BankMovement[]);
    } catch (error) {
      console.error("Error loading bank movements:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLatestImport = async () => {
    if (!selectedEmpresaId || !selectedAccountId) return;
    try {
      const { data, error } = await supabase
        .from("bank_statement_imports")
        .select("*")
        .eq("empresa_id", selectedEmpresaId)
        .eq("bank_account_id", selectedAccountId)
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setLatestImport(data || null);
    } catch (error) {
      console.error("Error loading latest import:", error);
    }
  };

  const fetchCandidates = async (txn: BankMovement) => {
    if (!selectedEmpresaId) return;
    setSelectedTxn(txn);
    setSelectedInflowSource("factura");
    setCandidateSearchTerm("");
    setSelectedInvoiceMatches({});
    setLoadingCandidates(true);
    try {
      const absAmount = Math.abs(txn.monto);

      const invoiceQuery = txn.monto >= 0
        ? supabase
            .from("facturas")
            .select("id, numero_documento, tercero_nombre, monto, fecha_vencimiento, estado, facturas_pagos(monto_aplicado, estado)")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "venta")
            .in("estado", ["pendiente", "morosa", "abonada", "pagada"])
        : supabase
            .from("facturas")
            .select("id, numero_documento, tercero_nombre, monto, fecha_vencimiento")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "compra")
            .in("estado", ["pendiente", "morosa"]);

      const [
        { data: invoices, error: invoiceError },
        { data: rendiciones, error: rendicionError },
        { data: cheques, error: chequesError },
        { data: webpayRows, error: webpayError },
        { data: commitments, error: commitmentsError },
      ] =
        await Promise.all([
          invoiceQuery.order("fecha_vencimiento", { ascending: true }),
          txn.monto < 0
            ? supabase
                .from("rendiciones")
                .select("id, descripcion, tercero_nombre, monto_total, fecha")
                .eq("empresa_id", selectedEmpresaId)
                .eq("estado", "pendiente")
                .order("fecha", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          txn.monto >= 0
            ? supabase
                .from("cheques_cartera")
                .select("id, numero_cheque, librador, monto, fecha_cobro_esperada, estado")
                .eq("empresa_id", selectedEmpresaId)
                .in("estado", ["en_cartera", "depositado"])
                .order("fecha_cobro_esperada", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          txn.monto >= 0
            ? supabase
                .from("webpay_liquidaciones")
                .select("id, orden_compra, monto_neto, fecha_abono_esperada, terceros(razon_social), facturas(numero_documento)")
                .eq("empresa_id", selectedEmpresaId)
                .eq("estado", "pendiente")
                .order("fecha_abono_esperada", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          txn.monto < 0
            ? supabase
                .from("cash_commitments")
                .select("id, description, counterparty, amount, expected_date, status, bank_account_id, notes")
                .eq("empresa_id", selectedEmpresaId)
                .eq("direction", "outflow")
                .in("status", ["planned", "confirmed", "deferred"])
                .is("archived_at", null)
                .or(`bank_account_id.eq.${selectedAccountId},bank_account_id.is.null`)
                .order("expected_date", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        ]);

      if (invoiceError) throw invoiceError;
      if (rendicionError) throw rendicionError;
      if (chequesError) throw chequesError;
      if (webpayError) throw webpayError;
      if (commitmentsError) throw commitmentsError;

      const nextCandidates: MatchCandidate[] = [
        ...(invoices || []).map((invoice: any) => ({
          id: invoice.id,
          type: "factura" as const,
          label: `${invoice.tercero_nombre || "Sin tercero"} • ${invoice.numero_documento || "Sin folio"}`,
          subtitle: invoice.estado === "pagada" ? "Factura pagada (vincular histórico)" : "Factura abierta",
          amount: Math.max(
            Number(invoice.monto || 0) -
              ((invoice.facturas_pagos || []) as any[])
                .filter((payment) => payment.estado === "aplicado")
                .reduce((sum, payment) => sum + Number(payment.monto_aplicado || 0), 0),
            0
          ),
          dueDate: invoice.fecha_vencimiento || null,
          invoiceNumber: invoice.numero_documento || null,
          customerName: invoice.tercero_nombre || null,
          status: invoice.estado || null,
        })),
        ...((rendiciones || []) as any[]).map((rendicion) => ({
          id: rendicion.id,
          type: "rendicion" as const,
          label: `${rendicion.tercero_nombre || "Sin responsable"} • ${rendicion.descripcion || "Rendición"}`,
          subtitle: "Rendición pendiente",
          amount: Number(rendicion.monto_total),
          dueDate: rendicion.fecha || null,
        })),
        ...((cheques || []) as any[]).map((cheque) => ({
          id: cheque.id,
          type: "cheque" as const,
          label: `${cheque.librador || "Sin librador"} • cheque ${cheque.numero_cheque || "S/N"}`,
          subtitle: "Cheque en cartera",
          amount: Number(cheque.monto),
          dueDate: cheque.fecha_cobro_esperada || null,
        })),
        ...((webpayRows || []) as any[]).map((row) => {
          const client = Array.isArray(row.terceros) ? row.terceros[0] : row.terceros;
          const invoice = Array.isArray(row.facturas) ? row.facturas[0] : row.facturas;
          return {
            id: row.id,
            type: "webpay" as const,
            label: `${client?.razon_social || invoice?.numero_documento || "WebPay"} • orden ${row.orden_compra || "S/N"}`,
            subtitle: "WebPay por recibir",
            amount: Number(row.monto_neto),
            dueDate: row.fecha_abono_esperada || null,
          };
        }),
        ...((commitments || []) as any[]).map((commitment) => ({
          id: commitment.id,
          type: "commitment" as const,
          label: `${commitment.counterparty || "Sin contraparte"} • ${commitment.description || "Compromiso"}`,
          subtitle: "Egreso manual / compromiso",
          amount: Number(commitment.amount),
          dueDate: commitment.expected_date || null,
          status: commitment.status || null,
        })),
      ].sort((a, b) => Math.abs(absAmount - a.amount) - Math.abs(absAmount - b.amount));

      setCandidates(
        nextCandidates.filter(
          (candidate) =>
            candidate.type !== "factura" ||
            candidate.amount > 0 ||
            candidate.status === "pagada"
        )
      );
    } catch (error) {
      console.error("Error fetching reconciliation candidates:", error);
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleMatch = async (candidate: MatchCandidate) => {
    if (!selectedEmpresaId || !selectedTxn) return;
    setMatchingId(candidate.id);
    try {
      if (candidate.type === "factura" || candidate.type === "rendicion") {
        const payload = {
          empresa_id: selectedEmpresaId,
          factura_id: candidate.type === "factura" ? candidate.id : null,
          rendicion_id: candidate.type === "rendicion" ? candidate.id : null,
          movimiento_banco_id: selectedTxn.id,
          monto_aplicado: Math.min(Math.abs(selectedTxn.monto), candidate.amount),
          estado: "aplicado",
        };
        const { error: paymentError } = await supabase.from("facturas_pagos").insert(payload);
        if (paymentError) throw paymentError;
      }

      const { error: movementError } = await supabase
        .from("movimientos_banco")
        .update({
          estado: "conciliado",
          tipo_conciliacion:
            candidate.type === "rendicion"
              ? "rendicion"
              : candidate.type === "cheque"
                ? "cheque"
                : candidate.type === "webpay"
                  ? "webpay"
                  : candidate.type === "commitment"
                    ? "commitment"
                  : "factura",
          numero_documento:
            candidate.type === "cheque" || candidate.type === "webpay" || candidate.type === "commitment"
              ? candidate.label
              : candidate.type === "factura"
                ? candidate.label
                : selectedTxn.numero_documento,
        })
        .eq("id", selectedTxn.id)
        .eq("empresa_id", selectedEmpresaId);
      if (movementError) throw movementError;

      if (candidate.type === "factura") {
        await syncInvoiceStatuses([candidate.id]);
      } else if (candidate.type === "rendicion") {
        const { error } = await supabase
          .from("rendiciones")
          .update({ estado: "pagado" })
          .eq("id", candidate.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      } else if (candidate.type === "cheque") {
        const { error } = await supabase
          .from("cheques_cartera")
          .update({
            estado: "cobrado",
            fecha_cobro_real: selectedTxn.fecha_movimiento,
            movimiento_banco_id: selectedTxn.id,
          })
          .eq("id", candidate.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      } else if (candidate.type === "webpay") {
        const { error } = await supabase
          .from("webpay_liquidaciones")
          .update({
            estado: "conciliado",
            fecha_abono_real: selectedTxn.fecha_movimiento,
            movimiento_banco_id: selectedTxn.id,
          })
          .eq("id", candidate.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      } else if (candidate.type === "commitment") {
        const { error } = await supabase
          .from("cash_commitments")
          .update({
            status: "paid",
            estado_previo_conciliacion: candidate.status || "planned",
            movimiento_banco_id: selectedTxn.id,
          })
          .eq("id", candidate.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      setSelectedTxn(null);
      setCandidates([]);
      await fetchTransactions();
      await refreshPositions();
    } catch (error: any) {
      console.error("Error matching transaction:", error);
      alert(`No se pudo conciliar el movimiento: ${error.message}`);
    } finally {
      setMatchingId(null);
    }
  };

  const handleUndoMatch = async (txn: BankMovement) => {
    if (!selectedEmpresaId) return;
    const payments = (txn.facturas_pagos || []).filter((payment) => payment.estado !== "revertido");
    const linkedCheque = txn.cheques_cartera?.[0];
    const linkedWebpay = txn.webpay_liquidaciones?.[0];
    const linkedCommitment = txn.cash_commitments?.[0];
    if (payments.length === 0 && !linkedCheque && !linkedWebpay && !linkedCommitment) return;

    try {
      const facturaIds = payments.map((payment) => payment.factura_id).filter(Boolean) as string[];
      const rendicionIds = payments.map((payment) => payment.rendicion_id).filter(Boolean) as string[];

      if (payments.length > 0) {
        const { error: revertError } = await supabase
          .from("facturas_pagos")
          .update({
            estado: "revertido",
            reversed_at: new Date().toISOString(),
            reversed_by: user?.id ?? null,
            reversal_reason: "Conciliación revertida manualmente",
          })
          .eq("movimiento_banco_id", txn.id)
          .eq("empresa_id", selectedEmpresaId)
          .eq("estado", "aplicado");
        if (revertError) throw revertError;
      }

      const { error: movementError } = await supabase
        .from("movimientos_banco")
        .update({ estado: "no_conciliado", tipo_conciliacion: null })
        .eq("id", txn.id)
        .eq("empresa_id", selectedEmpresaId);
      if (movementError) throw movementError;

      if (linkedCheque) {
        const { error } = await supabase
          .from("cheques_cartera")
          .update({
            estado: "depositado",
            fecha_cobro_real: null,
            movimiento_banco_id: null,
          })
          .eq("id", linkedCheque.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      if (linkedWebpay) {
        const { error } = await supabase
          .from("webpay_liquidaciones")
          .update({
            estado: "pendiente",
            fecha_abono_real: null,
            movimiento_banco_id: null,
          })
          .eq("id", linkedWebpay.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      if (linkedCommitment) {
        const { error } = await supabase
          .from("cash_commitments")
          .update({
            status: linkedCommitment.estado_previo_conciliacion || "planned",
            estado_previo_conciliacion: null,
            movimiento_banco_id: null,
          })
          .eq("id", linkedCommitment.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      for (const facturaId of facturaIds) {
        await syncInvoiceStatuses([facturaId]);
      }

      for (const rendicionId of rendicionIds) {
        const { count } = await supabase
          .from("facturas_pagos")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", selectedEmpresaId)
          .eq("rendicion_id", rendicionId)
          .eq("estado", "aplicado");
        if ((count || 0) === 0) {
          await supabase.from("rendiciones").update({ estado: "pendiente" }).eq("id", rendicionId).eq("empresa_id", selectedEmpresaId);
        }
      }

      await fetchTransactions();
      await refreshPositions();
    } catch (error: any) {
      console.error("Error undoing reconciliation:", error);
      alert(`No se pudo deshacer la conciliación: ${error.message}`);
    }
  };

  const handleArchiveLinkedManualExpense = async (txn: BankMovement) => {
    if (!selectedEmpresaId || !canEdit || !user?.id) return;
    const linkedCommitment = txn.cash_commitments?.[0];
    if (!linkedCommitment || linkedCommitment.source_type !== "manual" || linkedCommitment.archived_at) return;

    const confirmed = window.confirm(
      "Se archivará el egreso manual y el movimiento quedará no conciliado. El registro histórico se conserva."
    );
    if (!confirmed) return;

    try {
      const { error: movementError } = await supabase
        .from("movimientos_banco")
        .update({ estado: "no_conciliado", tipo_conciliacion: null, numero_documento: null })
        .eq("id", txn.id)
        .eq("empresa_id", selectedEmpresaId);
      if (movementError) throw movementError;

      const { error: commitmentError } = await supabase
        .from("cash_commitments")
        .update({
          status: "cancelled",
          movimiento_banco_id: null,
          estado_previo_conciliacion: null,
          archived_at: new Date().toISOString(),
          archived_by: user.id,
          archive_reason: "Archivado desde conciliación bancaria",
        })
        .eq("id", linkedCommitment.id)
        .eq("empresa_id", selectedEmpresaId)
        .is("archived_at", null);
      if (commitmentError) throw commitmentError;

      await fetchTransactions();
      await refreshPositions();
    } catch (error: any) {
      console.error("Error archiving linked manual expense:", error);
      alert(`No se pudo archivar el egreso manual: ${error.message}`);
    }
  };

  const handleQuickExpenseMatch = async () => {
    if (!selectedEmpresaId || !selectedTxn || selectedTxn.monto >= 0 || !canEdit) return;
    if (!quickExpenseForm.description.trim() || !quickExpenseForm.categoryId) {
      alert("Descripción y categoría son obligatorias para la conciliación rápida.");
      return;
    }

    setSavingQuickExpense(true);
    try {
      const category = outflowCategories.find((item) => item.id === quickExpenseForm.categoryId) || null;
      const sourceType =
        category?.code === "taxes"
          ? "tax"
          : category?.code === "payroll"
            ? "payroll"
            : category?.code === "capex"
              ? "capex"
              : "manual";
      const templatePayload = quickExpenseForm.isRecurring
        ? {
            empresa_id: selectedEmpresaId,
            category_id: quickExpenseForm.categoryId,
            bank_account_id: selectedAccountId || null,
            obligation_type: sourceType === "tax" || sourceType === "payroll" || sourceType === "capex" ? sourceType : "recurring",
            description: quickExpenseForm.description.trim(),
            counterparty: quickExpenseForm.counterparty.trim() || null,
            frequency: quickExpenseForm.frequency,
            default_amount: Math.abs(selectedTxn.monto),
            requires_amount_confirmation: false,
            priority: quickExpenseForm.priority,
            active: true,
            next_due_date: addFrequencyStep(selectedTxn.fecha_movimiento, quickExpenseForm.frequency),
          }
        : null;

      let templateId: string | null = null;
      if (templatePayload) {
        const { data: createdTemplate, error: templateError } = await supabase
          .from("cash_commitment_templates")
          .insert(templatePayload)
          .select("id")
          .single();
        if (templateError) throw templateError;
        templateId = createdTemplate.id;
      }

      const commitmentLabel = quickExpenseForm.counterparty.trim() || quickExpenseForm.description.trim();
      const commitmentPayload = {
        template_id: templateId,
        bank_account_id: selectedAccountId || null,
        category_id: quickExpenseForm.categoryId,
        source_type: sourceType,
        source_reference: `bank-reconciliation:${selectedTxn.id}`,
        direction: "outflow" as const,
        counterparty: quickExpenseForm.counterparty.trim() || null,
        description: quickExpenseForm.description.trim(),
        amount: Math.abs(selectedTxn.monto),
        is_estimated: false,
        due_date: selectedTxn.fecha_movimiento,
        expected_date: selectedTxn.fecha_movimiento,
        priority: quickExpenseForm.priority,
        status: "paid" as const,
        notes: quickExpenseForm.notes.trim() || null,
        movimiento_banco_id: selectedTxn.id,
        archived_at: null,
        archived_by: null,
        archive_reason: null,
      };

      const { data: existingLinkedCommitment, error: existingLinkedCommitmentError } = await supabase
        .from("cash_commitments")
        .select("id")
        .eq("empresa_id", selectedEmpresaId)
        .eq("movimiento_banco_id", selectedTxn.id)
        .maybeSingle();
      if (existingLinkedCommitmentError) throw existingLinkedCommitmentError;

      let commitmentId: string;
      if (existingLinkedCommitment?.id) {
        const { error: updateCommitmentError } = await supabase
          .from("cash_commitments")
          .update(commitmentPayload)
          .eq("id", existingLinkedCommitment.id)
          .eq("empresa_id", selectedEmpresaId);
        if (updateCommitmentError) throw updateCommitmentError;
        commitmentId = existingLinkedCommitment.id;
      } else {
        const { data: createdCommitment, error: commitmentError } = await supabase
          .from("cash_commitments")
          .insert({
            empresa_id: selectedEmpresaId,
            ...commitmentPayload,
          })
          .select("id")
          .single();
        if (commitmentError) throw commitmentError;
        commitmentId = createdCommitment.id;
      }

      const { error: movementError } = await supabase
        .from("movimientos_banco")
        .update({
          estado: "conciliado",
          tipo_conciliacion: "commitment",
          numero_documento: commitmentLabel,
        })
        .eq("id", selectedTxn.id)
        .eq("empresa_id", selectedEmpresaId);
      if (movementError) {
        await supabase
          .from("cash_commitments")
          .update({ status: "cancelled", archived_at: new Date().toISOString(), archive_reason: "Rollback por error conciliando movimiento" })
          .eq("id", commitmentId)
          .eq("empresa_id", selectedEmpresaId);
        throw movementError;
      }

      setSelectedTxn(null);
      setCandidates([]);
      await fetchTransactions();
      await refreshPositions();
    } catch (error: any) {
      console.error("Error performing quick expense reconciliation:", error);
      alert(`No se pudo registrar la conciliación rápida: ${error.message}`);
    } finally {
      setSavingQuickExpense(false);
    }
  };

  const fetchExistingHashes = async (hashes: string[]) => {
    if (!selectedEmpresaId || !selectedAccountId || hashes.length === 0) return new Set<string>();
    const nextSet = new Set<string>();

    for (let index = 0; index < hashes.length; index += HASH_QUERY_CHUNK) {
      const slice = hashes.slice(index, index + HASH_QUERY_CHUNK);
      const { data, error } = await supabase
        .from("movimientos_banco")
        .select("source_hash")
        .eq("empresa_id", selectedEmpresaId)
        .eq("bank_account_id", selectedAccountId)
        .in("source_hash", slice);
      if (error) throw error;
      for (const row of data || []) {
        if (row.source_hash) nextSet.add(row.source_hash);
      }
    }

    return nextSet;
  };

  const insertBankMovementChunks = async (
    rowsToInsert: Array<{
      empresa_id: string;
      bank_account_id: string;
      import_id: string;
      fecha_movimiento: string;
      posted_at: string | null;
      descripcion: string;
      monto: number;
      entrada_banco: number;
      salida_banco: number;
      estado: string;
      saldo: number | null;
      n_operacion: string | null;
      sucursal: string | null;
      source_hash: string;
      columnas_extra: Record<string, string | number | null>;
    }>
  ) => {
    for (let index = 0; index < rowsToInsert.length; index += INSERT_CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(index, index + INSERT_CHUNK_SIZE);
      const { error } = await supabase.from("movimientos_banco").insert(chunk);
      if (error) throw error;
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedEmpresaId || !selectedAccountId || !user) return;

    setIsImporting(true);
    setImportSummary(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const worksheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: true });
      const detectedFormat = detectWorksheetImportFormat(worksheetRows);

      if (detectedFormat.kind === "receivables_aging_report") {
        throw new Error(
          `${detectedFormat.reason} Este layout debe importarse en cobranzas/cuentas por cobrar, no en Libro Banco.`
        );
      }

      if (detectedFormat.kind !== "bank_statement" || detectedFormat.headerRowIndex === null) {
        throw new Error(detectedFormat.reason || "No se pudo detectar un encabezado válido para la cartola bancaria.");
      }

      const rawRows = buildObjectsFromWorksheetRows(worksheetRows, detectedFormat.headerRowIndex);

      const parsedRows = rawRows.map((row) => normalizeBankImportRow(row, selectedAccountId));
      const validRows = parsedRows.filter(Boolean);
      const rejected = parsedRows.length - validRows.length;

      if (validRows.length === 0) {
        throw new Error("No se encontraron movimientos bancarios válidos en el archivo seleccionado.");
      }

      const hashes = validRows.map((row) => row!.sourceHash);
      const existingHashes = await fetchExistingHashes(hashes);
      const rowsToInsert = validRows.filter((row) => row && !existingHashes.has(row.sourceHash));

      const periodFrom = rowsToInsert.length > 0 ? rowsToInsert[0]!.fechaMovimiento : validRows[0]?.fechaMovimiento ?? null;
      const periodTo = rowsToInsert.length > 0 ? rowsToInsert[rowsToInsert.length - 1]!.fechaMovimiento : validRows.at(-1)?.fechaMovimiento ?? null;

      const { data: importRow, error: importError } = await supabase
        .from("bank_statement_imports")
        .insert({
          empresa_id: selectedEmpresaId,
          bank_account_id: selectedAccountId,
          original_filename: file.name,
          imported_by: user.id,
          row_count: 0,
          period_from: periodFrom,
          period_to: periodTo,
        })
        .select()
        .single();
      if (importError) throw importError;

      if (rowsToInsert.length > 0) {
        const insertPayload = rowsToInsert.map((row) => ({
          empresa_id: selectedEmpresaId,
          bank_account_id: selectedAccountId,
          import_id: importRow.id,
          fecha_movimiento: row!.fechaMovimiento,
          posted_at: row!.postedAt ? `${row!.postedAt}T12:00:00` : null,
          descripcion: row!.descripcion,
          monto: row!.monto,
          entrada_banco: row!.entradaBanco,
          salida_banco: row!.salidaBanco,
          estado: "no_conciliado",
          saldo: row!.saldo,
          n_operacion: row!.numeroOperacion,
          sucursal: row!.sucursal,
          source_hash: row!.sourceHash,
          columnas_extra: row!.columnasExtra,
        }));
        await insertBankMovementChunks(insertPayload);
      }

      const { error: updateError } = await supabase
        .from("bank_statement_imports")
        .update({
          row_count: rowsToInsert.length,
          period_from: periodFrom,
          period_to: periodTo,
        })
        .eq("id", importRow.id);
      if (updateError) throw updateError;

      setImportSummary({
        inserted: rowsToInsert.length,
        duplicates: validRows.length - rowsToInsert.length,
        rejected,
        periodFrom,
        periodTo,
        filename: file.name,
      });

      await Promise.all([fetchTransactions(), fetchLatestImport(), refreshPositions(), refreshBankAccounts()]);
    } catch (error: any) {
      console.error("Error importing bank statement:", error);
      const friendlyMessage =
        error instanceof TypeError && error.message === "Failed to fetch"
          ? "Fallo la conexion con Supabase durante la importacion. La cartola se intentara subir en lotes mas pequenos desde esta version; si el error persiste, revisa que Vercel este desplegado en el ultimo commit."
          : error.message;
      alert(`No se pudo importar la cartola: ${friendlyMessage}`);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((txn) => {
      if (filter === "matched" && txn.estado !== "conciliado") return false;
      if (filter === "unmatched" && txn.estado === "conciliado") return false;
      if (!searchTerm.trim()) return true;
      const haystack = [txn.descripcion, txn.numero_documento, txn.comentario_tesoreria].join(" ").toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });
  }, [transactions, filter, searchTerm]);

  const stats = useMemo(() => {
    return {
      pendingCount: transactions.filter((txn) => txn.estado !== "conciliado").length,
      matchedCount: transactions.filter((txn) => txn.estado === "conciliado").length,
      pendingAmount: transactions
        .filter((txn) => txn.estado !== "conciliado")
        .reduce((sum, txn) => sum + Math.abs(Number(txn.monto)), 0),
    };
  }, [transactions]);

  const searchableCandidates = useMemo(() => {
    const filteredBySource =
      selectedTxn && selectedTxn.monto >= 0
        ? candidates.filter((candidate) => candidate.type === selectedInflowSource)
        : candidates;
    if (!candidateSearchTerm.trim()) return filteredBySource;
    const normalized = candidateSearchTerm.toLowerCase();
    return filteredBySource.filter((candidate) =>
      `${candidate.label} ${candidate.subtitle}`.toLowerCase().includes(normalized)
    );
  }, [candidateSearchTerm, candidates, selectedInflowSource, selectedTxn]);

  const selectedInvoiceCandidates = useMemo(
    () =>
      candidates.filter(
        (candidate) => candidate.type === "factura" && selectedInvoiceMatches[candidate.id]
      ),
    [candidates, selectedInvoiceMatches]
  );

  const selectedInvoiceTotal = useMemo(
    () =>
      selectedInvoiceCandidates.reduce((sum, candidate) => {
        const selection = selectedInvoiceMatches[candidate.id];
        if (!selection) return sum;
        const amount = selection.mode === "partial" ? Number(selection.amount || 0) : candidate.amount;
        return sum + amount;
      }, 0),
    [selectedInvoiceCandidates, selectedInvoiceMatches]
  );

  const toggleInvoiceCandidate = (candidate: MatchCandidate) => {
    setSelectedInvoiceMatches((current) => {
      if (current[candidate.id]) {
        const next = { ...current };
        delete next[candidate.id];
        return next;
      }
      return {
        ...current,
        [candidate.id]: {
          mode: "full",
          amount: candidate.amount.toFixed(2),
        },
      };
    });
  };

  const handleInvoiceSelectionMode = (candidateId: string, mode: "full" | "partial", candidateAmount: number) => {
    setSelectedInvoiceMatches((current) => ({
      ...current,
      [candidateId]: {
        mode,
        amount: mode === "partial" ? current[candidateId]?.amount || candidateAmount.toFixed(2) : candidateAmount.toFixed(2),
      },
    }));
  };

  const handleInvoiceSelectionAmount = (candidateId: string, value: string) => {
    setSelectedInvoiceMatches((current) => ({
      ...current,
      [candidateId]: {
        ...(current[candidateId] || { mode: "partial" as const }),
        amount: value,
      },
    }));
  };

  const handleMatchSelectedInvoices = async () => {
    if (!selectedEmpresaId || !selectedTxn || selectedTxn.monto < 0) return;
    const selectedInvoices = candidates.filter(
      (candidate) => candidate.type === "factura" && selectedInvoiceMatches[candidate.id]
    );
    if (selectedInvoices.length === 0) {
      alert("Selecciona al menos una factura para conciliar.");
      return;
    }

    const payloads = selectedInvoices.map((candidate) => {
      const selection = selectedInvoiceMatches[candidate.id];
      const amount = selection?.mode === "partial" ? Number(selection.amount || 0) : candidate.amount;
      return { candidate, amount };
    });

    if (payloads.some((item) => !Number.isFinite(item.amount) || item.amount <= 0)) {
      alert("Todos los montos aplicados deben ser mayores a cero.");
      return;
    }

    if (payloads.some((item) => item.amount - item.candidate.amount > 0.01)) {
      alert("Un abono no puede superar el saldo pendiente de la factura.");
      return;
    }

    const totalApplied = payloads.reduce((sum, item) => sum + item.amount, 0);
    const bankAmount = Math.abs(selectedTxn.monto);
    if (Math.abs(totalApplied - bankAmount) > 0.01) {
      alert(`El total aplicado (${formatTreasuryCurrency(totalApplied, selectedAccount?.moneda || "CLP")}) debe coincidir con el movimiento bancario (${formatTreasuryCurrency(bankAmount, selectedAccount?.moneda || "CLP")}).`);
      return;
    }

    setMatchingId("multi-factura");
    try {
      const rows = payloads.map((item) => ({
        empresa_id: selectedEmpresaId,
        factura_id: item.candidate.id,
        rendicion_id: null,
        movimiento_banco_id: selectedTxn.id,
        monto_aplicado: item.amount,
        estado: "aplicado",
      }));
      const { error: paymentsError } = await supabase.from("facturas_pagos").insert(rows);
      if (paymentsError) throw paymentsError;

      const summary = payloads
        .map((item) => item.candidate.invoiceNumber || item.candidate.id)
        .slice(0, 3)
        .join(", ");
      const suffix = payloads.length > 3 ? ` +${payloads.length - 3} más` : "";

      const { error: movementError } = await supabase
        .from("movimientos_banco")
        .update({
          estado: "conciliado",
          tipo_conciliacion: "factura",
          numero_documento: `Facturas ${summary}${suffix}`,
        })
        .eq("id", selectedTxn.id)
        .eq("empresa_id", selectedEmpresaId);
      if (movementError) throw movementError;

      await syncInvoiceStatuses(payloads.map((item) => item.candidate.id));
      setSelectedTxn(null);
      setCandidates([]);
      setSelectedInvoiceMatches({});
      await fetchTransactions();
      await refreshPositions();
    } catch (error: any) {
      console.error("Error matching multiple invoices:", error);
      alert(`No se pudo conciliar las facturas seleccionadas: ${error.message}`);
    } finally {
      setMatchingId(null);
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Conciliación bancaria</CardTitle>
            <CardDescription>Selecciona una empresa para trabajar con cuentas bancarias.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Banco por Cuenta</h1>
          <p className="mt-1 text-muted-foreground">
            Importa cartolas por cuenta, deduplica por hash y concilia con facturas y rendiciones.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Cuenta bancaria</span>
            <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Selecciona una cuenta" />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.nombre} • {account.banco}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" onClick={() => { void fetchTransactions(); void fetchLatestImport(); void refreshPositions(); }} disabled={!selectedAccountId}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refrescar
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={!selectedAccountId || !canEdit || isImporting}
          >
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importar cartola
          </Button>
        </div>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar cartolas y conciliaciones, pero no importar ni editar.
          </CardContent>
        </Card>
      )}

      {selectedAccount && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Saldo actual"
            value={formatTreasuryCurrency(selectedPosition?.currentBalance ?? selectedAccount.saldoInicial, selectedAccount.moneda)}
            description={`Cuenta ${selectedAccount.nombre}`}
          />
          <StatCard
            title="No conciliados"
            value={String(stats.pendingCount)}
            description={formatTreasuryCurrency(stats.pendingAmount, selectedAccount.moneda)}
          />
          <StatCard
            title="Última cartola"
            value={latestImport ? formatTreasuryDate(latestImport.imported_at) : "Sin importación"}
            description={latestImport ? latestImport.original_filename : "Aún no se ha importado"}
          />
          <StatCard
            title="Estado"
            value={selectedPosition?.staleImport ? "Desactualizada" : "Al día"}
            description={
              selectedPosition
                ? `${selectedPosition.unreconciledCount} movimiento(s) sin conciliar`
                : "Sin posición calculada"
            }
            tone={selectedPosition?.staleImport ? "warning" : "default"}
          />
        </div>
      )}

      {importSummary && (
        <Card className="border-emerald-200">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-emerald-700">Importación completada: {importSummary.filename}</div>
            <div className="mt-1 text-muted-foreground">
              {importSummary.inserted} insertados, {importSummary.duplicates} duplicados, {importSummary.rejected} rechazados.
              {importSummary.periodFrom && importSummary.periodTo
                ? ` Periodo ${formatTreasuryDate(importSummary.periodFrom)} a ${formatTreasuryDate(importSummary.periodTo)}.`
                : ""}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Movimientos bancarios</CardTitle>
              <CardDescription>Filtrados por la cuenta seleccionada y listos para conciliación.</CardDescription>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Buscar descripción o documento..."
                  className="pl-10"
                />
              </div>
              <Select value={filter} onValueChange={(value: "all" | "unmatched" | "matched") => setFilter(value)}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="unmatched">No conciliados</SelectItem>
                  <SelectItem value="matched">Conciliados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Fecha</th>
                <th className="px-4 py-3 text-left">Descripción</th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-4 py-3 text-right">Saldo</th>
                <th className="px-4 py-3 text-left">Conciliación</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((txn) => {
                const activePayments = (txn.facturas_pagos || []).filter((row) => row.estado !== "revertido");
                const payment = activePayments[0];
                const invoiceInfo = Array.isArray(payment?.facturas) ? payment.facturas[0] : payment?.facturas;
                const rendicionInfo = Array.isArray(payment?.rendiciones) ? payment.rendiciones[0] : payment?.rendiciones;
                const chequeInfo = txn.cheques_cartera?.[0];
                const webpayInfo = txn.webpay_liquidaciones?.[0];
                const commitmentInfo = txn.cash_commitments?.[0];
                const canArchiveLinkedManual =
                  Boolean(commitmentInfo) && commitmentInfo?.source_type === "manual" && !commitmentInfo?.archived_at;
                const webpayClient = Array.isArray(webpayInfo?.terceros) ? webpayInfo?.terceros[0] : webpayInfo?.terceros;
                const webpayInvoice = Array.isArray(webpayInfo?.facturas) ? webpayInfo?.facturas[0] : webpayInfo?.facturas;
                return (
                  <tr key={txn.id} className="border-t">
                    <td className="px-4 py-3">{formatTreasuryDate(txn.fecha_movimiento)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{txn.descripcion || "Sin descripción"}</div>
                      {txn.numero_documento && <div className="text-xs text-muted-foreground">{txn.numero_documento}</div>}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-semibold", txn.monto >= 0 ? "text-emerald-700" : "text-red-700")}>
                      {formatTreasuryCurrency(txn.monto, selectedAccount?.moneda || "CLP")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {txn.saldo === null ? "Sin saldo" : formatTreasuryCurrency(txn.saldo, selectedAccount?.moneda || "CLP")}
                    </td>
                    <td className="px-4 py-3">
                      {payment ? (
                        <div>
                          <div className="font-medium">
                            {activePayments.length > 1
                              ? `${activePayments.length} facturas conciliadas`
                              : invoiceInfo?.tercero_nombre || rendicionInfo?.tercero_nombre || "Documento conciliado"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {activePayments.length > 1
                              ? activePayments
                                  .map((row) => {
                                    const factura = Array.isArray(row.facturas) ? row.facturas[0] : row.facturas;
                                    return factura?.numero_documento;
                                  })
                                  .filter(Boolean)
                                  .slice(0, 3)
                                  .join(", ")
                              : invoiceInfo?.numero_documento || rendicionInfo?.descripcion || "Sin detalle"}
                          </div>
                        </div>
                      ) : chequeInfo ? (
                        <div>
                          <div className="font-medium">{chequeInfo.librador || "Cheque conciliado"}</div>
                          <div className="text-xs text-muted-foreground">Cheque {chequeInfo.numero_cheque}</div>
                        </div>
                      ) : webpayInfo ? (
                        <div>
                          <div className="font-medium">{webpayClient?.razon_social || "WebPay conciliado"}</div>
                          <div className="text-xs text-muted-foreground">
                            Orden {webpayInfo.orden_compra}
                            {webpayInvoice?.numero_documento ? ` • Factura ${webpayInvoice.numero_documento}` : ""}
                          </div>
                        </div>
                      ) : commitmentInfo ? (
                        <div>
                          <div className="font-medium">{commitmentInfo.counterparty || "Compromiso conciliado"}</div>
                          <div className="text-xs text-muted-foreground">{commitmentInfo.description || "Sin detalle"}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Pendiente</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          txn.estado === "conciliado"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        )}
                      >
                        {txn.estado === "conciliado" ? "Conciliado" : "No conciliado"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        {txn.estado === "conciliado" ? (
                          <>
                            <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => handleUndoMatch(txn)}>
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Deshacer
                            </Button>
                            {canArchiveLinkedManual && (
                              <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => void handleArchiveLinkedManualExpense(txn)}>
                                Archivar egreso
                              </Button>
                            )}
                          </>
                        ) : (
                          <Button size="sm" disabled={!canEdit} onClick={() => void fetchCandidates(txn)}>
                            <Check className="mr-2 h-4 w-4" />
                            Conciliar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "No hay movimientos para el filtro actual."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedTxn)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTxn(null);
            setSelectedInflowSource("factura");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conciliar movimiento</DialogTitle>
            <DialogDescription>
              {selectedTxn
                ? `${selectedTxn.descripcion || "Sin descripción"} • ${formatTreasuryCurrency(selectedTxn.monto, selectedAccount?.moneda || "CLP")}`
                : "Selecciona un movimiento para conciliar."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!loadingCandidates && selectedTxn && selectedTxn.monto >= 0 && (
              <div className="rounded-xl border border-dashed p-4">
                <div className="mb-4">
                  <div className="font-medium">Fuente del ingreso</div>
                  <div className="text-sm text-muted-foreground">
                    Selecciona si el abono corresponde a un cheque, una liquidación de WebPay o una transferencia que paga una factura.
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Tipo de conciliación</Label>
                  <Select
                    value={selectedInflowSource}
                    onValueChange={(value) => setSelectedInflowSource(value as InflowMatchSource)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona el origen del ingreso" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="factura">Transferencia / Factura</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="webpay">WebPay</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="text-xs text-muted-foreground">
                    {selectedInflowSource === "factura"
                      ? "Se mostrarán facturas abiertas con razón social y número de documento."
                      : selectedInflowSource === "cheque"
                        ? "Se mostrarán solo los cheques disponibles para conciliar. Al aceptar pasarán a cobrados."
                      : "Se mostrarán solo pagos WebPay pendientes de abono."}
                  </div>
                </div>
                {selectedInflowSource === "factura" && (
                  <div className="mt-4 space-y-2">
                    <Label>Buscar factura</Label>
                    <Input
                      value={candidateSearchTerm}
                      onChange={(event) => setCandidateSearchTerm(event.target.value)}
                      placeholder="Filtra por razón social o número de factura"
                    />
                  </div>
                )}
              </div>
            )}

            {!loadingCandidates && selectedTxn && selectedTxn.monto < 0 && (
              <div className="rounded-xl border border-dashed p-4">
                <div className="mb-4">
                  <div className="font-medium">Conciliación rápida de egreso</div>
                  <div className="text-sm text-muted-foreground">
                    Si el movimiento no corresponde a un documento existente, clasifícalo aquí y se creará el egreso manual ya conciliado.
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Descripción</Label>
                    <Input
                      value={quickExpenseForm.description}
                      onChange={(event) => setQuickExpenseForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Remuneración, impuestos, gasto oficina..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contraparte</Label>
                    <Input
                      value={quickExpenseForm.counterparty}
                      onChange={(event) => setQuickExpenseForm((current) => ({ ...current, counterparty: event.target.value }))}
                      placeholder="Persona, SII, arrendador, proveedor"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Categoría / cuenta</Label>
                    <Select
                      value={quickExpenseForm.categoryId}
                      onValueChange={(value) => setQuickExpenseForm((current) => ({ ...current, categoryId: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona categoría" />
                      </SelectTrigger>
                      <SelectContent>
                        {outflowCategories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Prioridad</Label>
                    <Select
                      value={quickExpenseForm.priority}
                      onValueChange={(value) => setQuickExpenseForm((current) => ({ ...current, priority: value as TreasuryPriority }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="critical">Crítica</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="deferrable">Postergable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Monto</Label>
                    <Input value={formatTreasuryCurrency(Math.abs(selectedTxn.monto), selectedAccount?.moneda || "CLP")} disabled />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={quickExpenseForm.isRecurring}
                        onChange={(event) =>
                          setQuickExpenseForm((current) => ({ ...current, isRecurring: event.target.checked }))
                        }
                      />
                      Marcar como gasto recurrente
                    </Label>
                  </div>
                  {quickExpenseForm.isRecurring && (
                    <div className="space-y-2">
                      <Label>Frecuencia</Label>
                      <Select
                        value={quickExpenseForm.frequency}
                        onValueChange={(value) =>
                          setQuickExpenseForm((current) => ({
                            ...current,
                            frequency: value as QuickExpenseForm["frequency"],
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Semanal</SelectItem>
                          <SelectItem value="biweekly">Quincenal</SelectItem>
                          <SelectItem value="monthly">Mensual</SelectItem>
                          <SelectItem value="quarterly">Trimestral</SelectItem>
                          <SelectItem value="annual">Anual</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2 md:col-span-2">
                    <Label>Nota</Label>
                    <Textarea
                      value={quickExpenseForm.notes}
                      onChange={(event) => setQuickExpenseForm((current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Observaciones para tesorería o contexto del pago"
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => void handleQuickExpenseMatch()} disabled={!canEdit || savingQuickExpense}>
                    {savingQuickExpense ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Crear y conciliar egreso
                  </Button>
                </div>
              </div>
            )}

            {loadingCandidates && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {!loadingCandidates && selectedTxn && selectedTxn.monto >= 0 && selectedInflowSource === "factura" && (
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">Facturas seleccionadas</div>
                    <div className="text-sm text-muted-foreground">
                      Total aplicado: {formatTreasuryCurrency(selectedInvoiceTotal, selectedAccount?.moneda || "CLP")} de {formatTreasuryCurrency(Math.abs(selectedTxn.monto), selectedAccount?.moneda || "CLP")}
                    </div>
                  </div>
                  <Button onClick={() => void handleMatchSelectedInvoices()} disabled={!canEdit || matchingId === "multi-factura" || selectedInvoiceCandidates.length === 0}>
                    {matchingId === "multi-factura" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Conciliar facturas seleccionadas
                  </Button>
                </div>
              </div>
            )}
            {!loadingCandidates && searchableCandidates.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                {selectedTxn && selectedTxn.monto >= 0
                  ? selectedInflowSource === "factura"
                    ? "No hay facturas abiertas para este ingreso."
                    : selectedInflowSource === "cheque"
                      ? "No hay cheques disponibles para este ingreso."
                      : "No hay liquidaciones WebPay pendientes para este ingreso."
                  : "No se encontraron candidatos para este movimiento."}
              </div>
            )}
            {searchableCandidates.map((candidate) => (
              <div key={`${candidate.type}-${candidate.id}`} className="rounded-xl border p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">{candidate.label}</div>
                    <div className="text-sm text-muted-foreground">
                      {candidate.subtitle}
                      {candidate.dueDate ? ` • vence ${formatTreasuryDate(candidate.dueDate)}` : ""}
                    </div>
                  </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatTreasuryCurrency(candidate.amount, selectedAccount?.moneda || "CLP")}</div>
                      <div className="text-xs text-muted-foreground">
                        {candidate.type === "factura"
                          ? "Factura"
                          : candidate.type === "rendicion"
                            ? "Rendición"
                            : candidate.type === "cheque"
                              ? "Cheque"
                              : candidate.type === "webpay"
                                ? "WebPay"
                                : "Compromiso"}
                      </div>
                    </div>
                  </div>
                {selectedTxn && selectedTxn.monto >= 0 && selectedInflowSource === "factura" && candidate.type === "factura" ? (
                  <div className="mt-3 space-y-3 rounded-lg border bg-background p-3">
                    <Label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedInvoiceMatches[candidate.id])}
                        onChange={() => toggleInvoiceCandidate(candidate)}
                      />
                      Seleccionar esta factura
                    </Label>
                    {selectedInvoiceMatches[candidate.id] && (
                      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                        <div className="space-y-2">
                          <Label>Tipo de aplicación</Label>
                          <Select
                            value={selectedInvoiceMatches[candidate.id]?.mode || "full"}
                            onValueChange={(value) =>
                              handleInvoiceSelectionMode(candidate.id, value as "full" | "partial", candidate.amount)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full">Pago completo</SelectItem>
                              <SelectItem value="partial">Abono</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedInvoiceMatches[candidate.id]?.mode === "partial" && (
                          <div className="space-y-2">
                            <Label>Monto abonado</Label>
                            <Input
                              type="number"
                              min="0"
                              max={candidate.amount}
                              value={selectedInvoiceMatches[candidate.id]?.amount || ""}
                              onChange={(event) => handleInvoiceSelectionAmount(candidate.id, event.target.value)}
                              placeholder={`Máximo ${candidate.amount}`}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end">
                    <Button onClick={() => void handleMatch(candidate)} disabled={!canEdit || matchingId === candidate.id}>
                      {matchingId === candidate.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Conciliar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTxn(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  tone = "default",
}: {
  title: string;
  value: string;
  description: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={cn(tone === "warning" && "border-amber-200")}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
