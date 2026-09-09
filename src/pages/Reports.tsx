import { useEffect, useMemo, useState } from "react";
import { addMonths, format, isAfter, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import { CalendarDays, Download, FileText, Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";

type PnlDocumentType = "venta" | "compra" | "nota_credito" | "nota_credito_compra";

type PnlDocument = {
  id: string;
  tipo: PnlDocumentType;
  numero_documento: string | null;
  tercero_nombre: string | null;
  fecha_emision: string | null;
  monto: number | null;
  monto_neto: number | null;
  monto_exento: number | null;
  estado: string | null;
};

type PnlPayrollExpense = {
  id: string;
  kind: "payroll" | "professional_fees";
  description: string;
  counterparty: string | null;
  amount: number;
  accrualMonth: string;
};

type PnlTotals = {
  sales: number;
  salesCreditNotes: number;
  purchases: number;
  purchaseCreditNotes: number;
  payroll: number;
  professionalFees: number;
};

const emptyTotals = (): PnlTotals => ({ sales: 0, salesCreditNotes: 0, purchases: 0, purchaseCreditNotes: 0, payroll: 0, professionalFees: 0 });
const parseLocalDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`);

const documentPnlAmount = (document: PnlDocument) => {
  const net = document.monto_neto == null ? null : Number(document.monto_neto);
  const exempt = document.monto_exento == null ? null : Number(document.monto_exento);
  if (net !== null || exempt !== null) {
    return (Number.isFinite(net || 0) ? net || 0 : 0) + (Number.isFinite(exempt || 0) ? exempt || 0 : 0);
  }
  return Number(document.monto || 0);
};

const addDocumentToTotals = (totals: PnlTotals, document: PnlDocument) => {
  const amount = documentPnlAmount(document);
  if (document.tipo === "venta") totals.sales += amount;
  if (document.tipo === "nota_credito") totals.salesCreditNotes += amount;
  if (document.tipo === "compra") totals.purchases += amount;
  if (document.tipo === "nota_credito_compra") totals.purchaseCreditNotes += amount;
};

const incomeFromTotals = (totals: PnlTotals) => totals.sales - totals.salesCreditNotes;
const expenseFromTotals = (totals: PnlTotals) => totals.purchases - totals.purchaseCreditNotes + totals.payroll + totals.professionalFees;
const formatCurrency = (amount: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0 }).format(amount);

export default function Reports() {
  const { selectedEmpresaId } = useCompany();
  const today = new Date();
  const [fromDate, setFromDate] = useState(format(startOfMonth(today), "yyyy-MM-dd"));
  const [toDate, setToDate] = useState(format(today, "yyyy-MM-dd"));
  const [documents, setDocuments] = useState<PnlDocument[]>([]);
  const [payrollExpenses, setPayrollExpenses] = useState<PnlPayrollExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPnl = async () => {
    if (!selectedEmpresaId || !fromDate || !toDate) return;
    if (fromDate > toDate) {
      setError("La fecha de inicio no puede ser posterior a la fecha de término.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [documentsResult, payrollResult] = await Promise.all([
        supabase
          .from("facturas")
          .select("id, tipo, numero_documento, tercero_nombre, fecha_emision, monto, monto_neto, monto_exento, estado")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["venta", "compra", "nota_credito", "nota_credito_compra"])
          .gte("fecha_emision", fromDate)
          .lte("fecha_emision", toDate)
          .is("archived_at", null)
          .order("fecha_emision", { ascending: true }),
        supabase
          .from("cash_commitments")
          .select("id, description, counterparty, amount, accrual_month, treasury_categories!inner(code)")
          .eq("empresa_id", selectedEmpresaId)
          .eq("status", "paid")
          .eq("direction", "outflow")
          .in("treasury_categories.code", ["payroll", "professional_fees"])
          .gte("accrual_month", format(startOfMonth(parseLocalDate(fromDate)), "yyyy-MM-dd"))
          .lte("accrual_month", format(startOfMonth(parseLocalDate(toDate)), "yyyy-MM-dd"))
          .is("archived_at", null),
      ]);
      if (documentsResult.error) throw documentsResult.error;
      if (payrollResult.error) throw payrollResult.error;
      setDocuments((documentsResult.data || []) as PnlDocument[]);
      setPayrollExpenses((payrollResult.data || []).map((expense: any) => {
        const category = Array.isArray(expense.treasury_categories) ? expense.treasury_categories[0] : expense.treasury_categories;
        return {
          id: expense.id,
          kind: category?.code === "professional_fees" ? "professional_fees" : "payroll",
          description: expense.description || "Sin descripción",
          counterparty: expense.counterparty || null,
          amount: Number(expense.amount || 0),
          accrualMonth: expense.accrual_month,
        };
      }));
    } catch (loadError: any) {
      console.error("Error loading P/L:", loadError);
      setError(`No se pudo cargar el P/L: ${loadError.message}`);
      setDocuments([]);
      setPayrollExpenses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPnl();
  }, [selectedEmpresaId]);

  const totals = useMemo(() => {
    const next = emptyTotals();
    documents.forEach((document) => addDocumentToTotals(next, document));
    payrollExpenses.forEach((expense) => {
      if (expense.kind === "payroll") next.payroll += expense.amount;
      else next.professionalFees += expense.amount;
    });
    return next;
  }, [documents, payrollExpenses]);

  const income = incomeFromTotals(totals);
  const expenses = expenseFromTotals(totals);
  const result = income - expenses;
  const margin = income > 0 ? (result / income) * 100 : 0;
  const legacyDocuments = documents.filter((document) => document.monto_neto == null && document.monto_exento == null).length;

  const monthlyRows = useMemo(() => {
    if (!fromDate || !toDate) return [];
    const monthly = new Map<string, PnlTotals>();
    documents.forEach((document) => {
      if (!document.fecha_emision) return;
      const key = format(parseLocalDate(document.fecha_emision), "yyyy-MM");
      const current = monthly.get(key) || emptyTotals();
      addDocumentToTotals(current, document);
      monthly.set(key, current);
    });
    payrollExpenses.forEach((expense) => {
      const key = expense.accrualMonth.slice(0, 7);
      const current = monthly.get(key) || emptyTotals();
      if (expense.kind === "payroll") current.payroll += expense.amount;
      else current.professionalFees += expense.amount;
      monthly.set(key, current);
    });
    const rows: Array<{ key: string; label: string; totals: PnlTotals }> = [];
    let cursor = startOfMonth(parseLocalDate(fromDate));
    const lastMonth = startOfMonth(parseLocalDate(toDate));
    while (!isAfter(cursor, lastMonth)) {
      const key = format(cursor, "yyyy-MM");
      rows.push({ key, label: format(cursor, "MMMM yyyy", { locale: es }), totals: monthly.get(key) || emptyTotals() });
      cursor = addMonths(cursor, 1);
    }
    return rows;
  }, [documents, fromDate, payrollExpenses, toDate]);

  const setCurrentMonth = () => {
    setFromDate(format(startOfMonth(today), "yyyy-MM-dd"));
    setToDate(format(today, "yyyy-MM-dd"));
  };

  const setCurrentYear = () => {
    setFromDate(format(new Date(today.getFullYear(), 0, 1), "yyyy-MM-dd"));
    setToDate(format(today, "yyyy-MM-dd"));
  };

  const exportToExcel = () => {
    const summaryRows = [
      { Concepto: "Ventas", Monto: totals.sales },
      { Concepto: "(-) Notas de crédito de venta", Monto: -totals.salesCreditNotes },
      { Concepto: "Ingresos netos", Monto: income },
      { Concepto: "Compras y gastos documentados", Monto: -totals.purchases },
      { Concepto: "Notas de crédito de compra", Monto: totals.purchaseCreditNotes },
      { Concepto: "Remuneraciones", Monto: -totals.payroll },
      { Concepto: "Honorarios", Monto: -totals.professionalFees },
      { Concepto: "Gastos netos", Monto: -expenses },
      { Concepto: "Resultado P/L", Monto: result },
    ];
    const detailRows = documents.map((document) => ({
      Fecha: document.fecha_emision ? format(parseLocalDate(document.fecha_emision), "dd/MM/yyyy") : "Sin fecha",
      Tipo: document.tipo === "venta" ? "Venta" : document.tipo === "compra" ? "Compra" : document.tipo === "nota_credito" ? "NC venta" : "NC compra",
      Tercero: document.tercero_nombre || "Sin tercero",
      Folio: document.numero_documento || "Sin folio",
      "Monto P/L sin IVA": documentPnlAmount(document) * (document.tipo.includes("nota_credito") ? -1 : 1),
      Estado: document.estado || "Sin estado",
    }));
    const payrollRows = payrollExpenses.map((expense) => ({
      Mes: expense.accrualMonth.slice(0, 7),
      Tipo: expense.kind === "payroll" ? "Remuneración" : "Honorario",
      Beneficiario: expense.counterparty || "Sin beneficiario",
      Detalle: expense.description,
      Monto: -expense.amount,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "P-L");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), "Documentos");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(payrollRows), "Remuneraciones y honorarios");
    XLSX.writeFile(workbook, `PL_${fromDate}_${toDate}.xlsx`);
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
          <Button onClick={exportToExcel} disabled={documents.length + payrollExpenses.length === 0}><Download className="mr-2 h-4 w-4" />Exportar Excel</Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2"><label className="text-sm font-medium" htmlFor="pnl-from">Desde</label><Input id="pnl-from" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div>
          <div className="space-y-2"><label className="text-sm font-medium" htmlFor="pnl-to">Hasta</label><Input id="pnl-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
          <div className="flex items-end"><Button className="w-full" onClick={() => void loadPnl()}><CalendarDays className="mr-2 h-4 w-4" />Aplicar período</Button></div>
        </CardContent>
      </Card>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Ingresos netos" amount={income} description="Ventas menos notas de crédito emitidas." tone="emerald" />
        <MetricCard label="Gastos netos" amount={expenses} description="Compras, remuneraciones y honorarios, netos de notas de crédito." tone="rose" />
        <Card className={result >= 0 ? "border-l-4 border-l-primary" : "border-l-4 border-l-destructive"}>
          <CardHeader className="pb-2"><CardDescription>Resultado del período</CardDescription><CardTitle className="text-2xl">{formatCurrency(result)}</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">{result >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-destructive" />}Margen {margin.toFixed(1)}%</CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Estado de resultados</CardTitle><CardDescription>Montos sin IVA cuando el documento contiene neto y exento.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <PnlLine label="Ventas" amount={totals.sales} />
            <PnlLine label="Notas de crédito de venta" amount={-totals.salesCreditNotes} muted />
            <PnlLine label="Ingresos netos" amount={income} emphasis />
            <PnlLine label="Compras y gastos documentados" amount={-totals.purchases} />
            <PnlLine label="Notas de crédito de compra" amount={totals.purchaseCreditNotes} muted />
            <PnlLine label="Remuneraciones" amount={-totals.payroll} />
            <PnlLine label="Honorarios" amount={-totals.professionalFees} />
            <PnlLine label="Gastos netos" amount={-expenses} emphasis />
            <div className="border-t pt-3"><PnlLine label="Resultado P/L" amount={result} emphasis result /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Cómo se calcula</CardTitle><CardDescription>Alcance de este módulo.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p><strong className="text-foreground">Devengo.</strong> Cada documento entra en el período de su fecha de emisión. Conciliarlo en banco no cambia el resultado.</p>
            <p><strong className="text-foreground">Ingresos.</strong> Facturas de venta menos notas de crédito de venta.</p>
            <p><strong className="text-foreground">Gastos.</strong> Facturas de compra menos notas de crédito de proveedores, más remuneraciones y honorarios conciliados.</p>
            <p><strong className="text-foreground">IVA.</strong> Se usa neto + exento; el IVA queda fuera del resultado. Si un documento antiguo no tiene desglose, se usa su total.</p>
            <p><strong className="text-foreground">Devengo de personal.</strong> Remuneraciones y honorarios entran en el mes indicado al conciliarlos, aunque el pago bancario sea otro mes.</p>
            <p><strong className="text-foreground">No incluido.</strong> Aportes de capital, anticipos y devoluciones no afectan P/L. Las rendiciones y otros gastos manuales deben respaldarse con su factura de compra para incorporarse.</p>
            {legacyDocuments > 0 && <p className="rounded-md bg-amber-50 p-3 text-amber-800">Hay {legacyDocuments} documento(s) sin neto/exento: se calcularon con el monto total.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Resultado mensual</CardTitle><CardDescription>Desglose del período seleccionado.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Mes</th><th className="px-3 py-3 text-right">Ingresos netos</th><th className="px-3 py-3 text-right">Gastos netos</th><th className="px-3 py-3 text-right">Resultado</th><th className="px-3 py-3 text-right">Margen</th></tr></thead><tbody>{monthlyRows.map((row) => { const rowIncome = incomeFromTotals(row.totals); const rowExpense = expenseFromTotals(row.totals); const rowResult = rowIncome - rowExpense; return <tr key={row.key} className="border-b last:border-0"><td className="px-3 py-3 capitalize">{row.label}</td><td className="px-3 py-3 text-right">{formatCurrency(rowIncome)}</td><td className="px-3 py-3 text-right">{formatCurrency(rowExpense)}</td><td className={`px-3 py-3 text-right font-semibold ${rowResult >= 0 ? "text-emerald-700" : "text-destructive"}`}>{formatCurrency(rowResult)}</td><td className="px-3 py-3 text-right">{rowIncome > 0 ? `${((rowResult / rowIncome) * 100).toFixed(1)}%` : "—"}</td></tr>; })}</tbody></table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Remuneraciones y honorarios incluidos</CardTitle><CardDescription>Se reconocen según el mes de devengo indicado al conciliar el pago.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Mes P/L</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Beneficiario / detalle</th><th className="px-3 py-3 text-right">Monto</th></tr></thead><tbody>{payrollExpenses.length === 0 ? <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No hay remuneraciones u honorarios en este período.</td></tr> : payrollExpenses.map((expense) => <tr key={expense.id} className="border-b last:border-0"><td className="px-3 py-3">{expense.accrualMonth.slice(0, 7)}</td><td className="px-3 py-3">{expense.kind === "payroll" ? "Remuneración" : "Honorario"}</td><td className="px-3 py-3"><div className="font-medium">{expense.counterparty || "Sin beneficiario"}</div><div className="text-xs text-muted-foreground">{expense.description}</div></td><td className="px-3 py-3 text-right font-medium">{formatCurrency(-expense.amount)}</td></tr>)}</tbody></table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Documentos incluidos</CardTitle><CardDescription>{documents.length} documento(s) incluidos en el período.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Fecha</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Tercero</th><th className="px-3 py-3">Folio</th><th className="px-3 py-3">Estado</th><th className="px-3 py-3 text-right">Monto P/L</th></tr></thead><tbody>{documents.length === 0 ? <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">No hay documentos para este período.</td></tr> : documents.map((document) => <tr key={document.id} className="border-b last:border-0"><td className="px-3 py-3">{document.fecha_emision ? format(parseLocalDate(document.fecha_emision), "dd MMM yyyy", { locale: es }) : "Sin fecha"}</td><td className="px-3 py-3"><DocumentTypeLabel type={document.tipo} /></td><td className="px-3 py-3">{document.tercero_nombre || "Sin tercero"}</td><td className="px-3 py-3">{document.numero_documento || "Sin folio"}</td><td className="px-3 py-3 capitalize">{document.estado || "Sin estado"}</td><td className="px-3 py-3 text-right font-medium">{formatCurrency(documentPnlAmount(document) * (document.tipo.includes("nota_credito") ? -1 : 1))}</td></tr>)}</tbody></table>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, amount, description, tone }: { label: string; amount: number; description: string; tone: "emerald" | "rose" }) {
  return <Card className={tone === "emerald" ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-rose-500"}><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{formatCurrency(amount)}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{description}</CardContent></Card>;
}

function PnlLine({ label, amount, emphasis = false, muted = false, result = false }: { label: string; amount: number; emphasis?: boolean; muted?: boolean; result?: boolean }) {
  return <div className={`flex items-center justify-between ${emphasis ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""} ${result ? (amount >= 0 ? "text-emerald-700" : "text-destructive") : ""}`}><span>{label}</span><span>{formatCurrency(amount)}</span></div>;
}

function DocumentTypeLabel({ type }: { type: PnlDocumentType }) {
  const labels: Record<PnlDocumentType, string> = { venta: "Venta", compra: "Compra", nota_credito: "NC venta", nota_credito_compra: "NC compra" };
  const colors: Record<PnlDocumentType, string> = { venta: "bg-emerald-100 text-emerald-800", compra: "bg-rose-100 text-rose-800", nota_credito: "bg-amber-100 text-amber-800", nota_credito_compra: "bg-sky-100 text-sky-800" };
  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${colors[type]}`}>{labels[type]}</span>;
}
