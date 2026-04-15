import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Landmark, Loader2, Plus, TrendingUp, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useCompany } from "@/contexts/CompanyContext";
import { useBankAccountPositions, usePaymentQueue, useTreasuryKpis } from "@/hooks/useTreasury";
import { formatTreasuryCurrency, formatTreasuryDate } from "@/lib/treasury";
import { cn } from "@/lib/utils";

type InvoiceSummary = {
  id: string;
  fecha_emision: string;
  tercero_nombre: string;
  numero_documento: string;
  monto: number;
  planned_cash_date: string | null;
  cash_confidence_pct: number | null;
};

type MovementSummary = {
  id: string;
  fecha_movimiento: string;
  descripcion: string;
  monto: number;
  estado: string;
};

const today = new Date().toISOString().split("T")[0];

export default function Dashboard() {
  const { selectedEmpresa, selectedEmpresaId } = useCompany();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    receivables: 0,
    pendingCount: 0,
    monthlyRevenue: 0,
    payables: 0,
    payablesCount: 0,
  });
  const [pendingInvoices, setPendingInvoices] = useState<InvoiceSummary[]>([]);
  const [recentMovements, setRecentMovements] = useState<MovementSummary[]>([]);
  const { data: kpis, loading: loadingKpis } = useTreasuryKpis(selectedEmpresaId, today);
  const { data: bankPositions } = useBankAccountPositions(selectedEmpresaId);
  const { data: paymentQueue } = usePaymentQueue(selectedEmpresaId, today);

  useEffect(() => {
    if (selectedEmpresaId) {
      void fetchDashboardData();
    }
  }, [selectedEmpresaId]);

  const fetchDashboardData = async () => {
    if (!selectedEmpresaId) return;
    setLoading(true);
    try {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [{ data: invData }, { data: allPending }, { data: monthlyData }, { data: bankData }, { data: payablesData }] =
        await Promise.all([
          supabase
            .from("facturas")
            .select("id, fecha_emision, tercero_nombre, numero_documento, monto, planned_cash_date, cash_confidence_pct")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "venta")
            .in("estado", ["pendiente", "morosa"])
            .order("fecha_emision", { ascending: true })
            .limit(6),
          supabase
            .from("facturas")
            .select("monto")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "venta")
            .in("estado", ["pendiente", "morosa"]),
          supabase
            .from("facturas")
            .select("monto")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "venta")
            .eq("estado", "pagada")
            .gte("created_at", firstDayOfMonth),
          supabase
            .from("movimientos_banco")
            .select("id, fecha_movimiento, descripcion, monto, estado")
            .eq("empresa_id", selectedEmpresaId)
            .order("fecha_movimiento", { ascending: false })
            .limit(6),
          supabase
            .from("facturas")
            .select("id, monto")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "compra")
            .in("estado", ["pendiente", "morosa"]),
        ]);

      const totalReceivables = (allPending || []).reduce((sum, inv) => sum + Number(inv.monto), 0);
      const totalPayables = (payablesData || []).reduce((sum, inv) => sum + Number(inv.monto), 0);
      const revenue = (monthlyData || []).reduce((sum, inv) => sum + Number(inv.monto), 0);

      setStats({
        receivables: totalReceivables,
        pendingCount: (allPending || []).length,
        monthlyRevenue: revenue,
        payables: totalPayables,
        payablesCount: (payablesData || []).length,
      });

      setPendingInvoices((invData || []) as InvoiceSummary[]);
      setRecentMovements((bankData || []) as MovementSummary[]);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const criticalPaymentsNext7d = useMemo(
    () =>
      paymentQueue
        .filter((item) => item.priority === "critical" || item.priority === "high")
        .slice(0, 5),
    [paymentQueue]
  );

  const minProjectedTone =
    kpis.minProjectedCash < 0 ? "danger" : kpis.minProjectedCash < (kpis.currentCash || 0) ? "warning" : "default";

  if (loading || loadingKpis) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Resumen de la Empresa</h1>
          <p className="mt-1 text-muted-foreground">
            Panorama financiero y de tesorería para {selectedEmpresa?.nombre || "la empresa"}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild className="gap-2">
            <Link to="/cashflow">
              <TrendingUp className="h-4 w-4" />
              Abrir Tesorería
            </Link>
          </Button>
          <Button variant="outline" asChild className="gap-2">
            <Link to="/facturas/nueva">
              <Plus className="h-4 w-4" />
              Nueva Factura
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Por Cobrar Total"
          value={formatTreasuryCurrency(stats.receivables)}
          description={`${stats.pendingCount} documentos abiertos`}
          icon={<ArrowUpRight className="h-4 w-4" />}
        />
        <MetricCard
          title="Ingresos del Mes"
          value={formatTreasuryCurrency(stats.monthlyRevenue)}
          description="Facturas de venta pagadas este mes"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          title="Por Pagar"
          value={formatTreasuryCurrency(stats.payables)}
          description={`${stats.payablesCount} documentos por pagar`}
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="warning"
        />
        <MetricCard
          title="Cuentas Bancarias"
          value={String(bankPositions.length)}
          description="Cuentas activas en tesorería"
          icon={<Landmark className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Caja Actual"
          value={formatTreasuryCurrency(kpis.currentCash)}
          description="Saldo consolidado por cuenta"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          title="Mínimo Proyectado 13 Semanas"
          value={formatTreasuryCurrency(kpis.minProjectedCash)}
          description={kpis.minProjectedWeek ? `Semana del ${formatTreasuryDate(kpis.minProjectedWeek)}` : "Sin quiebre detectado"}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={minProjectedTone}
        />
        <MetricCard
          title="Pagos Críticos 7 Días"
          value={formatTreasuryCurrency(kpis.dueOutflowsNext7d)}
          description="Egresos comprometidos próximos 7 días"
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="warning"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Cobranzas Abiertas</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/collections">Ver pipeline</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingInvoices.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                No hay facturas de venta pendientes.
              </div>
            ) : (
              pendingInvoices.map((invoice) => (
                <div key={invoice.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-medium">{invoice.tercero_nombre || "Sin cliente"}</div>
                      <div className="text-sm text-muted-foreground">
                        {invoice.numero_documento ? `Factura ${invoice.numero_documento}` : "Sin folio"} • emitida {formatTreasuryDate(invoice.fecha_emision)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatTreasuryCurrency(invoice.monto)}</div>
                      <div className="text-xs text-muted-foreground">
                        Cobro esperado {formatTreasuryDate(invoice.planned_cash_date)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Badge variant="outline" className="text-xs">
                      Confianza {invoice.cash_confidence_pct ?? 60}%
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Pagos Prioritarios</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/cashflow">Abrir cola</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {criticalPaymentsNext7d.length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  No hay pagos críticos visibles.
                </div>
              )}
              {criticalPaymentsNext7d.map((item) => (
                <div key={`${item.sourceType}-${item.sourceId}`} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{item.counterparty}</div>
                      <div className="text-sm text-muted-foreground">{item.categoryName}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{formatTreasuryCurrency(item.amount)}</div>
                      <div className="text-xs text-muted-foreground">{formatTreasuryDate(item.expectedDate)}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        item.priority === "critical"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      )}
                    >
                      {item.priority === "critical" ? "Crítico" : "Alta"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{item.suggestedAction}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Últimos movimientos bancarios</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentMovements.length === 0 && (
                <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
                  No hay movimientos cargados.
                </div>
              )}
              {recentMovements.map((movement) => (
                <div key={movement.id} className="flex items-center justify-between gap-3 rounded-xl border p-4">
                  <div>
                    <div className="font-medium">{movement.descripcion || "Sin descripción"}</div>
                    <div className="text-sm text-muted-foreground">{formatTreasuryDate(movement.fecha_movimiento)}</div>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-semibold", movement.monto >= 0 ? "text-emerald-700" : "text-red-700")}>
                      {formatTreasuryCurrency(movement.monto)}
                    </div>
                    <div className="text-xs text-muted-foreground">{movement.estado}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
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
  icon: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <Card className={cn(tone === "warning" && "border-amber-200", tone === "danger" && "border-red-200")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div
          className={cn(
            "rounded-full p-2",
            tone === "warning"
              ? "bg-amber-50 text-amber-700"
              : tone === "danger"
                ? "bg-red-50 text-red-700"
                : "bg-primary/10 text-primary"
          )}
        >
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
