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
import { useBankAccountPositions, useBankAccounts } from "@/hooks/useTreasury";
import { cn } from "@/lib/utils";

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
};

type MatchCandidate = {
  id: string;
  type: "factura" | "rendicion" | "cheque" | "webpay";
  label: string;
  subtitle: string;
  amount: number;
  dueDate: string | null;
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
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const { data: bankAccounts, refresh: refreshBankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: bankPositions, refresh: refreshPositions } = useBankAccountPositions(selectedEmpresaId);

  const selectedAccount = bankAccounts.find((account) => account.id === selectedAccountId) || null;
  const selectedPosition = bankPositions.find((position) => position.bankAccountId === selectedAccountId) || null;

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
    setLoadingCandidates(true);
    try {
      const absAmount = Math.abs(txn.monto);

      const invoiceQuery = txn.monto >= 0
        ? supabase
            .from("facturas")
            .select("id, numero_documento, tercero_nombre, monto, fecha_vencimiento")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "venta")
            .in("estado", ["pendiente", "morosa"])
        : supabase
            .from("facturas")
            .select("id, numero_documento, tercero_nombre, monto, fecha_vencimiento")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "compra")
            .in("estado", ["pendiente", "morosa"]);

      const [{ data: invoices, error: invoiceError }, { data: rendiciones, error: rendicionError }, { data: cheques, error: chequesError }, { data: webpayRows, error: webpayError }] =
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
        ]);

      if (invoiceError) throw invoiceError;
      if (rendicionError) throw rendicionError;
      if (chequesError) throw chequesError;
      if (webpayError) throw webpayError;

      const nextCandidates: MatchCandidate[] = [
        ...(invoices || []).map((invoice: any) => ({
          id: invoice.id,
          type: "factura" as const,
          label: `${invoice.tercero_nombre || "Sin tercero"} • ${invoice.numero_documento || "Sin folio"}`,
          subtitle: "Factura abierta",
          amount: Number(invoice.monto),
          dueDate: invoice.fecha_vencimiento || null,
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
      ].sort((a, b) => Math.abs(absAmount - a.amount) - Math.abs(absAmount - b.amount));

      setCandidates(nextCandidates);
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
                  : "factura",
          numero_documento:
            candidate.type === "cheque" || candidate.type === "webpay"
              ? candidate.label
              : candidate.type === "factura"
                ? candidate.label
                : selectedTxn.numero_documento,
        })
        .eq("id", selectedTxn.id)
        .eq("empresa_id", selectedEmpresaId);
      if (movementError) throw movementError;

      if (candidate.type === "factura") {
        const { error } = await supabase
          .from("facturas")
          .update({ estado: "pagada" })
          .eq("id", candidate.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
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
    if (payments.length === 0 && !linkedCheque && !linkedWebpay) return;

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

      for (const facturaId of facturaIds) {
        const { count } = await supabase
          .from("facturas_pagos")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", selectedEmpresaId)
          .eq("factura_id", facturaId)
          .eq("estado", "aplicado");
        if ((count || 0) === 0) {
          await supabase.from("facturas").update({ estado: "pendiente" }).eq("id", facturaId).eq("empresa_id", selectedEmpresaId);
        }
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
    if (!searchTerm.trim()) return candidates;
    const normalized = searchTerm.toLowerCase();
    return candidates.filter((candidate) =>
      `${candidate.label} ${candidate.subtitle}`.toLowerCase().includes(normalized)
    );
  }, [candidates, searchTerm]);

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
                const payment = txn.facturas_pagos?.find((row) => row.estado !== "revertido");
                const invoiceInfo = Array.isArray(payment?.facturas) ? payment.facturas[0] : payment?.facturas;
                const rendicionInfo = Array.isArray(payment?.rendiciones) ? payment.rendiciones[0] : payment?.rendiciones;
                const chequeInfo = txn.cheques_cartera?.[0];
                const webpayInfo = txn.webpay_liquidaciones?.[0];
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
                          <div className="font-medium">{invoiceInfo?.tercero_nombre || rendicionInfo?.tercero_nombre || "Documento conciliado"}</div>
                          <div className="text-xs text-muted-foreground">
                            {invoiceInfo?.numero_documento || rendicionInfo?.descripcion || "Sin detalle"}
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
                          <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => handleUndoMatch(txn)}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Deshacer
                          </Button>
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

      <Dialog open={Boolean(selectedTxn)} onOpenChange={(open) => !open && setSelectedTxn(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Conciliar movimiento</DialogTitle>
            <DialogDescription>
              {selectedTxn
                ? `${selectedTxn.descripcion || "Sin descripción"} • ${formatTreasuryCurrency(selectedTxn.monto, selectedAccount?.moneda || "CLP")}`
                : "Selecciona un movimiento para conciliar."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {loadingCandidates && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {!loadingCandidates && searchableCandidates.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                No se encontraron candidatos para este movimiento.
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
                              : "WebPay"}
                      </div>
                    </div>
                  </div>
                <div className="mt-3 flex justify-end">
                  <Button onClick={() => void handleMatch(candidate)} disabled={!canEdit || matchingId === candidate.id}>
                    {matchingId === candidate.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Conciliar
                  </Button>
                </div>
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
