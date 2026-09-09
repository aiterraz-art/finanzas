import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Loader2, RefreshCw, UsersRound, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { formatTreasuryCurrency, formatTreasuryDate } from "@/lib/treasury";

type PaymentKind = "payroll" | "professional_fees";

type PaymentRow = {
  id: string;
  kind: PaymentKind;
  categoryName: string;
  description: string;
  counterparty: string | null;
  amount: number;
  status: string;
  paymentDate: string | null;
  accrualMonth: string | null;
  bankMovementId: string | null;
};

const statusLabels: Record<string, string> = {
  paid: "Pagado",
  planned: "Planificado",
  confirmed: "Confirmado",
  deferred: "Diferido",
  cancelled: "Anulado",
};

export default function PayrollAndFees() {
  const { selectedEmpresaId } = useCompany();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("paid");
  const [monthFilter, setMonthFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const loadRows = async () => {
    if (!selectedEmpresaId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("cash_commitments")
        .select("id, description, counterparty, amount, status, expected_date, due_date, accrual_month, created_at, movimiento_banco_id, treasury_categories!inner(code, nombre), movimientos_banco(fecha_movimiento)")
        .eq("empresa_id", selectedEmpresaId)
        .eq("direction", "outflow")
        .in("treasury_categories.code", ["payroll", "professional_fees"])
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;

      setRows((data || []).map((row: any) => {
        const category = Array.isArray(row.treasury_categories) ? row.treasury_categories[0] : row.treasury_categories;
        const bankMovement = Array.isArray(row.movimientos_banco) ? row.movimientos_banco[0] : row.movimientos_banco;
        return {
          id: row.id,
          kind: category?.code === "professional_fees" ? "professional_fees" : "payroll",
          categoryName: category?.nombre || (category?.code === "professional_fees" ? "Honorarios" : "Remuneraciones"),
          description: row.description || "Sin descripción",
          counterparty: row.counterparty || null,
          amount: Number(row.amount || 0),
          status: row.status || "planned",
          paymentDate: bankMovement?.fecha_movimiento || row.expected_date || row.due_date || null,
          accrualMonth: row.accrual_month || null,
          bankMovementId: row.movimiento_banco_id || null,
        };
      }));
    } catch (loadError: any) {
      console.error("Error loading payroll and fees:", loadError);
      setError(`No se pudieron cargar los pagos: ${loadError.message}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, [selectedEmpresaId]);

  const availableMonths = useMemo(
    () => Array.from(new Set(rows.map((row) => row.paymentDate?.slice(0, 7)).filter(Boolean) as string[])).sort().reverse(),
    [rows]
  );

  const filteredRows = useMemo(
    () => rows.filter((row) => (statusFilter === "all" || row.status === statusFilter) && (monthFilter === "all" || row.paymentDate?.startsWith(monthFilter))),
    [monthFilter, rows, statusFilter]
  );

  const totals = useMemo(() => filteredRows.reduce((summary, row) => {
    if (row.kind === "payroll") summary.payroll += row.amount;
    else summary.fees += row.amount;
    if (row.status === "paid") summary.paid += row.amount;
    return summary;
  }, { payroll: 0, fees: 0, paid: 0 }), [filteredRows]);

  if (!selectedEmpresaId) {
    return <div className="flex h-[70vh] items-center justify-center"><Card><CardHeader><CardTitle>Remuneraciones y Honorarios</CardTitle><CardDescription>Selecciona una empresa para ver los pagos conciliados.</CardDescription></CardHeader></Card></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Remuneraciones y Honorarios</h1>
          <p className="mt-1 text-muted-foreground">Pagos clasificados en Banco. Los registros pagados corresponden a movimientos conciliados.</p>
        </div>
        <Button variant="outline" onClick={() => void loadRows()}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Remuneraciones" value={formatTreasuryCurrency(totals.payroll)} description="Período y estado filtrados" icon={<UsersRound className="h-5 w-5 text-primary" />} />
        <SummaryCard title="Honorarios" value={formatTreasuryCurrency(totals.fees)} description="Período y estado filtrados" icon={<BriefcaseBusiness className="h-5 w-5 text-primary" />} />
        <SummaryCard title="Pagado y conciliado" value={formatTreasuryCurrency(totals.paid)} description="Solo registros con estado pagado" icon={<WalletCards className="h-5 w-5 text-emerald-600" />} />
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2"><span className="text-sm font-medium">Estado</span><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="paid">Pagados / conciliados</SelectItem><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="planned">Planificados</SelectItem><SelectItem value="confirmed">Confirmados</SelectItem><SelectItem value="deferred">Diferidos</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><span className="text-sm font-medium">Mes</span><Select value={monthFilter} onValueChange={setMonthFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los meses</SelectItem>{availableMonths.map((month) => <SelectItem key={month} value={month}>{month}</SelectItem>)}</SelectContent></Select></div>
        </CardContent>
      </Card>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <Card>
        <CardHeader><CardTitle>Pagos registrados</CardTitle><CardDescription>{filteredRows.length} registro(s) encontrados.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : <table className="w-full min-w-[840px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Fecha pago</th><th className="px-3 py-3">Mes P/L</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Beneficiario / detalle</th><th className="px-3 py-3">Estado</th><th className="px-3 py-3">Origen</th><th className="px-3 py-3 text-right">Monto</th></tr></thead><tbody>{filteredRows.length === 0 ? <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No hay pagos para los filtros seleccionados.</td></tr> : filteredRows.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="px-3 py-3">{formatTreasuryDate(row.paymentDate)}</td><td className="px-3 py-3">{row.accrualMonth?.slice(0, 7) || "Sin asignar"}</td><td className="px-3 py-3"><Badge variant={row.kind === "payroll" ? "default" : "secondary"}>{row.kind === "payroll" ? "Remuneración" : "Honorario"}</Badge></td><td className="px-3 py-3"><div className="font-medium">{row.counterparty || "Sin beneficiario"}</div><div className="text-xs text-muted-foreground">{row.description}</div></td><td className="px-3 py-3"><Badge variant="outline">{statusLabels[row.status] || row.status}</Badge></td><td className="px-3 py-3">{row.bankMovementId ? "Conciliado en banco" : "Programado"}</td><td className="px-3 py-3 text-right font-semibold">{formatTreasuryCurrency(row.amount)}</td></tr>)}</tbody></table>}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ title, value, description, icon }: { title: string; value: string; description: string; icon: ReactNode }) {
  return <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">{title}</CardTitle>{icon}</CardHeader><CardContent><div className="text-2xl font-bold">{value}</div><p className="mt-1 text-xs text-muted-foreground">{description}</p></CardContent></Card>;
}
