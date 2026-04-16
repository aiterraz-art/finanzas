import { type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Landmark,
  Loader2,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "@/contexts/CompanyContext";
import {
  useBankAccountPositions,
  useCollectionPipeline,
  usePaymentQueue,
  useTreasuryForecast,
  useTreasuryKpis,
  useTreasuryOpenItems,
  useTreasuryPolicy,
} from "@/hooks/useTreasury";
import {
  PRIORITY_BADGE_CLASSES,
  PRIORITY_LABELS,
  formatTreasuryCurrency,
  formatTreasuryDate,
  getConfidenceClasses,
  getConfidenceLabel,
} from "@/lib/treasury";
import type { TreasuryOpenItem, TreasuryWeek } from "@/lib/treasury";
import { cn } from "@/lib/utils";

const today = new Date().toISOString().split("T")[0];

const sourceLabels: Record<string, string> = {
  invoice_receivable: "Factura cliente",
  invoice_payable: "Factura proveedor",
  rendicion: "Rendicion",
  commitment: "Compromiso",
  cheque_receivable: "Cheque en cartera",
  webpay_receivable: "WebPay por recibir",
};

export default function CashFlow() {
  const { selectedEmpresa, selectedEmpresaId } = useCompany();
  const [asOfDate, setAsOfDate] = useState(today);
  const [selectedWeek, setSelectedWeek] = useState<TreasuryWeek | null>(null);
  const [calendarSourceFilter, setCalendarSourceFilter] = useState("all");
  const [calendarDirectionFilter, setCalendarDirectionFilter] = useState("all");
  const [calendarPriorityFilter, setCalendarPriorityFilter] = useState("all");

  const { data: policy } = useTreasuryPolicy(selectedEmpresaId);
  const { data: kpis, loading: loadingKpis, error: kpisError, refresh: refreshKpis } = useTreasuryKpis(selectedEmpresaId, asOfDate);
  const { data: forecast, loading: loadingForecast, error: forecastError, refresh: refreshForecast } = useTreasuryForecast(selectedEmpresaId, asOfDate, 13);
  const { data: paymentQueue, loading: loadingPayments, refresh: refreshPayments } = usePaymentQueue(selectedEmpresaId, asOfDate);
  const { data: collectionPipeline, loading: loadingCollections, refresh: refreshCollections } = useCollectionPipeline(selectedEmpresaId, asOfDate);
  const { data: bankPositions, loading: loadingAccounts, refresh: refreshAccounts } = useBankAccountPositions(selectedEmpresaId);
  const { data: openItems, loading: loadingOpenItems, refresh: refreshOpenItems } = useTreasuryOpenItems(selectedEmpresaId);

  const selectedWeekItems = useMemo(() => {
    if (!selectedWeek) return [];
    return openItems.filter(
      (item) => item.expectedDate >= selectedWeek.weekStart && item.expectedDate <= selectedWeek.weekEnd
    );
  }, [openItems, selectedWeek]);

  const filteredCalendarItems = useMemo(() => {
    return openItems.filter((item) => {
      if (calendarSourceFilter !== "all" && item.sourceType !== calendarSourceFilter) return false;
      if (calendarDirectionFilter !== "all" && item.direction !== calendarDirectionFilter) return false;
      if (calendarPriorityFilter !== "all" && item.priority !== calendarPriorityFilter) return false;
      return true;
    });
  }, [calendarDirectionFilter, calendarPriorityFilter, calendarSourceFilter, openItems]);

  const maxClosingCash = useMemo(() => {
    const values = forecast.map((week) => Math.abs(week.closingCash));
    return Math.max(...values, 1);
  }, [forecast]);

  const alerts = useMemo(() => {
    const nextAlerts: Array<{ title: string; description: string; tone: "default" | "destructive" }> = [];

    const negativeWeek = forecast.find((week) => week.negativeCash);
    if (negativeWeek) {
      nextAlerts.push({
        title: "Caja negativa proyectada",
        description: `La semana del ${formatTreasuryDate(negativeWeek.weekStart)} cierra en ${formatTreasuryCurrency(negativeWeek.closingCash, policy.monedaBase)}.`,
        tone: "destructive",
      });
    }

    const belowBufferWeek = forecast.find((week) => week.belowBuffer);
    if (belowBufferWeek) {
      nextAlerts.push({
        title: "Buffer minimo comprometido",
        description: `El forecast cae bajo el buffer durante la semana del ${formatTreasuryDate(belowBufferWeek.weekStart)}.`,
        tone: "default",
      });
    }

    if (kpis.staleBankAccountsCount > 0) {
      nextAlerts.push({
        title: "Cartolas desactualizadas",
        description: `Hay ${kpis.staleBankAccountsCount} cuenta(s) sin importacion reciente.`,
        tone: "default",
      });
    }

    if (kpis.missingForecastDataCount > 0) {
      nextAlerts.push({
        title: "Datos incompletos para forecast",
        description: `Hay ${kpis.missingForecastDataCount} documento(s) sin categoria o fecha esperada.`,
        tone: "default",
      });
    }

    if (kpis.taxesDueNext14d > 0 || kpis.payrollDueNext14d > 0) {
      nextAlerts.push({
        title: "Obligaciones sensibles en 14 dias",
        description: `Impuestos ${formatTreasuryCurrency(kpis.taxesDueNext14d, policy.monedaBase)} y nomina ${formatTreasuryCurrency(kpis.payrollDueNext14d, policy.monedaBase)}.`,
        tone: "default",
      });
    }

    const pendingFollowup = collectionPipeline.filter((item) => {
      if (!item.lastContactAt) return item.daysOverdue > 0;
      return new Date(item.lastContactAt).getTime() < Date.now() - policy.missingFollowupDays * 24 * 60 * 60 * 1000;
    });
    if (pendingFollowup.length > 0) {
      nextAlerts.push({
        title: "Cobranzas sin gestion reciente",
        description: `${pendingFollowup.length} factura(s) necesitan seguimiento comercial inmediato.`,
        tone: "default",
      });
    }

    return nextAlerts;
  }, [collectionPipeline, forecast, kpis, policy]);

  const handleRefreshAll = async () => {
    await Promise.all([
      refreshKpis(),
      refreshForecast(),
      refreshPayments(),
      refreshCollections(),
      refreshAccounts(),
      refreshOpenItems(),
    ]);
  };

  const loading =
    loadingKpis ||
    loadingForecast ||
    loadingPayments ||
    loadingCollections ||
    loadingAccounts ||
    loadingOpenItems;

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Flujo de Caja sin empresa activa</CardTitle>
            <CardDescription>Selecciona una empresa para calcular forecast, colas y alertas.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (loading && forecast.length === 0 && paymentQueue.length === 0) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flujo de Caja</h1>
          <p className="text-muted-foreground mt-1">
            Caja actual y proyectada para {selectedEmpresa?.nombre || "la empresa"}, con forecast semanal, pagos y cobranzas.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Fecha base</label>
            <Input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className="w-[180px]" />
          </div>
          <Button variant="outline" onClick={handleRefreshAll}>
            Actualizar cockpit
          </Button>
        </div>
      </div>

      {(kpisError || forecastError) && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>No se pudo cargar tesoreria</AlertTitle>
          <AlertDescription>{kpisError || forecastError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          title="Caja bancaria actual"
          value={formatTreasuryCurrency(kpis.currentCash, policy.monedaBase)}
          description="Saldo real por cuentas importadas"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          title="Caja minima 13 semanas"
          value={formatTreasuryCurrency(kpis.minProjectedCash, policy.monedaBase)}
          description={kpis.minProjectedWeek ? `Semana del ${formatTreasuryDate(kpis.minProjectedWeek)}` : "Sin quiebres detectados"}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={kpis.minProjectedCash < 0 ? "danger" : kpis.minProjectedCash < policy.minimumCashBuffer ? "warning" : "default"}
        />
        <MetricCard
          title="Salidas 7 dias"
          value={formatTreasuryCurrency(kpis.dueOutflowsNext7d, policy.monedaBase)}
          description="Compromisos abiertos y cola de pagos"
          icon={<ArrowDownRight className="h-4 w-4" />}
          tone="warning"
        />
        <MetricCard
          title="Entradas 7 dias"
          value={formatTreasuryCurrency(kpis.expectedInflowsNext7d, policy.monedaBase)}
          description="Cobros ponderados por probabilidad"
          icon={<ArrowUpRight className="h-4 w-4" />}
        />
        <MetricCard
          title="Buffer disponible"
          value={formatTreasuryCurrency(kpis.freeCashNext7d, policy.monedaBase)}
          description={`Buffer minimo ${formatTreasuryCurrency(policy.minimumCashBuffer, policy.monedaBase)}`}
          icon={<Landmark className="h-4 w-4" />}
          tone={kpis.freeCashNext7d < 0 ? "danger" : "default"}
        />
        <MetricCard
          title="Riesgos operativos"
          value={`${kpis.staleBankAccountsCount + kpis.missingForecastDataCount}`}
          description="Cartolas viejas + datos faltantes"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={kpis.staleBankAccountsCount + kpis.missingForecastDataCount > 0 ? "warning" : "default"}
        />
      </div>

      {alerts.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {alerts.map((alert, index) => (
            <Alert key={`${alert.title}-${index}`} variant={alert.tone === "destructive" ? "destructive" : "default"}>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{alert.title}</AlertTitle>
              <AlertDescription>{alert.description}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      <Tabs defaultValue="forecast" className="space-y-4">
        <TabsList className="grid h-auto grid-cols-2 gap-1 md:grid-cols-5">
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
          <TabsTrigger value="payments">Pagos</TabsTrigger>
          <TabsTrigger value="collections">Cobros</TabsTrigger>
          <TabsTrigger value="calendar">Calendario</TabsTrigger>
          <TabsTrigger value="accounts">Cuentas</TabsTrigger>
        </TabsList>

        <TabsContent value="forecast" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Forecast 13 semanas</CardTitle>
                <CardDescription>Entradas ponderadas por probabilidad y salidas comprometidas al 100%.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-13">
                  {forecast.map((week) => {
                    const height = Math.max((Math.abs(week.closingCash) / maxClosingCash) * 160, 14);
                    return (
                      <button
                        key={week.weekStart}
                        type="button"
                        onClick={() => setSelectedWeek(week)}
                        className="group rounded-xl border bg-muted/20 p-3 text-left transition hover:border-primary/40 hover:bg-primary/5"
                      >
                        <div className="text-[11px] font-medium uppercase text-muted-foreground">
                          {formatTreasuryDate(week.weekStart)}
                        </div>
                        <div className="mt-3 flex h-44 items-end justify-center">
                          <div
                            className={cn(
                              "w-full rounded-t-lg transition-all",
                              week.negativeCash
                                ? "bg-red-500"
                                : week.belowBuffer
                                  ? "bg-amber-400"
                                  : "bg-emerald-500"
                            )}
                            style={{ height }}
                          />
                        </div>
                        <div className="mt-3 space-y-1">
                          <div className="text-sm font-semibold">
                            {formatTreasuryCurrency(week.closingCash, policy.monedaBase)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatTreasuryCurrency(week.expectedInflows, policy.monedaBase)} / {formatTreasuryCurrency(week.committedOutflows, policy.monedaBase)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left">Semana</th>
                        <th className="px-4 py-3 text-right">Apertura</th>
                        <th className="px-4 py-3 text-right">Entradas</th>
                        <th className="px-4 py-3 text-right">Salidas</th>
                        <th className="px-4 py-3 text-right">Cierre</th>
                        <th className="px-4 py-3 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.map((week) => (
                        <tr key={week.weekStart} className="border-t">
                          <td className="px-4 py-3">
                            <button type="button" className="font-medium text-primary" onClick={() => setSelectedWeek(week)}>
                              {formatTreasuryDate(week.weekStart)} - {formatTreasuryDate(week.weekEnd)}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">{formatTreasuryCurrency(week.openingCash, policy.monedaBase)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700">{formatTreasuryCurrency(week.expectedInflows, policy.monedaBase)}</td>
                          <td className="px-4 py-3 text-right text-red-700">{formatTreasuryCurrency(week.committedOutflows, policy.monedaBase)}</td>
                          <td className="px-4 py-3 text-right font-semibold">{formatTreasuryCurrency(week.closingCash, policy.monedaBase)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                week.negativeCash
                                  ? "border-red-200 bg-red-50 text-red-700"
                                  : week.belowBuffer
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              )}
                            >
                              {week.negativeCash ? "Caja negativa" : week.belowBuffer ? "Bajo buffer" : "Controlado"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Alertas de decision</CardTitle>
                <CardDescription>Se construyen desde forecast, cobranzas, cuentas e higiene de datos.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {alerts.length === 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    No hay alertas criticas para la fecha base seleccionada.
                  </div>
                )}
                {alerts.map((alert, index) => (
                  <div key={`${alert.title}-${index}`} className="rounded-lg border p-4">
                    <div className="font-medium">{alert.title}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{alert.description}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="payments">
            <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Cola de pagos</CardTitle>
                <CardDescription>Prioriza egresos por criticidad, vencimiento y restricciones de caja.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/egresos">Abrir Egresos</Link>
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Contraparte</th>
                    <th className="px-4 py-3 text-left">Categoria</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3 text-left">Vencimiento</th>
                    <th className="px-4 py-3 text-left">Fecha esperada</th>
                    <th className="px-4 py-3 text-center">Prioridad</th>
                    <th className="px-4 py-3 text-left">Accion sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentQueue.map((item) => (
                    <tr key={`${item.sourceType}-${item.sourceId}`} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.counterparty}</div>
                        <div className="text-xs text-muted-foreground">{sourceLabels[item.sourceType] || item.sourceType}</div>
                      </td>
                      <td className="px-4 py-3">{item.categoryName}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatTreasuryCurrency(item.amount, policy.monedaBase)}</td>
                      <td className="px-4 py-3">{formatTreasuryDate(item.dueDate)}</td>
                      <td className="px-4 py-3">{formatTreasuryDate(item.expectedDate)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="outline" className={cn("capitalize", PRIORITY_BADGE_CLASSES[item.priority])}>
                          {PRIORITY_LABELS[item.priority]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.suggestedAction}</div>
                        {item.notes && <div className="text-xs text-muted-foreground">{item.notes}</div>}
                      </td>
                    </tr>
                  ))}
                  {paymentQueue.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                        {loadingPayments ? "Cargando cola de pagos..." : "No hay egresos abiertos para la fecha seleccionada."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collections">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline de cobranzas</CardTitle>
              <CardDescription>Seguimiento comercial para empujar cobros reales, no solo documentos vencidos.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Cliente</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3 text-left">Vence</th>
                    <th className="px-4 py-3 text-left">Fecha esperada</th>
                    <th className="px-4 py-3 text-center">Confianza</th>
                    <th className="px-4 py-3 text-left">Ultima gestion</th>
                    <th className="px-4 py-3 text-left">Accion sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {collectionPipeline.map((item) => (
                    <tr key={item.facturaId} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.terceroNombre}</div>
                        <div className="text-xs text-muted-foreground">Doc. {item.numeroDocumento || "S/F"}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatTreasuryCurrency(item.amount, policy.monedaBase)}</td>
                      <td className="px-4 py-3">{formatTreasuryDate(item.dueDate)}</td>
                      <td className="px-4 py-3">
                        <div>{formatTreasuryDate(item.expectedDate)}</div>
                        {item.promisedPaymentDate && (
                          <div className="text-xs text-muted-foreground">Promesa {formatTreasuryDate(item.promisedPaymentDate)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className={cn("font-semibold", getConfidenceClasses(item.confidencePct))}>
                          {item.confidencePct}%
                        </div>
                        <div className="text-xs text-muted-foreground">{getConfidenceLabel(item.confidencePct)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div>{item.lastContactAt ? new Date(item.lastContactAt).toLocaleDateString("es-CL") : "Sin gestion"}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.daysOverdue > 0 ? `${item.daysOverdue} dias de mora` : "Al dia"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.suggestedNextAction}</div>
                        {item.disputed && <div className="text-xs text-red-600">Factura en disputa</div>}
                      </td>
                    </tr>
                  ))}
                  {collectionPipeline.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                        {loadingCollections ? "Cargando pipeline..." : "No hay cobranzas abiertas para la fecha seleccionada."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle>Calendario de compromisos</CardTitle>
              <CardDescription>Todos los flujos futuros relevantes normalizados en una sola cola cronologica.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Select value={calendarSourceFilter} onValueChange={setCalendarSourceFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Origen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los orígenes</SelectItem>
                    <SelectItem value="invoice_receivable">Facturas cliente</SelectItem>
                    <SelectItem value="invoice_payable">Facturas proveedor</SelectItem>
                    <SelectItem value="rendicion">Rendiciones</SelectItem>
                    <SelectItem value="commitment">Compromisos</SelectItem>
                    <SelectItem value="cheque_receivable">Cheques</SelectItem>
                    <SelectItem value="webpay_receivable">WebPay</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={calendarDirectionFilter} onValueChange={setCalendarDirectionFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Dirección" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Entradas y salidas</SelectItem>
                    <SelectItem value="inflow">Solo entradas</SelectItem>
                    <SelectItem value="outflow">Solo salidas</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={calendarPriorityFilter} onValueChange={setCalendarPriorityFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Prioridad" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las prioridades</SelectItem>
                    <SelectItem value="critical">Crítica</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="deferrable">Postergable</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {filteredCalendarItems.map((item) => (
                <div key={`${item.sourceType}-${item.sourceId}`} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.counterparty}</span>
                        <Badge variant="outline" className={cn("capitalize", PRIORITY_BADGE_CLASSES[item.priority])}>
                          {PRIORITY_LABELS[item.priority]}
                        </Badge>
                        <Badge variant="secondary">{sourceLabels[item.sourceType] || item.sourceType}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {item.categoryName} • {formatTreasuryDate(item.expectedDate)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("font-semibold", item.direction === "inflow" ? "text-emerald-700" : "text-red-700")}>
                        {item.direction === "inflow" ? "+" : "-"}
                        {formatTreasuryCurrency(item.amount, policy.monedaBase)}
                      </div>
                      <div className="text-xs text-muted-foreground">Vence {formatTreasuryDate(item.dueDate)}</div>
                    </div>
                  </div>
                  {item.notes && <div className="mt-3 text-sm text-muted-foreground">{item.notes}</div>}
                </div>
              ))}
              {filteredCalendarItems.length === 0 && (
                <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                  {loadingOpenItems ? "Cargando calendario..." : "No hay compromisos abiertos para la empresa."}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <Card>
            <CardHeader>
              <CardTitle>Cuentas bancarias</CardTitle>
              <CardDescription>Posicion actual por cuenta, ultima cartola y foco de conciliacion.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Cuenta</th>
                    <th className="px-4 py-3 text-left">Banco</th>
                    <th className="px-4 py-3 text-right">Saldo actual</th>
                    <th className="px-4 py-3 text-left">Ultima cartola</th>
                    <th className="px-4 py-3 text-right">No conciliados</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {bankPositions.map((account) => (
                    <tr key={account.bankAccountId} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{account.accountName}</div>
                        <div className="text-xs text-muted-foreground">{account.tipo}</div>
                      </td>
                      <td className="px-4 py-3">{account.banco || "Banco no informado"}</td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatTreasuryCurrency(account.currentBalance, account.moneda)}
                      </td>
                      <td className="px-4 py-3">{formatTreasuryDate(account.latestStatementDate, "Sin cartola")}</td>
                      <td className="px-4 py-3 text-right">
                        <div>{account.unreconciledCount} mov.</div>
                        <div className="text-xs text-muted-foreground">
                          {formatTreasuryCurrency(account.unreconciledAmount, account.moneda)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            account.staleImport
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          )}
                        >
                          {account.staleImport ? "Importacion vieja" : "Al dia"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {bankPositions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        {loadingAccounts ? "Cargando cuentas..." : "No hay cuentas bancarias configuradas."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(selectedWeek)} onOpenChange={(open) => !open && setSelectedWeek(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Detalle semanal</DialogTitle>
            <DialogDescription>
              {selectedWeek
                ? `Semana del ${formatTreasuryDate(selectedWeek.weekStart)} al ${formatTreasuryDate(selectedWeek.weekEnd)}.`
                : "Selecciona una semana para revisar su composicion."}
            </DialogDescription>
          </DialogHeader>

          {selectedWeek && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <SmallMetric title="Apertura" value={formatTreasuryCurrency(selectedWeek.openingCash, policy.monedaBase)} icon={<Wallet className="h-4 w-4" />} />
                <SmallMetric title="Entradas" value={formatTreasuryCurrency(selectedWeek.expectedInflows, policy.monedaBase)} icon={<ArrowUpRight className="h-4 w-4" />} />
                <SmallMetric title="Salidas" value={formatTreasuryCurrency(selectedWeek.committedOutflows, policy.monedaBase)} icon={<ArrowDownRight className="h-4 w-4" />} />
                <SmallMetric title="Cierre" value={formatTreasuryCurrency(selectedWeek.closingCash, policy.monedaBase)} icon={<CalendarDays className="h-4 w-4" />} />
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Origen</th>
                      <th className="px-4 py-3 text-left">Contraparte</th>
                      <th className="px-4 py-3 text-left">Fecha esperada</th>
                      <th className="px-4 py-3 text-right">Monto</th>
                      <th className="px-4 py-3 text-center">Prioridad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWeekItems.map((item: TreasuryOpenItem) => (
                      <tr key={`${item.sourceType}-${item.sourceId}`} className="border-t">
                        <td className="px-4 py-3">{sourceLabels[item.sourceType] || item.sourceType}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{item.counterparty}</div>
                          <div className="text-xs text-muted-foreground">{item.categoryName}</div>
                        </td>
                        <td className="px-4 py-3">{formatTreasuryDate(item.expectedDate)}</td>
                        <td className={cn("px-4 py-3 text-right font-semibold", item.direction === "inflow" ? "text-emerald-700" : "text-red-700")}>
                          {item.direction === "inflow" ? "+" : "-"}
                          {formatTreasuryCurrency(item.amount, policy.monedaBase)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="outline" className={cn("capitalize", PRIORITY_BADGE_CLASSES[item.priority])}>
                            {PRIORITY_LABELS[item.priority]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {selectedWeekItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                          No hay items abiertos en esta semana.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
  icon: ReactNode;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <Card className={cn(tone === "danger" && "border-red-200", tone === "warning" && "border-amber-200")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div
          className={cn(
            "rounded-full p-2",
            tone === "danger"
              ? "bg-red-50 text-red-700"
              : tone === "warning"
                ? "bg-amber-50 text-amber-700"
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

function SmallMetric({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{title}</span>
        {icon}
      </div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  );
}
