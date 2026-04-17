import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Landmark, Loader2, Plus, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useBankAccounts, useTreasuryCategories } from "@/hooks/useTreasury";
import {
  PRIORITY_BADGE_CLASSES,
  PRIORITY_LABELS,
  canEditTreasury,
  formatTreasuryCurrency,
  formatTreasuryDate,
} from "@/lib/treasury";
import { cn } from "@/lib/utils";

type Proveedor = {
  id: string;
  rut: string;
  razon_social: string;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
};

type PurchaseInvoice = {
  id: string;
  tercero_id: string;
  tercero_nombre: string;
  numero_documento: string;
  monto: number;
  estado: string;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  planned_cash_date: string | null;
  treasury_priority: "critical" | "high" | "normal" | "deferrable" | null;
  preferred_bank_account_id: string | null;
  blocked_reason: string | null;
  treasury_category_id: string | null;
};

type BankLoan = {
  id: string;
  lender_name: string;
  loan_name: string;
  principal_amount: number;
  installment_amount: number;
  total_installments: number;
  first_due_date: string;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  priority: "critical" | "high" | "normal" | "deferrable";
  status: "active" | "completed" | "cancelled";
  notes: string | null;
  bank_account_id: string | null;
  treasury_category_id: string | null;
};

type LoanCommitment = {
  id: string;
  source_reference: string | null;
  status: "planned" | "confirmed" | "paid" | "cancelled" | "deferred";
  amount: number;
  due_date: string;
  expected_date: string;
  movimiento_banco_id?: string | null;
};

type LoanFrequency = BankLoan["frequency"];
type LoanPriority = BankLoan["priority"];

const frequencyLabels: Record<LoanFrequency, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  quarterly: "Trimestral",
  annual: "Anual",
};

const openCommitmentStatuses = new Set(["planned", "confirmed", "deferred"]);

const addFrequencyStep = (baseDate: string, frequency: LoanFrequency) => {
  const next = new Date(`${baseDate}T12:00:00`);
  if (Number.isNaN(next.getTime())) return baseDate;
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  if (frequency === "biweekly") next.setDate(next.getDate() + 14);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  if (frequency === "quarterly") next.setMonth(next.getMonth() + 3);
  if (frequency === "annual") next.setFullYear(next.getFullYear() + 1);
  return next.toISOString().split("T")[0];
};

const buildInstallmentDates = (firstDueDate: string, frequency: LoanFrequency, totalInstallments: number) => {
  const dates: string[] = [];
  let currentDate = firstDueDate;
  for (let index = 0; index < totalInstallments; index += 1) {
    dates.push(currentDate);
    currentDate = addFrequencyStep(currentDate, frequency);
  }
  return dates;
};

