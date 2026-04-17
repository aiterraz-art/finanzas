import { type FormEvent, useMemo, useState } from "react";
import { Archive, ArrowRightLeft, Landmark, Loader2, Plus, RefreshCcw, TrendingUp, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  useBankAccountPositions,
  useBankAccounts,
  useCashCommitments,
  usePaymentQueue,
  useTreasuryCategories,
  useTreasuryKpis,
  useTreasuryOpenItems,
  useTreasuryPolicy,
} from "@/hooks/useTreasury";
import {
  PRIORITY_BADGE_CLASSES,
  PRIORITY_LABELS,
  canEditTreasury,
  formatTreasuryCurrency,
  formatTreasuryDate,
} from "@/lib/treasury";
import type { CashCommitment, PaymentQueueItem, TreasuryPriority } from "@/lib/treasury";
import { cn } from "@/lib/utils";

const today = new Date().toISOString().split("T")[0];
const currentMonth = today.slice(0, 7);

const addDaysIso = (days: number) => {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString().split("T")[0];
};

const openStatuses = new Set(["planned", "confirmed", "deferred"]);

const sourceLabels: Record<string, string> = {
  invoice_payable: "Factura proveedor",
  rendicion: "Rendición",
  commitment: "Compromiso",
};

const commitmentTypeLabels: Record<CashCommitment["sourceType"], string> = {
  manual: "Manual",
  template: "Plantilla",
  tax: "Impuesto",
  payroll: "Nómina",
  debt: "Deuda",
  capex: "Capex",
};

const statusLabels: Record<CashCommitment["status"], string> = {
  planned: "Planificado",
  confirmed: "Confirmado",
  paid: "Pagado",
  cancelled: "Cancelado",
  deferred: "Diferido",
};

type ManualExpenseForm = {
  description: string;
  counterparty: string;
  categoryId: string;
  sourceType: CashCommitment["sourceType"];
  amount: string;
  dueDate: string;
  expectedDate: string;
  priority: TreasuryPriority;
  bankAccountId: string;
  notes: string;
  status: CashCommitment["status"];
  isEstimated: string;
};

type QueueEditForm = {
  expectedDate: string;
  dueDate: string;
  priority: TreasuryPriority;
  bankAccountId: string;
  notes: string;
  status: CashCommitment["status"];
};

const createManualExpenseForm = (): ManualExpenseForm => ({
  description: "",
  counterparty: "",
  categoryId: "",
  sourceType: "manual",
  amount: "",
  dueDate: today,
  expectedDate: today,
  priority: "normal",
  bankAccountId: "none",
  notes: "",
  status: "planned",
  isEstimated: "false",
});

