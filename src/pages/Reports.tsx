import { useEffect, useMemo, useState } from "react";
import { addMonths, format, isAfter, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, Download, FileText, Link2, Loader2, RefreshCw, TrendingDown, TrendingUp, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  PNL_EXPENSE_LINES,
  buildPnl,
  documentSignedPnlAmount,
  emptyPnlTotals,
  expenseFromTotals,
  hasTaxBreakdown,
  incomeFromTotals,
  type PnlDocumentType,
  type PnlExpenseItem,
  type PnlExpenseLine,
  type PnlTotals,
} from "@/lib/pnl";
import {
  linkInvoiceToCommitment,
  loadPnlData,
  setCommitmentInvoiceCheck,
  unlinkInvoice,
  updateCommitmentPnlAmount,
  type PnlData,
} from "@/lib/pnl-data";
import { canEditTreasury } from "@/lib/treasury";
import { supabase } from "@/lib/supabase";
import { buildPnlStatement } from "@/lib/pnl-report";
import { exportPnlToExcel, exportPnlToPdf, type PnlExportContext } from "@/lib/pnl-export";

const parseLocalDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`);
const formatCurrency = (amount: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0 }).format(amount);
const emptyData = (): PnlData => ({ documents: [], commitments: [], rendiciones: [], advanceReturns: [], purchaseCandidates: [], links: [], unreconciledOutflows: { count: 0, total: 0 } });
// Retención de boletas de honorarios vigente en 2026.
const HONORARIOS_RETENTION_RATE = 0.1525;
// Líneas donde lo pagado por banco puede diferir del gasto: líquido vs bruto, cuota vs interés.
const EDITABLE_ACCRUAL_LINES: PnlExpenseLine[] = ["payroll", "professional_fees", "interest"];

export default function Reports() {
  const { selectedEmpresaId, selectedEmpresa, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const today = new Date();
  const [fromMonth, setFromMonth] = useState(format(today, "yyyy-MM"));
  const [toMonth, setToMonth] = useState(format(today, "yyyy-MM"));
  // El P/L se lee por mes completo: las remuneraciones y rendiciones se devengan
  // al mes, asi que un rango a mitad de mes mezclaba un mes entero de personal
  // con unos pocos dias de facturas.
  const [data, setData] = useState<PnlData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);
  const [editingAccrual, setEditingAccrual] = useState<{ id: string; value: string } | null>(null);
  const [linkingInvoice, setLinkingInvoice] = useState<{ commitmentId: string; facturaId: string } | null>(null);
  const [expenseLineFilter, setExpenseLineFilter] = useState<PnlExpenseLine | "all">("all");
  const [expenseMonthFilter, setExpenseMonthFilter] = useState<string>("all");

  const loadPnl = async () => {
    if (!selectedEmpresaId) return;
    if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) return;
    if (fromMonth > toMonth) {
      setError("El mes de inicio no puede ser posterior al mes de término.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await loadPnlData(selectedEmpresaId, fromMonth, toMonth));
    } catch (loadError: any) {
      console.error("Error loading P/L:", loadError);
      setError(`No se pudo cargar el P/L: ${loadError.message}`);
      setData(emptyData());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPnl();
  }, [selectedEmpresaId, fromMonth, toMonth]);

  const pnl = useMemo(() => buildPnl({ fromMonth, toMonth, ...data }), [data, fromMonth, toMonth]);
  const { totals } = pnl;
  const income = incomeFromTotals(totals);
  const expenses = expenseFromTotals(totals);
  const result = income - expenses;
  const margin = income > 0 ? (result / income) * 100 : 0;
  const documentsWithoutBreakdown = data.documents.filter((document) => !hasTaxBreakdown(document));
  const duplicateWarnings = pnl.warnings.filter((warning) => warning.kind === "possible_duplicate");
  const negativeWarnings = pnl.warnings.filter((warning) => warning.kind === "negative_document");
  const uncheckedRenditionWarnings = pnl.warnings.filter((warning) => warning.kind === "unchecked_rendition");
  const visibleExpenseLines = PNL_EXPENSE_LINES.filter((line) => totals.expenses[line.key] !== 0 || ["payroll", "professional_fees", "reimbursements"].includes(line.key));
  const commitmentById = useMemo(() => new Map(data.commitments.map((commitment) => [commitment.id, commitment])), [data.commitments]);
  const filteredExpenseItems = useMemo(
    () => pnl.expenseItems.filter((item) =>
      (expenseLineFilter === "all" || item.line === expenseLineFilter) &&
      (expenseMonthFilter === "all" || item.month === expenseMonthFilter)
    ),
    [expenseLineFilter, expenseMonthFilter, pnl.expenseItems]
  );
  // Agrupado por línea del P/L y ordenado por fecha de pago, con subtotales.
  const expenseGroups = useMemo(
    () => PNL_EXPENSE_LINES
      .map((line) => {
        const items = filteredExpenseItems
          .filter((item) => item.line === line.key)
          .sort((a, b) => (a.date || a.month).localeCompare(b.date || b.month));
        return { ...line, items, paid: items.reduce((sum, item) => sum + item.paidAmount, 0), total: items.reduce((sum, item) => sum + item.amount, 0) };
      })
      .filter((group) => group.items.length > 0),
    [filteredExpenseItems]
  );
  const filteredExpenseTotal = filteredExpenseItems.reduce((sum, item) => sum + item.amount, 0);
  const showExpenseDetail = (line: PnlExpenseLine) => {
    setExpenseLineFilter(line);
    setExpenseMonthFilter("all");
    document.getElementById("gastos-sin-factura")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const linksInPeriod = useMemo(() => {
    const itemIds = new Set(pnl.expenseItems.map((item) => item.id));
    return data.links.filter((link) => itemIds.has(link.cashCommitmentId || link.rendicionId || ""));
  }, [data.links, pnl.expenseItems]);

  const monthlyRows = useMemo(() => {
    const rows: Array<{ key: string; label: string; totals: PnlTotals }> = [];
    let cursor = startOfMonth(parseLocalDate(`${fromMonth}-01`));
    const lastMonth = startOfMonth(parseLocalDate(`${toMonth}-01`));
    while (!isAfter(cursor, lastMonth)) {
      const key = format(cursor, "yyyy-MM");
      rows.push({ key, label: format(cursor, "MMMM yyyy", { locale: es }), totals: pnl.monthly.get(key) || emptyPnlTotals() });
      cursor = addMonths(cursor, 1);
    }
    return rows;
  }, [fromMonth, pnl.monthly, toMonth]);

  const setCurrentMonth = () => {
    setFromMonth(format(today, "yyyy-MM"));
    setToMonth(format(today, "yyyy-MM"));
  };

  const setCurrentYear = () => {
    setFromMonth(format(new Date(today.getFullYear(), 0, 1), "yyyy-MM"));
    setToMonth(format(today, "yyyy-MM"));
  };

  const runAction = async (id: string, action: () => Promise<void>) => {
    if (!selectedEmpresaId || !canEdit) return;
    setBusyId(id);
    try {
      await action();
      await loadPnl();
    } catch (actionError: any) {
      console.error("Error updating P/L source:", actionError);
      alert(`No se pudo guardar el cambio: ${actionError.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleLinkDuplicate = (commitmentId: string, facturaId: string) =>
    runAction(`${commitmentId}:${facturaId}`, () =>
      linkInvoiceToCommitment({ empresaId: selectedEmpresaId!, cashCommitmentId: commitmentId, facturaId, userId: user?.id || null })
    );

  const handleConfirmNoInvoices = (commitmentId: string) =>
    runAction(commitmentId, () =>
      setCommitmentInvoiceCheck({ empresaId: selectedEmpresaId!, cashCommitmentId: commitmentId, check: "no_invoices", userId: user?.id || null })
    );

  const reviewRendition = (commitmentId: string) => {
    setExpenseLineFilter("reimbursements");
    setExpenseMonthFilter("all");
    setLinkingInvoice({ commitmentId, facturaId: "" });
    document.getElementById("gastos-sin-factura")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSaveAccrual = (item: PnlExpenseItem) => {
    if (!editingAccrual) return;
    const trimmed = editingAccrual.value.trim();
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      alert("Ingresa un monto válido o deja el campo vacío para usar el monto pagado.");
      return;
    }
    void runAction(item.id, async () => {
      await updateCommitmentPnlAmount(selectedEmpresaId!, item.id, value);
      setEditingAccrual(null);
    });
  };

  const buildExportContext = async (): Promise<PnlExportContext> => {
    // El RUT no viene en el contexto de empresa; se lee al exportar.
    const { data: company } = await supabase.from("empresas").select("rut").eq("id", selectedEmpresaId!).maybeSingle();
    return {
      companyName: selectedEmpresa?.nombre || "Empresa",
      companyRut: company?.rut || null,
      logoUrl: selectedEmpresa?.logo_url || null,
      fromMonth,
      toMonth,
      statement: buildPnlStatement(pnl, fromMonth, toMonth),
      pnl,
      data,
    };
  };

  const handleExport = async (format: "excel" | "pdf") => {
    if (!selectedEmpresaId) return;
    setExporting(format);
    try {
      const context = await buildExportContext();
      if (format === "excel") exportPnlToExcel(context);
      else await exportPnlToPdf(context);
    } catch (exportError: any) {
      console.error("Error exporting P/L:", exportError);
      alert(`No se pudo generar el archivo: ${exportError.message}`);
    } finally {
      setExporting(null);
    }
  };

  if (loading) return <div className="flex h-[70vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">P/L · Estado de Resultados</h1>
          <p className="mt-1 text-muted-foreground">Resultado por devengo: reconoce los documentos por su fecha de emisión, no por la fecha de cobro o pago.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={setCurrentMonth}>Este mes</Button>
          <Button variant="outline" onClick={setCurrentYear}>Año actual</Button>
          <Button variant="outline" onClick={() => void loadPnl()}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button>
          <Button variant="outline" onClick={() => void handleExport("excel")} disabled={exporting !== null || data.documents.length + pnl.expenseItems.length === 0}>
            {exporting === "excel" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Excel
          </Button>
          <Button onClick={() => void handleExport("pdf")} disabled={exporting !== null || data.documents.length + pnl.expenseItems.length === 0}>
            {exporting === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2"><label className="text-sm font-medium" htmlFor="pnl-from">Desde el mes</label><Input id="pnl-from" type="month" value={fromMonth} onChange={(event) => setFromMonth(event.target.value)} /></div>
          <div className="space-y-2"><label className="text-sm font-medium" htmlFor="pnl-to">Hasta el mes</label><Input id="pnl-to" type="month" value={toMonth} onChange={(event) => setToMonth(event.target.value)} /></div>
        </CardContent>
      </Card>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Ingresos netos" amount={income} description="Ventas menos notas de crédito emitidas." tone="emerald" />
        <MetricCard label="Gastos netos" amount={expenses} description="Compras netas de notas de crédito, más gastos pagados sin factura." tone="rose" />
        <Card className={result >= 0 ? "border-l-4 border-l-primary" : "border-l-4 border-l-destructive"}>
          <CardHeader className="pb-2"><CardDescription>Resultado del período</CardDescription><CardTitle className="text-2xl">{formatCurrency(result)}</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">{result >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-destructive" />}Margen {margin.toFixed(1)}%</CardContent>
        </Card>
      </div>

      {pnl.warnings.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-800"><AlertTriangle className="h-5 w-5" />Revisar antes de usar el resultado</CardTitle>
            <CardDescription>Estos puntos pueden hacer que el monto no sea exacto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {duplicateWarnings.length > 0 && (
              <div className="space-y-2">
                <p className="font-medium">Posibles gastos duplicados ({duplicateWarnings.length})</p>
                <p className="text-muted-foreground">Un gasto pagado por banco tiene el mismo monto que una factura de compra pendiente. Si es la misma, vincúlala: la factura queda pagada y el gasto deja de sumarse por segunda vez.</p>
                {duplicateWarnings.map((warning) => {
                  const actionId = `${warning.commitmentId}:${warning.documentId}`;
                  return (
                    <div key={actionId} className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                      <span>{warning.message}</span>
                      {canEdit && (
                        <Button size="sm" variant="outline" disabled={busyId === actionId} onClick={() => void handleLinkDuplicate(warning.commitmentId!, warning.documentId!)}>
                          {busyId === actionId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}Es la misma, vincular
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {uncheckedRenditionWarnings.length > 0 && (
              <div className="space-y-2">
                <p className="font-medium">Rendiciones sin revisar facturas ({uncheckedRenditionWarnings.length})</p>
                <p className="text-muted-foreground">Confirma que cada rendición no incluye facturas a nombre de la empresa, o vincula las que tenga: esas facturas ya están en compras.</p>
                {uncheckedRenditionWarnings.map((warning) => (
                  <div key={warning.commitmentId} className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                    <span>{warning.message}</span>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" variant="outline" onClick={() => reviewRendition(warning.commitmentId!)}><Link2 className="mr-2 h-4 w-4" />Vincular facturas</Button>
                        <Button size="sm" variant="outline" disabled={busyId === warning.commitmentId} onClick={() => void handleConfirmNoInvoices(warning.commitmentId!)}>
                          {busyId === warning.commitmentId && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}No tiene facturas
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {negativeWarnings.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Documentos con monto negativo ({negativeWarnings.length})</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{negativeWarnings.map((warning) => <li key={warning.documentId}>{warning.message}</li>)}</ul>
              </div>
            )}
            {documentsWithoutBreakdown.length > 0 && (
              <details className="space-y-1">
                <summary className="cursor-pointer font-medium">
                  {documentsWithoutBreakdown.length} documento(s) sin neto/exento por {formatCurrency(documentsWithoutBreakdown.reduce((sum, document) => sum + Number(document.monto || 0), 0))}: se usó el total con IVA. Reimporta el Registro de Compras/Ventas del SII de esos meses para completar el desglose.
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {documentsWithoutBreakdown.map((document) => <li key={document.id}>{document.fecha_emision} · {document.tipo} · {document.numero_documento || "sin folio"} · {document.tercero_nombre || "sin tercero"} · {formatCurrency(Number(document.monto || 0))}</li>)}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Estado de resultados</CardTitle><CardDescription>Montos sin IVA recuperable cuando el documento tiene desglose.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <PnlLine label="Ventas" amount={totals.sales} />
            <PnlLine label="Notas de crédito de venta" amount={-totals.salesCreditNotes} muted />
            <PnlLine label="Ingresos netos" amount={income} emphasis />
            <PnlLine label="Compras y gastos documentados" amount={-totals.purchases} />
            <PnlLine label="Notas de crédito de compra" amount={totals.purchaseCreditNotes} muted />
            {visibleExpenseLines.map((line) => <PnlLine key={line.key} label={line.label} amount={-totals.expenses[line.key]} onClick={() => showExpenseDetail(line.key)} />)}
            <PnlLine label="Gastos netos" amount={-expenses} emphasis />
            <div className="border-t pt-3"><PnlLine label="Resultado P/L" amount={result} emphasis result /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Cómo se calcula</CardTitle><CardDescription>Alcance de este módulo.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p><strong className="text-foreground">Devengo.</strong> Cada documento entra en el período de su fecha de emisión. Conciliarlo en banco no cambia el resultado.</p>
            <p><strong className="text-foreground">Ingresos.</strong> Facturas de venta menos notas de crédito de venta.</p>
            <p><strong className="text-foreground">Compras.</strong> Neto + exento de facturas de compra, más IVA no recuperable e impuestos sin derecho a crédito, menos notas de crédito de proveedores.</p>
            <p><strong className="text-foreground">Gastos pagados sin factura.</strong> Remuneraciones, honorarios, rendiciones, arriendo, servicios, combustible, peajes, mantenciones, comisiones y demás egresos conciliados en banco, en el mes de devengo indicado o, si falta, en el mes del pago.</p>
            <p><strong className="text-foreground">Sin duplicar.</strong> Si el pago bancario está aplicado a una factura, o tiene facturas de compra vinculadas, se descuenta su total: esas facturas ya están en compras.</p>
            <p><strong className="text-foreground">Devengo distinto al pago.</strong> Honorarios pueden registrarse por el bruto de la boleta, remuneraciones por el costo empresa y las cuotas de crédito solo por su interés.</p>
            <p><strong className="text-foreground">Rendiciones.</strong> Se restan las devoluciones de saldos de anticipos.</p>
            <p><strong className="text-foreground">No incluido.</strong> Pagos de IVA/F29, traspasos entre cuentas, capex, capital de créditos, aportes de capital y anticipos de clientes.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Resultado mensual</CardTitle><CardDescription>Desglose del período seleccionado.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Mes</th><th className="px-3 py-3 text-right">Ingresos netos</th><th className="px-3 py-3 text-right">Gastos netos</th><th className="px-3 py-3 text-right">Resultado</th><th className="px-3 py-3 text-right">Margen</th></tr></thead><tbody>{monthlyRows.map((row) => { const rowIncome = incomeFromTotals(row.totals); const rowExpense = expenseFromTotals(row.totals); const rowResult = rowIncome - rowExpense; return <tr key={row.key} className="border-b last:border-0"><td className="px-3 py-3 capitalize">{row.label}</td><td className="px-3 py-3 text-right">{formatCurrency(rowIncome)}</td><td className="px-3 py-3 text-right">{formatCurrency(rowExpense)}</td><td className={`px-3 py-3 text-right font-semibold ${rowResult >= 0 ? "text-emerald-700" : "text-destructive"}`}>{formatCurrency(rowResult)}</td><td className="px-3 py-3 text-right">{rowIncome > 0 ? `${((rowResult / rowIncome) * 100).toFixed(1)}%` : "—"}</td></tr>; })}</tbody></table>
        </CardContent>
      </Card>

      <Card id="gastos-sin-factura" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>Gastos sin factura</CardTitle>
          <CardDescription>Egresos conciliados en banco que entran al P/L sin factura de compra, según su mes de devengo. Haz clic en una línea del estado de resultados para ver solo esa línea. Si un pago tiene factura, vincúlala; en remuneraciones, honorarios y créditos puedes ajustar el monto devengado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="expense-line-filter">Línea</label>
              <select id="expense-line-filter" className="h-9 w-full rounded-md border bg-background px-2 text-sm md:w-72" value={expenseLineFilter} onChange={(event) => setExpenseLineFilter(event.target.value as PnlExpenseLine | "all")}>
                <option value="all">Todas las líneas</option>
                {PNL_EXPENSE_LINES.filter((line) => pnl.expenseItems.some((item) => item.line === line.key)).map((line) => <option key={line.key} value={line.key}>{line.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="expense-month-filter">Mes P/L</label>
              <select id="expense-month-filter" className="h-9 w-full rounded-md border bg-background px-2 text-sm md:w-48" value={expenseMonthFilter} onChange={(event) => setExpenseMonthFilter(event.target.value)}>
                <option value="all">Todo el período</option>
                {monthlyRows.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
              </select>
            </div>
            {(expenseLineFilter !== "all" || expenseMonthFilter !== "all") && <Button variant="ghost" size="sm" onClick={() => { setExpenseLineFilter("all"); setExpenseMonthFilter("all"); }}>Quitar filtros</Button>}
            <div className="text-sm md:ml-auto">{filteredExpenseItems.length} pago(s) · <span className="font-semibold">{formatCurrency(-filteredExpenseTotal)}</span> en P/L</div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Fecha pago</th><th className="px-3 py-3">Mes P/L</th><th className="px-3 py-3">Beneficiario / detalle</th><th className="px-3 py-3 text-right">Pagado</th><th className="px-3 py-3 text-right">Monto P/L</th><th className="px-3 py-3"></th></tr></thead>
            {expenseGroups.length === 0 ? <tbody><tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No hay gastos sin factura para este filtro.</td></tr></tbody> : expenseGroups.map((group) => (
            <tbody key={group.key}>
              <tr className="border-b bg-muted/50"><td colSpan={3} className="px-3 py-2 font-semibold">{group.label} <span className="font-normal text-muted-foreground">· {group.items.length} pago(s)</span></td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(group.paid)}</td><td className="px-3 py-2 text-right font-semibold">{formatCurrency(-group.total)}</td><td></td></tr>
              {group.items.map((item) => {
                const commitment = item.source === "commitment" ? commitmentById.get(item.id) : undefined;
                const canEditAccrual = canEdit && commitment && EDITABLE_ACCRUAL_LINES.includes(item.line);
                const isEditing = editingAccrual?.id === item.id;
                const isLinking = linkingInvoice?.commitmentId === item.id;
                return (
                  <tr key={`${item.source}:${item.id}`} className={`border-b align-top ${item.amount === 0 ? "text-muted-foreground" : ""}`}>
                    <td className="px-3 py-3 whitespace-nowrap">{item.date ? format(parseLocalDate(item.date), "dd MMM yyyy", { locale: es }) : "—"}</td>
                    <td className="px-3 py-3">{item.month}</td>
                    <td className="px-3 py-3"><div className="font-medium">{item.counterparty || "Sin beneficiario"}</div><div className="text-xs text-muted-foreground">{item.description}</div>{item.note && <div className="text-xs text-amber-700">{item.note}</div>}{commitment && item.line === "reimbursements" && item.amount > 0 && !commitment.invoiceCheck && <div className="text-xs font-medium text-amber-700">Sin revisar facturas</div>}{commitment?.invoiceCheck === "no_invoices" && <div className="text-xs text-emerald-700">Confirmada sin facturas</div>}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(item.paidAmount)}</td>
                    <td className="px-3 py-3 text-right font-medium">
                      {isEditing ? (
                        <div className="flex flex-col items-end gap-1">
                          <Input className="h-8 w-36 text-right" inputMode="numeric" value={editingAccrual.value} onChange={(event) => setEditingAccrual({ id: item.id, value: event.target.value })} placeholder={String(item.paidAmount)} />
                          {item.line === "professional_fees" && <button type="button" className="text-xs text-primary underline" onClick={() => setEditingAccrual({ id: item.id, value: String(Math.round(item.paidAmount / (1 - HONORARIOS_RETENTION_RATE))) })}>Bruto con retención 15,25%</button>}
                        </div>
                      ) : formatCurrency(-item.amount)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {canEdit && commitment && item.amount > 0 && (isLinking ? (
                        <div className="flex flex-col items-end gap-1">
                          <select className="h-8 max-w-64 rounded-md border bg-background px-2 text-xs" value={linkingInvoice.facturaId} onChange={(event) => setLinkingInvoice({ commitmentId: item.id, facturaId: event.target.value })}>
                            <option value="">Factura de compra pendiente…</option>
                            {data.purchaseCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fecha_emision} · {candidate.tercero_nombre || "Sin proveedor"} · N° {candidate.numero_documento || "s/f"} · {formatCurrency(Number(candidate.monto || 0))}</option>)}
                          </select>
                          <div className="flex gap-1">
                            <Button size="sm" disabled={!linkingInvoice.facturaId || busyId === `${item.id}:${linkingInvoice.facturaId}`} onClick={() => void handleLinkDuplicate(item.id, linkingInvoice.facturaId).then(() => setLinkingInvoice(null))}>Vincular</Button>
                            <Button size="sm" variant="ghost" onClick={() => setLinkingInvoice(null)}>Cancelar</Button>
                          </div>
                        </div>
                      ) : !isEditing && (
                        <Button size="sm" variant="ghost" onClick={() => setLinkingInvoice({ commitmentId: item.id, facturaId: "" })}><Link2 className="mr-1 h-4 w-4" />Vincular factura</Button>
                      ))}
                      {canEditAccrual && !isLinking && (isEditing ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" disabled={busyId === item.id} onClick={() => handleSaveAccrual(item)}>{busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingAccrual(null)}>Cancelar</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setEditingAccrual({ id: item.id, value: commitment.pnlAmount == null ? "" : String(commitment.pnlAmount) })}>Ajustar devengo</Button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            ))}
          </table>
          </div>
        </CardContent>
      </Card>

      {linksInPeriod.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Facturas vinculadas a gastos</CardTitle><CardDescription>Estas facturas están en compras; su total se descuenta del gasto pagado para no duplicarlo.</CardDescription></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Factura</th><th className="px-3 py-3">Proveedor</th><th className="px-3 py-3">Gasto</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3"></th></tr></thead>
              <tbody>
                {linksInPeriod.map((link) => (
                  <tr key={link.id} className="border-b last:border-0">
                    <td className="px-3 py-3">{link.numeroDocumento || "Sin folio"}</td>
                    <td className="px-3 py-3">{link.terceroNombre || "Sin proveedor"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{commitmentById.get(link.cashCommitmentId || "")?.description || "Rendición"}</td>
                    <td className="px-3 py-3 text-right">{formatCurrency(link.monto)}</td>
                    <td className="px-3 py-3 text-right">{canEdit && <Button size="sm" variant="ghost" disabled={busyId === link.id} onClick={() => void runAction(link.id, () => unlinkInvoice({ empresaId: selectedEmpresaId!, link }))}><Unlink className="mr-2 h-4 w-4" />Desvincular</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Documentos incluidos</CardTitle><CardDescription>{data.documents.length} documento(s) incluidos en el período.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Fecha</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Tercero</th><th className="px-3 py-3">Folio</th><th className="px-3 py-3">Estado</th><th className="px-3 py-3 text-right">Monto P/L</th></tr></thead><tbody>{data.documents.length === 0 ? <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">No hay documentos para este período.</td></tr> : data.documents.map((document) => <tr key={document.id} className="border-b last:border-0"><td className="px-3 py-3">{document.fecha_emision ? format(parseLocalDate(document.fecha_emision), "dd MMM yyyy", { locale: es }) : "Sin fecha"}</td><td className="px-3 py-3"><DocumentTypeLabel type={document.tipo} /></td><td className="px-3 py-3">{document.tercero_nombre || "Sin tercero"}</td><td className="px-3 py-3">{document.numero_documento || "Sin folio"}</td><td className="px-3 py-3 capitalize">{document.estado || "Sin estado"}</td><td className="px-3 py-3 text-right font-medium">{formatCurrency(documentSignedPnlAmount(document))}{!hasTaxBreakdown(document) && <span className="ml-1 text-xs text-amber-700" title="Sin desglose: incluye IVA">*</span>}</td></tr>)}</tbody></table>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, amount, description, tone }: { label: string; amount: number; description: string; tone: "emerald" | "rose" }) {
  return <Card className={tone === "emerald" ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-rose-500"}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{formatCurrency(amount)}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{description}</CardContent></Card>;
}

function PnlLine({ label, amount, emphasis = false, muted = false, result = false, onClick }: { label: string; amount: number; emphasis?: boolean; muted?: boolean; result?: boolean; onClick?: () => void }) {
  const className = `flex w-full items-center justify-between ${emphasis ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""} ${result ? (amount >= 0 ? "text-emerald-700" : "text-destructive") : ""}`;
  if (onClick) {
    return <button type="button" className={`${className} rounded text-left hover:bg-muted/60`} onClick={onClick} title="Ver el detalle de esta línea"><span className="underline decoration-dotted underline-offset-4">{label}</span><span>{formatCurrency(amount)}</span></button>;
  }
  return <div className={className}><span>{label}</span><span>{formatCurrency(amount)}</span></div>;
}

function DocumentTypeLabel({ type }: { type: PnlDocumentType }) {
  const labels: Record<PnlDocumentType, string> = { venta: "Venta", compra: "Compra", nota_credito: "NC venta", nota_credito_compra: "NC compra" };
  const colors: Record<PnlDocumentType, string> = { venta: "bg-emerald-100 text-emerald-800", compra: "bg-rose-100 text-rose-800", nota_credito: "bg-amber-100 text-amber-800", nota_credito_compra: "bg-sky-100 text-sky-800" };
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${colors[type]}`}>{labels[type]}</span>;
}