export default function Proveedores() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [bankLoans, setBankLoans] = useState<BankLoan[]>([]);
  const [loanCommitments, setLoanCommitments] = useState<LoanCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewProvOpen, setIsNewProvOpen] = useState(false);
  const [isSavingProv, setIsSavingProv] = useState(false);
  const [isNewInvoiceOpen, setIsNewInvoiceOpen] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isNewLoanOpen, setIsNewLoanOpen] = useState(false);
  const [isSavingLoan, setIsSavingLoan] = useState(false);
  const [editingLoan, setEditingLoan] = useState<(BankLoan & { paidInstallments: number; remainingInstallments: number; derivedStatus: string }) | null>(null);
  const [loanProgressPaid, setLoanProgressPaid] = useState("0");
  const [savingLoanProgress, setSavingLoanProgress] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<PurchaseInvoice | null>(null);
  const [savingTreasury, setSavingTreasury] = useState(false);
  const [newProvData, setNewProvData] = useState({
    rut: "",
    razon_social: "",
    email: "",
    telefono: "",
    direccion: "",
  });
  const [newInvoiceData, setNewInvoiceData] = useState({
    tercero_id: "",
    fecha_emision: new Date().toISOString().split("T")[0],
    fecha_vencimiento: "",
    numero_documento: "",
    monto: "",
    treasury_category_id: "",
    treasury_priority: "normal",
    preferred_bank_account_id: "none",
    planned_cash_date: "",
    blocked_reason: "",
  });
  const [newLoanData, setNewLoanData] = useState({
    lender_name: "",
    loan_name: "",
    principal_amount: "",
    installment_amount: "",
    total_installments: "",
    paid_installments: "0",
    first_due_date: new Date().toISOString().split("T")[0],
    frequency: "monthly" as LoanFrequency,
    treasury_category_id: "",
    priority: "high" as LoanPriority,
    bank_account_id: "none",
    notes: "",
  });
  const [editForm, setEditForm] = useState({
    treasury_category_id: "",
    treasury_priority: "normal",
    preferred_bank_account_id: "none",
    planned_cash_date: "",
    blocked_reason: "",
  });

  const { data: bankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: treasuryCategories } = useTreasuryCategories(selectedEmpresaId);

  useEffect(() => {
    if (selectedEmpresaId) {
      void fetchData();
    }
  }, [selectedEmpresaId]);

  const fetchData = async () => {
    if (!selectedEmpresaId) return;
    setLoading(true);
    try {
      const [
        { data: supplierData, error: supplierError },
        { data: invoiceData, error: invoiceError },
        { data: loanData, error: loanError },
        { data: loanCommitmentData, error: loanCommitmentError },
      ] = await Promise.all([
        supabase
          .from("terceros")
          .select("id, rut, razon_social, email, telefono, direccion")
          .eq("empresa_id", selectedEmpresaId)
          .eq("tipo", "proveedor")
          .eq("estado", "activo")
          .order("razon_social", { ascending: true }),
        supabase
          .from("facturas")
          .select("id, tercero_id, tercero_nombre, numero_documento, monto, estado, fecha_emision, fecha_vencimiento, planned_cash_date, treasury_priority, preferred_bank_account_id, blocked_reason, treasury_category_id")
          .eq("empresa_id", selectedEmpresaId)
          .eq("tipo", "compra")
          .in("estado", ["pendiente", "morosa"])
          .order("planned_cash_date", { ascending: true }),
        supabase
          .from("bank_loans")
          .select("id, lender_name, loan_name, principal_amount, installment_amount, total_installments, first_due_date, frequency, priority, status, notes, bank_account_id, treasury_category_id")
          .eq("empresa_id", selectedEmpresaId)
          .order("created_at", { ascending: false }),
        supabase
          .from("cash_commitments")
          .select("id, source_reference, status, amount, due_date, expected_date, movimiento_banco_id")
          .eq("empresa_id", selectedEmpresaId)
          .eq("direction", "outflow")
          .eq("source_type", "debt")
          .is("archived_at", null)
          .order("expected_date", { ascending: true }),
      ]);

      if (supplierError) throw supplierError;
      if (invoiceError) throw invoiceError;
      if (loanError) throw loanError;
      if (loanCommitmentError) throw loanCommitmentError;

      setProveedores((supplierData || []) as Proveedor[]);
      setInvoices((invoiceData || []) as PurchaseInvoice[]);
      setBankLoans((loanData || []) as BankLoan[]);
      setLoanCommitments((loanCommitmentData || []) as LoanCommitment[]);
    } catch (error) {
      console.error("Error fetching cuentas por pagar:", error);
    } finally {
      setLoading(false);
    }
  };

  const categoriesById = useMemo(
    () => new Map(treasuryCategories.map((category) => [category.id, category.nombre])),
    [treasuryCategories]
  );
  const accountsById = useMemo(
    () => new Map(bankAccounts.map((account) => [account.id, account.nombre])),
    [bankAccounts]
  );

  const groupedSuppliers = useMemo(() => {
    return proveedores
      .map((supplier) => {
        const supplierInvoices = invoices.filter((invoice) => invoice.tercero_id === supplier.id);
        const outstanding = supplierInvoices.reduce((sum, invoice) => sum + invoice.monto, 0);
        const dueSoon = supplierInvoices.filter((invoice) => {
          if (!invoice.planned_cash_date) return false;
          const diff = new Date(invoice.planned_cash_date).getTime() - Date.now();
          return diff <= 7 * 24 * 60 * 60 * 1000;
        }).length;
        return { ...supplier, supplierInvoices, outstanding, dueSoon };
      })
      .filter((supplier) => {
        const normalized = searchQuery.toLowerCase().trim();
        if (!normalized) return true;
        return (
          supplier.razon_social.toLowerCase().includes(normalized) ||
          supplier.rut.toLowerCase().includes(normalized) ||
          supplier.supplierInvoices.some((invoice) => invoice.numero_documento?.toLowerCase().includes(normalized))
        );
      });
  }, [proveedores, invoices, searchQuery]);

  const totals = useMemo(() => {
    return groupedSuppliers.reduce(
      (acc, supplier) => {
        acc.outstanding += supplier.outstanding;
        acc.dueSoon += supplier.supplierInvoices
          .filter((invoice) => invoice.planned_cash_date && new Date(invoice.planned_cash_date).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000)
          .reduce((sum, invoice) => sum + invoice.monto, 0);
        return acc;
      },
      { outstanding: 0, dueSoon: 0 }
    );
  }, [groupedSuppliers]);

  const suppliersCategoryId = treasuryCategories.find((category) => category.code === "suppliers")?.id ?? "";
  const debtCategoryId = treasuryCategories.find((category) => category.code === "debt_service")?.id ?? "";

  const loansWithStatus = useMemo(() => {
    return bankLoans.map((loan) => {
      const commitments = loanCommitments.filter((commitment) => commitment.source_reference === loan.id);
      const paidInstallments = commitments.filter((commitment) => commitment.status === "paid").length;
      const remainingInstallments = commitments.filter((commitment) => openCommitmentStatuses.has(commitment.status)).length;
      const nextInstallment = commitments
        .filter((commitment) => openCommitmentStatuses.has(commitment.status))
        .sort((a, b) => (a.expected_date || a.due_date).localeCompare(b.expected_date || b.due_date))[0];
      const outstandingAmount = commitments
        .filter((commitment) => openCommitmentStatuses.has(commitment.status))
        .reduce((sum, commitment) => sum + Number(commitment.amount || 0), 0);
      const paidAmount = commitments
        .filter((commitment) => commitment.status === "paid")
        .reduce((sum, commitment) => sum + Number(commitment.amount || 0), 0);

      return {
        ...loan,
        paidInstallments,
        remainingInstallments,
        nextInstallmentDate: nextInstallment?.expected_date || nextInstallment?.due_date || null,
        outstandingAmount,
        paidAmount,
        derivedStatus:
          loan.status === "cancelled" ? "cancelled" : remainingInstallments === 0 ? "completed" : "active",
      };
    });
  }, [bankLoans, loanCommitments]);

  const loanTotals = useMemo(
    () =>
      loansWithStatus.reduce(
        (acc, loan) => {
          if (loan.derivedStatus === "active") {
            acc.activeLoans += 1;
            acc.remainingInstallments += loan.remainingInstallments;
            acc.outstandingAmount += loan.outstandingAmount;
          }
          return acc;
        },
        { activeLoans: 0, remainingInstallments: 0, outstandingAmount: 0 }
      ),
    [loansWithStatus]
  );

  const handleCreateProvManual = async () => {
    if (!selectedEmpresaId) return;
    if (!newProvData.rut || !newProvData.razon_social || !newProvData.email || !newProvData.telefono) {
      alert("RUT, Razón Social, Email y Teléfono son obligatorios.");
      return;
    }

    setIsSavingProv(true);
    try {
      const cleanRut = newProvData.rut.replace(/\./g, "").replace(/-/g, "").toUpperCase();
      const { error } = await supabase.from("terceros").insert({
        empresa_id: selectedEmpresaId,
        ...newProvData,
        rut: cleanRut,
        tipo: "proveedor",
        estado: "activo",
      });
      if (error) throw error;

      setIsNewProvOpen(false);
      setNewProvData({ rut: "", razon_social: "", email: "", telefono: "", direccion: "" });
      await fetchData();
    } catch (error: any) {
      console.error("Error al crear proveedor:", error);
      alert(`No se pudo crear el proveedor: ${error.message}`);
    } finally {
      setIsSavingProv(false);
    }
  };

  const handleCreateCompraInvoice = async () => {
    if (!selectedEmpresaId) return;
    if (!newInvoiceData.tercero_id || !newInvoiceData.fecha_emision || !newInvoiceData.fecha_vencimiento || !newInvoiceData.numero_documento || !newInvoiceData.monto) {
      alert("Completa proveedor, fechas, folio y monto.");
      return;
    }

    const selectedSupplier = proveedores.find((supplier) => supplier.id === newInvoiceData.tercero_id);
    if (!selectedSupplier) {
      alert("Proveedor no válido.");
      return;
    }

    setIsSavingInvoice(true);
    try {
      const { error } = await supabase.from("facturas").insert({
        empresa_id: selectedEmpresaId,
        tipo: "compra",
        tercero_id: selectedSupplier.id,
        tercero_nombre: selectedSupplier.razon_social,
        rut: selectedSupplier.rut,
        fecha_emision: newInvoiceData.fecha_emision,
        fecha_vencimiento: newInvoiceData.fecha_vencimiento,
        numero_documento: newInvoiceData.numero_documento.trim(),
        monto: Number(newInvoiceData.monto),
        estado: "pendiente",
        treasury_category_id: newInvoiceData.treasury_category_id || suppliersCategoryId || null,
        treasury_priority: newInvoiceData.treasury_priority,
        preferred_bank_account_id: newInvoiceData.preferred_bank_account_id === "none" ? null : newInvoiceData.preferred_bank_account_id,
        planned_cash_date: newInvoiceData.planned_cash_date || newInvoiceData.fecha_vencimiento,
        blocked_reason: newInvoiceData.blocked_reason || null,
      });
      if (error) throw error;

      setIsNewInvoiceOpen(false);
      setNewInvoiceData({
        tercero_id: "",
        fecha_emision: new Date().toISOString().split("T")[0],
        fecha_vencimiento: "",
        numero_documento: "",
        monto: "",
        treasury_category_id: suppliersCategoryId,
        treasury_priority: "normal",
        preferred_bank_account_id: "none",
        planned_cash_date: "",
        blocked_reason: "",
      });
      await fetchData();
    } catch (error: any) {
      console.error("Error creando factura de compra:", error);
      alert(`No se pudo guardar la factura: ${error.message}`);
    } finally {
      setIsSavingInvoice(false);
    }
  };

  const handleCreateBankLoan = async () => {
    if (!selectedEmpresaId || !canEdit) return;
    if (
      !newLoanData.lender_name ||
      !newLoanData.loan_name ||
      !newLoanData.installment_amount ||
      !newLoanData.total_installments ||
      !newLoanData.first_due_date
    ) {
      alert("Entidad, nombre del crédito, monto cuota, total de cuotas y primera cuota son obligatorios.");
      return;
    }

    const installmentAmount = Number(newLoanData.installment_amount);
    const totalInstallments = Number(newLoanData.total_installments);
    const principalAmount = Number(newLoanData.principal_amount || 0);
    const paidInstallments = Number(newLoanData.paid_installments || 0);

    if (
      !Number.isFinite(installmentAmount) ||
      installmentAmount <= 0 ||
      !Number.isInteger(totalInstallments) ||
      totalInstallments <= 0 ||
      !Number.isInteger(paidInstallments) ||
      paidInstallments < 0 ||
      paidInstallments > totalInstallments
    ) {
      alert("Revisa el monto, la cantidad total de cuotas y cuántas ya van pagadas.");
      return;
    }

    const categoryId = newLoanData.treasury_category_id || debtCategoryId;
    if (!categoryId) {
      alert("No existe la categoría de créditos bancarios. Revisa la configuración de tesorería.");
      return;
    }

    const loanId = crypto.randomUUID();
    const bankAccountId = newLoanData.bank_account_id === "none" ? null : newLoanData.bank_account_id;
    const installmentDates = buildInstallmentDates(newLoanData.first_due_date, newLoanData.frequency, totalInstallments);

    setIsSavingLoan(true);
    try {
      const { error: loanError } = await supabase.from("bank_loans").insert({
        id: loanId,
        empresa_id: selectedEmpresaId,
        bank_account_id: bankAccountId,
        treasury_category_id: categoryId,
        lender_name: newLoanData.lender_name.trim(),
        loan_name: newLoanData.loan_name.trim(),
        principal_amount: principalAmount,
        installment_amount: installmentAmount,
        total_installments: totalInstallments,
        first_due_date: newLoanData.first_due_date,
        frequency: newLoanData.frequency,
        priority: newLoanData.priority,
        status: "active",
        notes: newLoanData.notes.trim() || null,
        created_by: user?.id ?? null,
      });
      if (loanError) throw loanError;

      const commitmentPayload = installmentDates.map((dueDate, index) => ({
        empresa_id: selectedEmpresaId,
        template_id: null,
        bank_account_id: bankAccountId,
        category_id: categoryId,
        source_type: "debt",
        source_reference: loanId,
        direction: "outflow",
        counterparty: newLoanData.lender_name.trim(),
        description: `${newLoanData.loan_name.trim()} - Cuota ${index + 1}/${totalInstallments}`,
        amount: installmentAmount,
        is_estimated: false,
        due_date: dueDate,
        expected_date: dueDate,
        priority: newLoanData.priority,
        status: index < paidInstallments ? "paid" : "planned",
        notes: newLoanData.notes.trim() || null,
      }));

      const { error: commitmentsError } = await supabase.from("cash_commitments").insert(commitmentPayload);
      if (commitmentsError) throw commitmentsError;

      setIsNewLoanOpen(false);
      setNewLoanData({
        lender_name: "",
        loan_name: "",
        principal_amount: "",
        installment_amount: "",
        total_installments: "",
        paid_installments: "0",
        first_due_date: new Date().toISOString().split("T")[0],
        frequency: "monthly",
        treasury_category_id: debtCategoryId,
        priority: "high",
        bank_account_id: "none",
        notes: "",
      });
      await fetchData();
    } catch (error: any) {
      console.error("Error creando credito bancario:", error);
      alert(`No se pudo guardar el crédito: ${error.message}`);
    } finally {
      setIsSavingLoan(false);
    }
  };

  const openLoanProgressDialog = (loan: (typeof loansWithStatus)[number]) => {
    setEditingLoan(loan);
    setLoanProgressPaid(String(loan.paidInstallments));
  };

  const handleSaveLoanProgress = async () => {
    if (!selectedEmpresaId || !editingLoan) return;

    const requestedPaidInstallments = Number(loanProgressPaid || 0);
    if (
      !Number.isInteger(requestedPaidInstallments) ||
      requestedPaidInstallments < 0 ||
      requestedPaidInstallments > editingLoan.total_installments
    ) {
      alert("Ingresa una cantidad válida de cuotas pagadas.");
      return;
    }

    const loanRelatedCommitments = loanCommitments
      .filter((commitment) => commitment.source_reference === editingLoan.id)
      .sort((a, b) => (a.expected_date || a.due_date).localeCompare(b.expected_date || b.due_date));

    const lockedPaidCommitments = loanRelatedCommitments.filter(
      (commitment) => commitment.status === "paid" && commitment.movimiento_banco_id
    );
    if (requestedPaidInstallments < lockedPaidCommitments.length) {
      alert(`Este crédito ya tiene ${lockedPaidCommitments.length} cuota(s) conciliada(s) en banco. No puedes dejar menos que eso.`);
      return;
    }

    const targetPaidIds = new Set(
      loanRelatedCommitments.slice(0, requestedPaidInstallments).map((commitment) => commitment.id)
    );
    const toMarkPaid = loanRelatedCommitments.filter(
      (commitment) => targetPaidIds.has(commitment.id) && commitment.status !== "paid"
    );
    const toReopen = loanRelatedCommitments.filter(
      (commitment) =>
        !targetPaidIds.has(commitment.id) &&
        commitment.status === "paid" &&
        !commitment.movimiento_banco_id
    );

    setSavingLoanProgress(true);
    try {
      if (toMarkPaid.length > 0) {
        const { error } = await supabase
          .from("cash_commitments")
          .update({ status: "paid" })
          .in("id", toMarkPaid.map((commitment) => commitment.id))
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      if (toReopen.length > 0) {
        const { error } = await supabase
          .from("cash_commitments")
          .update({ status: "planned" })
          .in("id", toReopen.map((commitment) => commitment.id))
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      const nextStatus =
        requestedPaidInstallments >= editingLoan.total_installments
          ? "completed"
          : editingLoan.status === "cancelled"
            ? "cancelled"
            : "active";
      const { error: loanError } = await supabase
        .from("bank_loans")
        .update({ status: nextStatus })
        .eq("id", editingLoan.id)
        .eq("empresa_id", selectedEmpresaId);
      if (loanError) throw loanError;

      setEditingLoan(null);
      await fetchData();
    } catch (error: any) {
      console.error("Error actualizando avance del credito:", error);
      alert(`No se pudo actualizar el avance del crédito: ${error.message}`);
    } finally {
      setSavingLoanProgress(false);
    }
  };

  const openEditDialog = (invoice: PurchaseInvoice) => {
    setEditingInvoice(invoice);
    setEditForm({
      treasury_category_id: invoice.treasury_category_id || suppliersCategoryId,
      treasury_priority: invoice.treasury_priority || "normal",
      preferred_bank_account_id: invoice.preferred_bank_account_id || "none",
      planned_cash_date: invoice.planned_cash_date || invoice.fecha_vencimiento || "",
      blocked_reason: invoice.blocked_reason || "",
    });
  };

  const handleSaveTreasury = async () => {
    if (!selectedEmpresaId || !editingInvoice) return;
    setSavingTreasury(true);
    try {
      const { error } = await supabase
        .from("facturas")
        .update({
          treasury_category_id: editForm.treasury_category_id || null,
          treasury_priority: editForm.treasury_priority,
          preferred_bank_account_id: editForm.preferred_bank_account_id === "none" ? null : editForm.preferred_bank_account_id,
          planned_cash_date: editForm.planned_cash_date || null,
          blocked_reason: editForm.blocked_reason || null,
        })
        .eq("id", editingInvoice.id)
        .eq("empresa_id", selectedEmpresaId);
      if (error) throw error;
      setEditingInvoice(null);
      await fetchData();
    } catch (error: any) {
      console.error("Error saving treasury data:", error);
      alert(`No se pudo guardar la metadata de tesorería: ${error.message}`);
    } finally {
      setSavingTreasury(false);
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Proveedores</CardTitle>
            <CardDescription>Selecciona una empresa para revisar la cola de pagos.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cuentas por pagar</h1>
          <p className="mt-1 text-muted-foreground">
            Registra deudas por pagar a proveedores y controla créditos bancarios activos con sus cuotas pendientes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setIsNewInvoiceOpen(true)} disabled={!canEdit}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva factura compra
          </Button>
          <Button variant="outline" onClick={() => setIsNewLoanOpen(true)} disabled={!canEdit}>
            <Landmark className="mr-2 h-4 w-4" />
            Nuevo crédito
          </Button>
          <Button variant="outline" onClick={() => setIsNewProvOpen(true)} disabled={!canEdit}>
            Nuevo proveedor
          </Button>
        </div>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar la cola de pagos y los créditos, pero no modificar datos.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Proveedores activos" value={String(proveedores.length)} description="Base de contrapartes" />
        <SummaryCard title="Deuda abierta" value={formatTreasuryCurrency(totals.outstanding)} description="Facturas de compra pendientes o morosas" />
        <SummaryCard title="Pagar en 7 días" value={formatTreasuryCurrency(totals.dueSoon)} description="Según planned cash date" tone="warning" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Créditos activos" value={String(loanTotals.activeLoans)} description="Entidades financieras registradas" />
        <SummaryCard title="Cuotas pendientes" value={String(loanTotals.remainingInstallments)} description="Compromisos de deuda por conciliar" />
        <SummaryCard title="Deuda bancaria abierta" value={formatTreasuryCurrency(loanTotals.outstandingAmount)} description="Saldo futuro aún no pagado" tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Créditos bancarios</CardTitle>
              <CardDescription>
                Cada crédito genera sus cuotas como egresos de deuda para que aparezcan automáticamente en Banco y Flujo de Caja.
              </CardDescription>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              Cuotas restantes y próxima fecha se calculan desde las conciliaciones reales.
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Crédito</TableHead>
                <TableHead>Entidad</TableHead>
                <TableHead>Cuota</TableHead>
                <TableHead>Cuotas</TableHead>
                <TableHead>Próxima cuota</TableHead>
                <TableHead>Cuenta / categoría</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loansWithStatus.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    <div className="font-medium">{loan.loan_name}</div>
                    <div className="text-sm text-muted-foreground">
                      Principal {formatTreasuryCurrency(loan.principal_amount)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{loan.lender_name}</div>
                    <div className="text-sm text-muted-foreground">{frequencyLabels[loan.frequency]}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{formatTreasuryCurrency(loan.installment_amount)}</div>
                    <div className="text-sm text-muted-foreground">
                      Pagado {formatTreasuryCurrency(loan.paidAmount)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {loan.remainingInstallments} pendientes de {loan.total_installments}
                    </div>
                    <div className="text-sm text-muted-foreground">{loan.paidInstallments} pagadas</div>
                  </TableCell>
                  <TableCell>
                    <div>{formatTreasuryDate(loan.nextInstallmentDate)}</div>
                    <div className="text-sm text-muted-foreground">
                      Saldo abierto {formatTreasuryCurrency(loan.outstandingAmount)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{accountsById.get(loan.bank_account_id || "") || "Sin cuenta sugerida"}</div>
                    <div className="text-sm text-muted-foreground">
                      {categoriesById.get(loan.treasury_category_id || "") || "Sin categoría"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        loan.derivedStatus === "active" && "border-blue-200 bg-blue-50 text-blue-700",
                        loan.derivedStatus === "completed" && "border-emerald-200 bg-emerald-50 text-emerald-700",
                        loan.derivedStatus === "cancelled" && "border-slate-200 bg-slate-50 text-slate-700"
                      )}
                    >
                      {loan.derivedStatus === "active" ? "Activo" : loan.derivedStatus === "completed" ? "Completado" : "Cancelado"}
                    </Badge>
                    <div className="mt-2">
                      <Button size="sm" variant="outline" disabled={!canEdit || loan.status === "cancelled"} onClick={() => openLoanProgressDialog(loan)}>
                        Editar avance
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && loansWithStatus.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No hay créditos bancarios registrados todavía.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Deudas con proveedores</CardTitle>
              <CardDescription>Facturas abiertas y metadata de pago por proveedor.</CardDescription>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar proveedor, RUT o folio..."
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && groupedSuppliers.length === 0 && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {groupedSuppliers.map((supplier) => (
            <div key={supplier.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="font-medium">{supplier.razon_social}</div>
                  <div className="text-sm text-muted-foreground">
                    {supplier.rut} • {supplier.email || "sin email"} • {supplier.telefono || "sin teléfono"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{formatTreasuryCurrency(supplier.outstanding)}</Badge>
                  {supplier.dueSoon > 0 && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{supplier.dueSoon} por vencer</Badge>}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {supplier.supplierInvoices.length === 0 && (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Sin facturas abiertas.
                  </div>
                )}
                {supplier.supplierInvoices.map((invoice) => (
                  <div key={invoice.id} className="rounded-xl border bg-muted/15 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.9fr_1fr]">
                      <div>
                        <div className="font-medium">Factura {invoice.numero_documento || "Sin folio"}</div>
                        <div className="text-sm text-muted-foreground">
                          Emisión {formatTreasuryDate(invoice.fecha_emision)} • vence {formatTreasuryDate(invoice.fecha_vencimiento)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Monto</div>
                        <div className="font-semibold">{formatTreasuryCurrency(invoice.monto)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Pago esperado</div>
                        <div>{formatTreasuryDate(invoice.planned_cash_date)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Prioridad</div>
                        <Badge variant="outline" className={cn("capitalize", PRIORITY_BADGE_CLASSES[invoice.treasury_priority || "normal"])}>
                          {PRIORITY_LABELS[invoice.treasury_priority || "normal"]}
                        </Badge>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Cuenta / categoría</div>
                        <div>{accountsById.get(invoice.preferred_bank_account_id || "") || "Sin cuenta"}</div>
                        <div className="text-sm text-muted-foreground">{categoriesById.get(invoice.treasury_category_id || "") || "Sin categoría"}</div>
                      </div>
                      <div className="flex flex-col items-start gap-2 lg:items-end">
                        <div className="text-sm">{invoice.blocked_reason || "Sin bloqueo"}</div>
                        <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => openEditDialog(invoice)}>
                          Editar tesorería
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!loading && groupedSuppliers.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              No se encontraron proveedores para el filtro actual.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isNewProvOpen} onOpenChange={setIsNewProvOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo proveedor</DialogTitle>
            <DialogDescription>Alta manual de proveedor activo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="RUT">
              <Input value={newProvData.rut} onChange={(event) => setNewProvData((current) => ({ ...current, rut: event.target.value }))} />
            </Field>
            <Field label="Razón social">
              <Input value={newProvData.razon_social} onChange={(event) => setNewProvData((current) => ({ ...current, razon_social: event.target.value }))} />
            </Field>
            <Field label="Email">
              <Input value={newProvData.email} onChange={(event) => setNewProvData((current) => ({ ...current, email: event.target.value }))} />
            </Field>
            <Field label="Teléfono">
              <Input value={newProvData.telefono} onChange={(event) => setNewProvData((current) => ({ ...current, telefono: event.target.value }))} />
            </Field>
            <Field label="Dirección">
              <Input value={newProvData.direccion} onChange={(event) => setNewProvData((current) => ({ ...current, direccion: event.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewProvOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateProvManual} disabled={isSavingProv}>
              {isSavingProv ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNewInvoiceOpen} onOpenChange={setIsNewInvoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva factura de compra</DialogTitle>
            <DialogDescription>Se crea con metadata base de tesorería.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Proveedor">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={newInvoiceData.tercero_id}
                onChange={(event) => setNewInvoiceData((current) => ({ ...current, tercero_id: event.target.value }))}
              >
                <option value="">Selecciona un proveedor</option>
                {proveedores.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.razon_social}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha emisión">
              <Input type="date" value={newInvoiceData.fecha_emision} onChange={(event) => setNewInvoiceData((current) => ({ ...current, fecha_emision: event.target.value }))} />
            </Field>
            <Field label="Fecha vencimiento">
              <Input type="date" value={newInvoiceData.fecha_vencimiento} onChange={(event) => setNewInvoiceData((current) => ({ ...current, fecha_vencimiento: event.target.value, planned_cash_date: event.target.value }))} />
            </Field>
            <Field label="Número documento">
              <Input value={newInvoiceData.numero_documento} onChange={(event) => setNewInvoiceData((current) => ({ ...current, numero_documento: event.target.value }))} />
            </Field>
            <Field label="Monto">
              <Input type="number" min="0" value={newInvoiceData.monto} onChange={(event) => setNewInvoiceData((current) => ({ ...current, monto: event.target.value }))} />
            </Field>
            <Field label="Categoría tesorería">
              <Select value={newInvoiceData.treasury_category_id || suppliersCategoryId || ""} onValueChange={(value) => setNewInvoiceData((current) => ({ ...current, treasury_category_id: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona categoría" />
                </SelectTrigger>
                <SelectContent>
                  {treasuryCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Prioridad">
              <Select value={newInvoiceData.treasury_priority} onValueChange={(value) => setNewInvoiceData((current) => ({ ...current, treasury_priority: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critica</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="deferrable">Postergable</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cuenta preferida">
              <Select value={newInvoiceData.preferred_bank_account_id} onValueChange={(value) => setNewInvoiceData((current) => ({ ...current, preferred_bank_account_id: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cuenta</SelectItem>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha esperada de pago">
              <Input type="date" value={newInvoiceData.planned_cash_date} onChange={(event) => setNewInvoiceData((current) => ({ ...current, planned_cash_date: event.target.value }))} />
            </Field>
            <Field label="Nota / bloqueo">
              <Textarea value={newInvoiceData.blocked_reason} onChange={(event) => setNewInvoiceData((current) => ({ ...current, blocked_reason: event.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewInvoiceOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateCompraInvoice} disabled={isSavingInvoice}>
              {isSavingInvoice ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear factura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNewLoanOpen} onOpenChange={setIsNewLoanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo crédito bancario</DialogTitle>
            <DialogDescription>
              El sistema generará todas las cuotas como egresos de deuda para conciliarlas desde Banco a medida que se paguen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Entidad financiera">
              <Input value={newLoanData.lender_name} onChange={(event) => setNewLoanData((current) => ({ ...current, lender_name: event.target.value }))} />
            </Field>
            <Field label="Nombre / referencia del crédito">
              <Input value={newLoanData.loan_name} onChange={(event) => setNewLoanData((current) => ({ ...current, loan_name: event.target.value }))} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Monto crédito">
                <Input type="number" min="0" value={newLoanData.principal_amount} onChange={(event) => setNewLoanData((current) => ({ ...current, principal_amount: event.target.value }))} />
              </Field>
              <Field label="Monto cuota">
                <Input type="number" min="0" value={newLoanData.installment_amount} onChange={(event) => setNewLoanData((current) => ({ ...current, installment_amount: event.target.value }))} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Total cuotas">
                <Input type="number" min="1" value={newLoanData.total_installments} onChange={(event) => setNewLoanData((current) => ({ ...current, total_installments: event.target.value }))} />
              </Field>
              <Field label="Cuotas ya pagadas">
                <Input type="number" min="0" value={newLoanData.paid_installments} onChange={(event) => setNewLoanData((current) => ({ ...current, paid_installments: event.target.value }))} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Primera cuota">
                <Input type="date" value={newLoanData.first_due_date} onChange={(event) => setNewLoanData((current) => ({ ...current, first_due_date: event.target.value }))} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Frecuencia">
                <Select value={newLoanData.frequency} onValueChange={(value) => setNewLoanData((current) => ({ ...current, frequency: value as LoanFrequency }))}>
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
              </Field>
              <Field label="Prioridad">
                <Select value={newLoanData.priority} onValueChange={(value) => setNewLoanData((current) => ({ ...current, priority: value as LoanPriority }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critica</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="deferrable">Postergable</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Cuenta bancaria sugerida">
              <Select value={newLoanData.bank_account_id} onValueChange={(value) => setNewLoanData((current) => ({ ...current, bank_account_id: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cuenta</SelectItem>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Categoría tesorería">
              <Select value={newLoanData.treasury_category_id || debtCategoryId || ""} onValueChange={(value) => setNewLoanData((current) => ({ ...current, treasury_category_id: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona categoría" />
                </SelectTrigger>
                <SelectContent>
                  {treasuryCategories.filter((category) => category.directionScope !== "inflow").map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Notas">
              <Textarea value={newLoanData.notes} onChange={(event) => setNewLoanData((current) => ({ ...current, notes: event.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewLoanOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateBankLoan} disabled={isSavingLoan}>
              {isSavingLoan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear crédito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingLoan)} onOpenChange={(open) => !open && setEditingLoan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar avance del crédito</DialogTitle>
            <DialogDescription>
              {editingLoan
                ? `${editingLoan.loan_name} • ${editingLoan.lender_name}. Ajusta en qué cuota va realmente el crédito.`
                : "Actualiza cuotas pagadas."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editingLoan && (
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <div>Cuotas totales: <span className="font-medium">{editingLoan.total_installments}</span></div>
                <div>Pagadas hoy: <span className="font-medium">{editingLoan.paidInstallments}</span></div>
                <div>Pendientes: <span className="font-medium">{editingLoan.remainingInstallments}</span></div>
              </div>
            )}
            <Field label="Cuotas pagadas">
              <Input type="number" min="0" value={loanProgressPaid} onChange={(event) => setLoanProgressPaid(event.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">
              Esto marca cuotas históricas como pagadas para dejar el crédito en el punto real. Las cuotas ya conciliadas en banco no se modificarán.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLoan(null)}>Cancelar</Button>
            <Button onClick={handleSaveLoanProgress} disabled={savingLoanProgress}>
              {savingLoanProgress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar avance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingInvoice)} onOpenChange={(open) => !open && setEditingInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar tesorería de factura</DialogTitle>
            <DialogDescription>
              {editingInvoice ? `Factura ${editingInvoice.numero_documento || "sin folio"} • ${editingInvoice.tercero_nombre}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Categoría">
              <Select value={editForm.treasury_category_id} onValueChange={(value) => setEditForm((current) => ({ ...current, treasury_category_id: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {treasuryCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Prioridad">
              <Select value={editForm.treasury_priority} onValueChange={(value) => setEditForm((current) => ({ ...current, treasury_priority: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critica</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="deferrable">Postergable</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cuenta preferida">
              <Select value={editForm.preferred_bank_account_id} onValueChange={(value) => setEditForm((current) => ({ ...current, preferred_bank_account_id: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cuenta</SelectItem>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha esperada de pago">
              <Input type="date" value={editForm.planned_cash_date} onChange={(event) => setEditForm((current) => ({ ...current, planned_cash_date: event.target.value }))} />
            </Field>
            <Field label="Nota / bloqueo">
              <Textarea value={editForm.blocked_reason} onChange={(event) => setEditForm((current) => ({ ...current, blocked_reason: event.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingInvoice(null)}>Cancelar</Button>
            <Button onClick={handleSaveTreasury} disabled={savingTreasury}>
              {savingTreasury ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
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
    <Card className={tone === "warning" ? "border-amber-200" : undefined}>
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

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