export default function Egresos() {
  const { selectedEmpresa, selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [analysisMonth, setAnalysisMonth] = useState(currentMonth);
  const [manualForm, setManualForm] = useState<ManualExpenseForm>(createManualExpenseForm());
  const [generateUntil, setGenerateUntil] = useState(addDaysIso(90));
  const [savingManual, setSavingManual] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingItem, setEditingItem] = useState<PaymentQueueItem | null>(null);
  const [editForm, setEditForm] = useState<QueueEditForm>({
    expectedDate: today,
    dueDate: today,
    priority: "normal",
    bankAccountId: "none",
    notes: "",
    status: "planned",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: policy } = useTreasuryPolicy(selectedEmpresaId);
  const { data: paymentQueue, loading: loadingQueue, refresh: refreshQueue } = usePaymentQueue(selectedEmpresaId, today);
  const { data: openItems, refresh: refreshOpenItems } = useTreasuryOpenItems(selectedEmpresaId);
  const { data: commitments, loading: loadingCommitments, refresh: refreshCommitments } = useCashCommitments(selectedEmpresaId);
  const { data: categories } = useTreasuryCategories(selectedEmpresaId);
  const { data: bankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: bankPositions, refresh: refreshPositions } = useBankAccountPositions(selectedEmpresaId);
  const { data: kpis, refresh: refreshKpis } = useTreasuryKpis(selectedEmpresaId, today);

  const outflowCategories = useMemo(
    () => categories.filter((category) => category.active && category.directionScope !== "inflow"),
    [categories]
  );

  const bankAccountMap = useMemo(() => new Map(bankAccounts.map((account) => [account.id, account])), [bankAccounts]);
  const openItemMap = useMemo(
    () =>
      new Map(
        openItems
          .filter((item) => item.direction === "outflow")
          .map((item) => [`${item.sourceType}:${item.sourceId}`, item] as const)
      ),
    [openItems]
  );
  const commitmentMap = useMemo(() => new Map(commitments.map((item) => [item.id, item])), [commitments]);
  const outflowOpenItems = useMemo(
    () => openItems.filter((item) => item.direction === "outflow"),
    [openItems]
  );

  const filteredQueue = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return paymentQueue.filter((item) => {
      if (sourceFilter !== "all" && item.sourceType !== sourceFilter) return false;
      if (priorityFilter !== "all" && item.priority !== priorityFilter) return false;
      if (assignmentFilter === "assigned" && !item.bankAccountId) return false;
      if (assignmentFilter === "unassigned" && item.bankAccountId) return false;
      if (categoryFilter !== "all" && item.categoryCode !== categoryFilter) return false;
      if (!searchTerm) return true;
      return [
        item.counterparty,
        item.categoryName,
        item.suggestedAction,
        sourceLabels[item.sourceType] || item.sourceType,
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });
  }, [assignmentFilter, categoryFilter, paymentQueue, priorityFilter, search, sourceFilter]);

  const monthlyCategorySummary = useMemo(() => {
    const baseItems = outflowOpenItems.filter((item) =>
      analysisMonth ? item.expectedDate?.slice(0, 7) === analysisMonth : true
    );
    const summaryMap = new Map<
      string,
      {
        categoryCode: string;
        categoryName: string;
        totalAmount: number;
        itemCount: number;
        criticalAmount: number;
        next7dAmount: number;
        next7dCount: number;
      }
    >();
    const limit = addDaysIso(7);

    for (const item of baseItems) {
      const key = item.categoryCode || item.categoryName || "other_outflow";
      const current = summaryMap.get(key) || {
        categoryCode: item.categoryCode,
        categoryName: item.categoryName || "Sin categoría",
        totalAmount: 0,
        itemCount: 0,
        criticalAmount: 0,
        next7dAmount: 0,
        next7dCount: 0,
      };

      current.totalAmount += item.amount;
      current.itemCount += 1;
      if (item.priority === "critical") {
        current.criticalAmount += item.amount;
      }
      if (item.expectedDate && item.expectedDate <= limit) {
        current.next7dAmount += item.amount;
        current.next7dCount += 1;
      }

      summaryMap.set(key, current);
    }

    return Array.from(summaryMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [analysisMonth, outflowOpenItems]);

  const topCategory = monthlyCategorySummary[0] || null;
  const topThreeCategoryShare = useMemo(() => {
    const total = monthlyCategorySummary.reduce((sum, item) => sum + item.totalAmount, 0);
    if (total <= 0) return 0;
    return monthlyCategorySummary.slice(0, 3).reduce((sum, item) => sum + item.totalAmount, 0) / total;
  }, [monthlyCategorySummary]);

  const openCommitments = useMemo(
    () => commitments.filter((item) => openStatuses.has(item.status)),
    [commitments]
  );

  const nextSevenDaysTotal = useMemo(() => {
    const limit = addDaysIso(7);
    return paymentQueue
      .filter((item) => item.expectedDate && item.expectedDate <= limit)
      .reduce((sum, item) => sum + item.amount, 0);
  }, [paymentQueue]);

  const manualExposure = useMemo(
    () =>
      openCommitments
        .filter((item) => item.sourceType === "manual")
        .reduce((sum, item) => sum + item.amount, 0),
    [openCommitments]
  );

  const missingAccountCount = useMemo(
    () => paymentQueue.filter((item) => !item.bankAccountId).length,
    [paymentQueue]
  );

  const refreshAll = async () => {
    await Promise.all([
      refreshQueue(),
      refreshOpenItems(),
      refreshCommitments(),
      refreshPositions(),
      refreshKpis(),
    ]);
  };

  const handleCreateManualExpense = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedEmpresaId || !canEdit) return;
    if (!manualForm.description || !manualForm.categoryId || !manualForm.amount) {
      alert("Descripción, categoría y monto son obligatorios.");
      return;
    }

    setSavingManual(true);
    try {
      const { error } = await supabase.from("cash_commitments").insert({
        empresa_id: selectedEmpresaId,
        template_id: null,
        bank_account_id: manualForm.bankAccountId === "none" ? null : manualForm.bankAccountId,
        category_id: manualForm.categoryId,
        source_type: manualForm.sourceType,
        source_reference: null,
        direction: "outflow",
        counterparty: manualForm.counterparty || null,
        description: manualForm.description,
        amount: Number(manualForm.amount || 0),
        is_estimated: manualForm.isEstimated === "true",
        due_date: manualForm.dueDate,
        expected_date: manualForm.expectedDate || manualForm.dueDate,
        priority: manualForm.priority,
        status: manualForm.status,
        notes: manualForm.notes || null,
      });
      if (error) throw error;

      setManualForm(createManualExpenseForm());
      await refreshAll();
    } catch (err: any) {
      console.error("Error creating cash commitment:", err);
      alert(err.message || "No se pudo crear el egreso manual.");
    } finally {
      setSavingManual(false);
    }
  };

  const handleGenerateCommitments = async () => {
    if (!selectedEmpresaId || !canEdit) return;
    setGenerating(true);
    try {
      const { error } = await supabase.rpc("generate_cash_commitments", {
        p_empresa_id: selectedEmpresaId,
        p_until_date: generateUntil,
      });
      if (error) throw error;
      await refreshAll();
    } catch (err: any) {
      console.error("Error generating commitments:", err);
      alert(err.message || "No se pudieron generar compromisos desde plantillas.");
    } finally {
      setGenerating(false);
    }
  };

  const openEditDialog = (item: PaymentQueueItem) => {
    const openItem = openItemMap.get(`${item.sourceType}:${item.sourceId}`);
    const commitment = item.sourceType === "commitment" ? commitmentMap.get(item.sourceId) : null;
    setEditingItem(item);
    setEditForm({
      expectedDate: item.expectedDate || today,
      dueDate: openItem?.dueDate || item.dueDate || today,
      priority: item.priority,
      bankAccountId: item.bankAccountId || "none",
      notes: commitment?.notes || item.notes || "",
      status: commitment?.status || "planned",
    });
  };

  const handleSaveQueueEdit = async () => {
    if (!selectedEmpresaId || !editingItem || !canEdit) return;
    setSavingEdit(true);
    try {
      if (editingItem.sourceType === "commitment") {
        const { error } = await supabase
          .from("cash_commitments")
          .update({
            expected_date: editForm.expectedDate,
            due_date: editForm.dueDate,
            priority: editForm.priority,
            bank_account_id: editForm.bankAccountId === "none" ? null : editForm.bankAccountId,
            notes: editForm.notes || null,
            status: editForm.status,
          })
          .eq("id", editingItem.sourceId)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      if (editingItem.sourceType === "invoice_payable") {
        const { error } = await supabase
          .from("facturas")
          .update({
            planned_cash_date: editForm.expectedDate,
            treasury_priority: editForm.priority,
            preferred_bank_account_id: editForm.bankAccountId === "none" ? null : editForm.bankAccountId,
            blocked_reason: editForm.notes || null,
          })
          .eq("id", editingItem.sourceId)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      if (editingItem.sourceType === "rendicion") {
        const { error } = await supabase
          .from("rendiciones")
          .update({
            planned_cash_date: editForm.expectedDate,
            treasury_priority: editForm.priority,
            preferred_bank_account_id: editForm.bankAccountId === "none" ? null : editForm.bankAccountId,
          })
          .eq("id", editingItem.sourceId)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw error;
      }

      setEditingItem(null);
      await refreshAll();
    } catch (err: any) {
      console.error("Error updating queue item:", err);
      alert(err.message || "No se pudo actualizar el egreso.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleArchiveManualCommitment = async (item: PaymentQueueItem | CashCommitment) => {
    if (!selectedEmpresaId || !canEdit || !user?.id) return;
    const commitmentId = "sourceId" in item ? item.sourceId : item.id;
    const sourceType = item.sourceType;
    const description = "description" in item ? item.description : item.counterparty;
    if (sourceType !== "manual") {
      alert("Solo los egresos manuales pueden archivarse desde esta vista.");
      return;
    }

    const confirmed = window.confirm(
      `Se archivará "${description}". El registro no se elimina físicamente, pero deja de aparecer en la operación diaria.`
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("cash_commitments")
        .update({
          status: "cancelled",
          archived_at: new Date().toISOString(),
          archived_by: user.id,
          archive_reason: "Archivado manualmente desde módulo Egresos",
        })
        .eq("id", commitmentId)
        .eq("empresa_id", selectedEmpresaId)
        .is("archived_at", null);
      if (error) throw error;
      if (editingItem?.sourceType === "commitment" && editingItem.sourceId === commitmentId) {
        setEditingItem(null);
      }
      await refreshAll();
    } catch (err: any) {
      console.error("Error archiving manual cash commitment:", err);
      alert(err.message || "No se pudo archivar el egreso manual.");
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Egresos sin empresa activa</CardTitle>
            <CardDescription>Selecciona una empresa para registrar compromisos y controlar la salida de caja.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Egresos</h1>
          <p className="mt-1 text-muted-foreground">
            Cola unificada de pagos y compromisos para {selectedEmpresa?.nombre || "la empresa"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/cashflow">
              <TrendingUp className="mr-2 h-4 w-4" />
              Ver Tesorería
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/reconciliation">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Ir a Banco
            </Link>
          </Button>
          <Button variant="outline" onClick={refreshAll}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refrescar
          </Button>
        </div>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar la cola de pagos, pero no crear ni editar egresos.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Egresos abiertos"
          value={formatTreasuryCurrency(paymentQueue.reduce((sum, item) => sum + item.amount, 0), policy.monedaBase)}
          description={`${paymentQueue.length} pagos en cola`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          title="Próximos 7 días"
          value={formatTreasuryCurrency(nextSevenDaysTotal, policy.monedaBase)}
          description="Salidas esperadas en la semana"
          icon={<TrendingUp className="h-4 w-4" />}
          tone="warning"
        />
        <MetricCard
          title="Compromisos manuales"
          value={formatTreasuryCurrency(manualExposure, policy.monedaBase)}
          description={`${openCommitments.filter((item) => item.sourceType === "manual").length} registros abiertos`}
          icon={<Plus className="h-4 w-4" />}
        />
        <MetricCard
          title="Sin cuenta asignada"
          value={String(missingAccountCount)}
          description={`Caja actual ${formatTreasuryCurrency(kpis.currentCash, policy.monedaBase)}`}
          icon={<Landmark className="h-4 w-4" />}
          tone={missingAccountCount > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Resumen por clasificación</CardTitle>
            <CardDescription>
              Lectura rápida de los egresos abiertos del mes para decidir sobre nómina, oficina, impuestos y otros rubros.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label>Mes de análisis</Label>
              <Input type="month" value={analysisMonth} onChange={(event) => setAnalysisMonth(event.target.value)} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title="Mayor rubro del mes"
              value={topCategory ? topCategory.categoryName : "Sin datos"}
              description={
                topCategory
                  ? formatTreasuryCurrency(topCategory.totalAmount, policy.monedaBase)
                  : "No hay egresos abiertos en el mes"
              }
              icon={<Wallet className="h-4 w-4" />}
            />
            <MetricCard
              title="Próximos 7 días"
              value={formatTreasuryCurrency(
                monthlyCategorySummary.reduce((sum, item) => sum + item.next7dAmount, 0),
                policy.monedaBase
              )}
              description={`${monthlyCategorySummary.reduce((sum, item) => sum + item.next7dCount, 0)} pago(s) del período`}
              tone="warning"
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <MetricCard
              title="Concentración top 3"
              value={`${Math.round(topThreeCategoryShare * 100)}%`}
              description="Participación de las 3 clasificaciones más pesadas"
              icon={<Landmark className="h-4 w-4" />}
            />
          </div>

          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clasificación</TableHead>
                  <TableHead className="text-right">Monto abierto</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Crítico</TableHead>
                  <TableHead className="text-right">Próx. 7 días</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthlyCategorySummary.map((item) => (
                  <TableRow key={item.categoryCode || item.categoryName}>
                    <TableCell className="font-medium">{item.categoryName}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatTreasuryCurrency(item.totalAmount, policy.monedaBase)}
                    </TableCell>
                    <TableCell className="text-right">{item.itemCount}</TableCell>
                    <TableCell className="text-right">
                      {item.criticalAmount > 0 ? formatTreasuryCurrency(item.criticalAmount, policy.monedaBase) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.next7dAmount > 0 ? formatTreasuryCurrency(item.next7dAmount, policy.monedaBase) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {monthlyCategorySummary.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No hay egresos abiertos para el mes seleccionado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Registrar egreso manual</CardTitle>
            <CardDescription>
              Usa esta alta para impuestos, nómina, arriendos, servicios o cualquier salida sin factura proveedor.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateManualExpense}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>Descripción</Label>
                  <Input
                    value={manualForm.description}
                    onChange={(event) => setManualForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="IVA abril, arriendo oficina, software, remuneraciones..."
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contraparte</Label>
                  <Input
                    value={manualForm.counterparty}
                    onChange={(event) => setManualForm((current) => ({ ...current, counterparty: event.target.value }))}
                    placeholder="SII, Previred, arrendador, proveedor"
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo de egreso</Label>
                  <Select
                    value={manualForm.sourceType}
                    onValueChange={(value) =>
                      setManualForm((current) => ({ ...current, sourceType: value as CashCommitment["sourceType"] }))
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="tax">Impuesto</SelectItem>
                      <SelectItem value="payroll">Nómina</SelectItem>
                      <SelectItem value="debt">Deuda</SelectItem>
                      <SelectItem value="capex">Capex</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Categoría</Label>
                  <Select
                    value={manualForm.categoryId}
                    onValueChange={(value) => setManualForm((current) => ({ ...current, categoryId: value }))}
                    disabled={!canEdit}
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
                  <Label>Monto</Label>
                  <Input
                    type="number"
                    min="0"
                    value={manualForm.amount}
                    onChange={(event) => setManualForm((current) => ({ ...current, amount: event.target.value }))}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cuenta sugerida</Label>
                  <Select
                    value={manualForm.bankAccountId}
                    onValueChange={(value) => setManualForm((current) => ({ ...current, bankAccountId: value }))}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin cuenta asignada</SelectItem>
                      {bankAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha vencimiento</Label>
                  <Input
                    type="date"
                    value={manualForm.dueDate}
                    onChange={(event) => setManualForm((current) => ({ ...current, dueDate: event.target.value }))}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fecha esperada de pago</Label>
                  <Input
                    type="date"
                    value={manualForm.expectedDate}
                    onChange={(event) => setManualForm((current) => ({ ...current, expectedDate: event.target.value }))}
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Prioridad</Label>
                  <Select
                    value={manualForm.priority}
                    onValueChange={(value) =>
                      setManualForm((current) => ({ ...current, priority: value as TreasuryPriority }))
                    }
                    disabled={!canEdit}
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
                  <Label>Estado inicial</Label>
                  <Select
                    value={manualForm.status}
                    onValueChange={(value) =>
                      setManualForm((current) => ({ ...current, status: value as CashCommitment["status"] }))
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planned">Planificado</SelectItem>
                      <SelectItem value="confirmed">Confirmado</SelectItem>
                      <SelectItem value="deferred">Diferido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>¿Es estimado?</Label>
                  <Select
                    value={manualForm.isEstimated}
                    onValueChange={(value) => setManualForm((current) => ({ ...current, isEstimated: value }))}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">No, es definitivo</SelectItem>
                      <SelectItem value="true">Sí, aún estimado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Nota de tesorería</Label>
                  <Textarea
                    value={manualForm.notes}
                    onChange={(event) => setManualForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Condiciones de pago, restricción de caja, negociación, contexto..."
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="text-sm text-muted-foreground">
                  Este registro alimenta Tesorería de forma inmediata y luego se concilia desde Banco.
                </div>
                <Button type="submit" disabled={!canEdit || savingManual}>
                  {savingManual ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Guardar egreso
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Compromisos recurrentes</CardTitle>
              <CardDescription>
                Genera IVA, nómina, servicios y otros pagos futuros desde plantillas configuradas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <Label>Generar hasta</Label>
                  <Input type="date" value={generateUntil} onChange={(event) => setGenerateUntil(event.target.value)} disabled={!canEdit} />
                </div>
                <div className="flex items-end">
                  <Button className="w-full" onClick={handleGenerateCommitments} disabled={!canEdit || generating}>
                    {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Generar desde plantillas
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                Si una obligación recurrente no aparece aquí, configúrala primero en <Link to="/settings" className="font-medium text-primary">Configuración</Link>.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Integración con Banco</CardTitle>
              <CardDescription>La programación se vuelve real cuando la cartola está al día y los movimientos se concilian.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {bankPositions.map((position) => (
                <div key={position.bankAccountId} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{position.accountName}</div>
                      <div className="text-sm text-muted-foreground">
                        {position.banco} • última cartola {formatTreasuryDate(position.latestStatementDate, "Sin importación")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatTreasuryCurrency(position.currentBalance, position.moneda)}</div>
                      <div className="text-xs text-muted-foreground">
                        {position.unreconciledCount} sin conciliar
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {bankPositions.length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  No hay cuentas bancarias activas para esta empresa.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Cola unificada de egresos</CardTitle>
            <CardDescription>
              Facturas proveedor, rendiciones y compromisos manuales en una sola vista operativa.
            </CardDescription>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar contraparte, clasificación o acción..." />
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los orígenes</SelectItem>
                <SelectItem value="invoice_payable">Facturas proveedor</SelectItem>
                <SelectItem value="rendicion">Rendiciones</SelectItem>
                <SelectItem value="commitment">Compromisos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las prioridades</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="deferrable">Postergable</SelectItem>
              </SelectContent>
            </Select>
            <Select value={assignmentFilter} onValueChange={setAssignmentFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las cuentas</SelectItem>
                <SelectItem value="assigned">Con cuenta asignada</SelectItem>
                <SelectItem value="unassigned">Sin cuenta asignada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las clasificaciones</SelectItem>
                {outflowCategories.map((category) => (
                  <SelectItem key={category.id} value={category.code}>
                    {category.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
                <TableRow>
                  <TableHead>Contraparte</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Clasificación</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Pago esperado</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Acción sugerida</TableHead>
                <TableHead className="text-right">Gestión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredQueue.map((item) => (
                <TableRow key={`${item.sourceType}-${item.sourceId}`}>
                  <TableCell className="font-medium">{item.counterparty}</TableCell>
                  <TableCell>{sourceLabels[item.sourceType] || item.sourceType}</TableCell>
                  <TableCell>
                    <div className="font-medium">{item.categoryName}</div>
                    <div className="text-xs text-muted-foreground">{item.categoryCode}</div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatTreasuryCurrency(item.amount, policy.monedaBase)}</TableCell>
                  <TableCell>{formatTreasuryDate(item.dueDate)}</TableCell>
                  <TableCell>{formatTreasuryDate(item.expectedDate)}</TableCell>
                  <TableCell>{item.bankAccountId ? bankAccountMap.get(item.bankAccountId)?.nombre || "Cuenta" : "Sin cuenta"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(PRIORITY_BADGE_CLASSES[item.priority])}>
                      {PRIORITY_LABELS[item.priority]}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[240px]">
                    <div className="font-medium">{item.suggestedAction}</div>
                    {item.notes && <div className="mt-1 text-xs text-muted-foreground">{item.notes}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(item)} disabled={!canEdit}>
                        Editar
                      </Button>
                      {item.sourceType === "commitment" && commitmentMap.get(item.sourceId)?.sourceType === "manual" && (
                        <Button variant="outline" size="sm" onClick={() => void handleArchiveManualCommitment(item)} disabled={!canEdit}>
                          <Archive className="mr-2 h-4 w-4" />
                          Archivar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredQueue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                    {loadingQueue ? "Cargando cola de egresos..." : "No hay egresos abiertos con los filtros seleccionados."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compromisos manuales y recurrentes</CardTitle>
          <CardDescription>
            Registros guardados en el módulo de egresos, con su estado operativo y trazabilidad propia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descripción</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Clasificación</TableHead>
                <TableHead>Contraparte</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Pago esperado</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Última referencia</TableHead>
                <TableHead className="text-right">Gestión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commitments.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.description}</div>
                    {item.notes && <div className="mt-1 text-xs text-muted-foreground">{item.notes}</div>}
                  </TableCell>
                  <TableCell>{commitmentTypeLabels[item.sourceType]}</TableCell>
                  <TableCell>{item.categoryName || "Sin clasificación"}</TableCell>
                  <TableCell>{item.counterparty || "Sin contraparte"}</TableCell>
                  <TableCell className="text-right font-semibold">{formatTreasuryCurrency(item.amount, policy.monedaBase)}</TableCell>
                  <TableCell>{formatTreasuryDate(item.expectedDate)}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        item.status === "paid"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : item.status === "cancelled"
                            ? "border-slate-200 bg-slate-50 text-slate-700"
                            : item.status === "deferred"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                      )}
                    >
                      {statusLabels[item.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.bankAccountId ? bankAccountMap.get(item.bankAccountId)?.nombre || "Cuenta" : "Sin cuenta"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {item.templateId ? "Generado desde plantilla" : "Alta manual"}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.sourceType === "manual" ? (
                      <Button variant="outline" size="sm" onClick={() => void handleArchiveManualCommitment(item)} disabled={!canEdit}>
                        <Archive className="mr-2 h-4 w-4" />
                        Archivar
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Solo lectura</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {commitments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                    {loadingCommitments ? "Cargando compromisos..." : "Aún no hay compromisos registrados."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar egreso</DialogTitle>
            <DialogDescription>
              Ajusta la programación de pago, la prioridad y la cuenta bancaria sugerida sin salir de la cola.
            </DialogDescription>
          </DialogHeader>

          {editingItem && (
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Registro</Label>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="font-medium">{editingItem.counterparty}</div>
                  <div className="text-sm text-muted-foreground">
                    {sourceLabels[editingItem.sourceType] || editingItem.sourceType} • {editingItem.categoryName} • {formatTreasuryCurrency(editingItem.amount, policy.monedaBase)}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Fecha esperada</Label>
                <Input
                  type="date"
                  value={editForm.expectedDate}
                  onChange={(event) => setEditForm((current) => ({ ...current, expectedDate: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Vencimiento</Label>
                <Input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(event) => setEditForm((current) => ({ ...current, dueDate: event.target.value }))}
                  disabled={editingItem.sourceType !== "commitment"}
                />
              </div>
              <div className="space-y-2">
                <Label>Prioridad</Label>
                <Select
                  value={editForm.priority}
                  onValueChange={(value) => setEditForm((current) => ({ ...current, priority: value as TreasuryPriority }))}
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
                <Label>Cuenta sugerida</Label>
                <Select
                  value={editForm.bankAccountId}
                  onValueChange={(value) => setEditForm((current) => ({ ...current, bankAccountId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cuenta asignada</SelectItem>
                    {bankAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Nota de tesorería</Label>
                <Textarea
                  value={editForm.notes}
                  onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Bloqueos, negociación, contexto operativo..."
                />
              </div>
              {editingItem.sourceType === "commitment" && (
                <div className="space-y-2 md:col-span-2">
                  <Label>Estado</Label>
                  <Select
                    value={editForm.status}
                    onValueChange={(value) =>
                      setEditForm((current) => ({ ...current, status: value as CashCommitment["status"] }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planned">Planificado</SelectItem>
                      <SelectItem value="confirmed">Confirmado</SelectItem>
                      <SelectItem value="deferred">Diferido</SelectItem>
                      <SelectItem value="paid">Pagado</SelectItem>
                      <SelectItem value="cancelled">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)} disabled={savingEdit}>
              Cerrar
            </Button>
            <Button onClick={handleSaveQueueEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon,
  tone = "default",
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={cn(tone === "warning" && "border-amber-200")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={cn("rounded-full p-2", tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-primary/10 text-primary")}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
