import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingUp, TrendingDown, DollarSign, Loader2, Calendar, FileDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { format, startOfMonth, endOfMonth, subMonths, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import * as XLSX from "xlsx";
import { useCompany } from "@/contexts/CompanyContext";

export default function Reports() {
    const { selectedEmpresaId } = useCompany();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        monthlyIncome: 0,
        monthlyExpenses: 0,
        netProfit: 0,
        pendingReceivables: 0,
        incomeChange: 0,
        expenseChange: 0
    });
    const [topClients, setTopClients] = useState<any[]>([]);
    const [monthlyData, setMonthlyData] = useState<any[]>([]);
    const [recentTransactions, setRecentTransactions] = useState<any[]>([]);

    useEffect(() => {
        if (selectedEmpresaId) fetchReportData();
    }, [selectedEmpresaId]);

    const fetchReportData = async () => {
        if (!selectedEmpresaId) return;
        setLoading(true);
        try {
            const now = new Date();
            const startOfCurrentMonth = startOfMonth(now);
            const endOfCurrentMonth = endOfMonth(now);
            const startOfPrevMonth = startOfMonth(subMonths(now, 1));
            const endOfPrevMonth = endOfMonth(subMonths(now, 1));
            const sixMonthsAgo = startOfMonth(subMonths(now, 5));

            // 1. Fetch current month invoices
            const { data: currentMonthInvoices } = await supabase
                .from('facturas')
                .select('*')
                .eq('empresa_id', selectedEmpresaId)
                .gte('fecha_emision', format(startOfCurrentMonth, 'yyyy-MM-dd'))
                .lte('fecha_emision', format(endOfCurrentMonth, 'yyyy-MM-dd'))
                .is('archived_at', null);

            // 2. Fetch previous month data for comparison
            const { data: prevMonthInvoices } = await supabase
                .from('facturas')
                .select('*')
                .eq('empresa_id', selectedEmpresaId)
                .gte('fecha_emision', format(startOfPrevMonth, 'yyyy-MM-dd'))
                .lte('fecha_emision', format(endOfPrevMonth, 'yyyy-MM-dd'))
                .is('archived_at', null);

            // 3. Fetch all pending for receivables KPI
            const { data: pendingInvoices } = await supabase
                .from('facturas')
                .select('monto')
                .eq('empresa_id', selectedEmpresaId)
                .eq('tipo', 'venta')
                .in('estado', ['pendiente', 'morosa', 'abonada'])
                .is('archived_at', null);

            // 4. Fetch last 6 months for chart
            const { data: historicalInvoices } = await supabase
                .from('facturas')
                .select('tipo, monto, monto_neto, monto_exento, fecha_emision, created_at, estado')
                .eq('empresa_id', selectedEmpresaId)
                .gte('fecha_emision', format(sixMonthsAgo, 'yyyy-MM-dd'))
                .in('tipo', ['venta', 'compra', 'nota_credito', 'nota_credito_compra'])
                .is('archived_at', null);

            // 5. Fetch recent transactions for details
            const { data: recent } = await supabase
                .from('facturas')
                .select('*')
                .eq('empresa_id', selectedEmpresaId)
                .is('archived_at', null)
                .order('fecha_emision', { ascending: false })
                .limit(20);

            const pnlAmount = (invoice: any) => {
                const net = invoice.monto_neto == null ? null : Number(invoice.monto_neto);
                const exempt = invoice.monto_exento == null ? null : Number(invoice.monto_exento);
                return net !== null || exempt !== null
                    ? (Number.isFinite(net || 0) ? net || 0 : 0) + (Number.isFinite(exempt || 0) ? exempt || 0 : 0)
                    : Number(invoice.monto || 0);
            };
            const calculatePnl = (list: any[] | null, side: 'income' | 'expense') => {
                if (!list) return 0;
                return list.reduce((sum, invoice) => {
                    const isIncome = invoice.tipo === 'venta' || invoice.tipo === 'nota_credito';
                    if ((side === 'income') !== isIncome) return sum;
                    const sign = invoice.tipo === 'nota_credito' || invoice.tipo === 'nota_credito_compra' ? -1 : 1;
                    return sum + sign * pnlAmount(invoice);
                }, 0);
            };

            const incomeCurr = calculatePnl(currentMonthInvoices, 'income');
            const expensesCurr = calculatePnl(currentMonthInvoices, 'expense');
            const incomePrev = calculatePnl(prevMonthInvoices, 'income');
            const expensesPrev = calculatePnl(prevMonthInvoices, 'expense');

            const incomeChange = incomePrev === 0 ? 100 : ((incomeCurr - incomePrev) / incomePrev) * 100;
            const expenseChange = expensesPrev === 0 ? 100 : ((expensesCurr - expensesPrev) / expensesPrev) * 100;

            const totalPending = (pendingInvoices || []).reduce((sum, inv) => sum + Number(inv.monto), 0);

            setStats({
                monthlyIncome: incomeCurr,
                monthlyExpenses: expensesCurr,
                netProfit: incomeCurr - expensesCurr,
                pendingReceivables: totalPending,
                incomeChange,
                expenseChange
            });

            // Top Clients (Current Month)
            const clientGroups: Record<string, { amount: number, count: number }> = {};
            currentMonthInvoices?.filter(inv => inv.tipo === 'venta' || inv.tipo === 'nota_credito').forEach(inv => {
                const name = inv.tercero_nombre || 'S/N';
                if (!clientGroups[name]) clientGroups[name] = { amount: 0, count: 0 };
                clientGroups[name].amount += (inv.tipo === 'nota_credito' ? -1 : 1) * pnlAmount(inv);
                clientGroups[name].count += inv.tipo === 'venta' ? 1 : 0;
            });

            const top = Object.entries(clientGroups)
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 5);

            setTopClients(top);
            setRecentTransactions(recent || []);

            // Process Monthly Data for Chart
            const months = [];
            for (let i = 5; i >= 0; i--) {
                const d = subMonths(now, i);
                const monthName = format(d, 'MMM', { locale: es });

                const monthInvoices = historicalInvoices?.filter(inv => {
                    const invDate = new Date((inv.fecha_emision || inv.created_at).split('T')[0] + 'T12:00:00');
                    return isSameMonth(invDate, d);
                }) || [];

                const inc = calculatePnl(monthInvoices, 'income');
                const exp = calculatePnl(monthInvoices, 'expense');

                months.push({
                    name: monthName,
                    income: inc,
                    expenses: exp
                });
            }
            setMonthlyData(months);

        } catch (error) {
            console.error("Error loading report data:", error);
        } finally {
            setLoading(false);
        }
    };

    const exportToExcel = () => {
        const data = recentTransactions.map(inv => ({
            Fecha: format(new Date((inv.fecha_emision || inv.created_at).split('T')[0] + 'T12:00:00'), 'dd/MM/yyyy'),
            Tipo: inv.tipo === 'venta' ? 'Ingreso' : 'Egreso',
            Estado: inv.estado,
            Tercero: inv.tercero_nombre,
            Monto: inv.monto,
            Glosa: inv.glosa
        }));

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Transacciones");
        XLSX.writeFile(wb, `Reporte_Financiero_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    if (loading) {
        return (
            <div className="flex h-[80vh] items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="container mx-auto py-6 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">P/L y Reportes Financieros</h2>
                    <p className="text-muted-foreground">Resultado por devengo según la fecha de emisión de facturas, independiente del cobro o pago bancario.</p>
                </div>
                <div className="flex items-center space-x-2">
                    <Button variant="outline" onClick={fetchReportData} className="gap-2">
                        <Calendar className="w-4 h-4" />
                        Actualizar
                    </Button>
                    <Button variant="default" onClick={exportToExcel} className="gap-2">
                        <FileDown className="w-4 h-4" />
                        Exportar Excel
                    </Button>
                </div>
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
                <TabsList className="bg-muted/50 p-1">
                    <TabsTrigger value="overview">Resumen General</TabsTrigger>
                    <TabsTrigger value="details">Detalle de Transacciones</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="border-l-4 border-l-green-500 shadow-sm hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Ingresos netos (Mes)</CardTitle>
                                <DollarSign className="h-4 w-4 text-green-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(stats.monthlyIncome)}</div>
                                <p className={cn(
                                    "text-xs flex items-center mt-1",
                                    stats.incomeChange >= 0 ? "text-green-600" : "text-red-500"
                                )}>
                                    <TrendingUp className={cn("h-3 w-3 mr-1", stats.incomeChange < 0 && "rotate-180")} />
                                    {Math.abs(stats.incomeChange).toFixed(1)}% vs mes anterior
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-l-4 border-l-red-500 shadow-sm hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Compras y gastos netos</CardTitle>
                                <DollarSign className="h-4 w-4 text-red-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(stats.monthlyExpenses)}</div>
                                <p className={cn(
                                    "text-xs flex items-center mt-1",
                                    stats.expenseChange <= 0 ? "text-green-600" : "text-red-500"
                                )}>
                                    <TrendingDown className={cn("h-3 w-3 mr-1", stats.expenseChange > 0 && "rotate-180")} />
                                    {Math.abs(stats.expenseChange).toFixed(1)}% vs mes anterior
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Resultado P/L</CardTitle>
                                <DollarSign className="h-4 w-4 text-primary" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(stats.netProfit)}</div>
                                <p className="text-xs text-muted-foreground flex items-center mt-1">
                                    <TrendingUp className="h-3 w-3 mr-1" />
                                    {stats.monthlyIncome > 0 ? ((stats.netProfit / stats.monthlyIncome) * 100).toFixed(1) : 0}% de margen
                                </p>
                            </CardContent>
                        </Card>

                        <Card className="border-l-4 border-l-amber-500 shadow-sm hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Por Cobrar (Pendiente)</CardTitle>
                                <DollarSign className="h-4 w-4 text-amber-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatCurrency(stats.pendingReceivables)}</div>
                                <p className="text-xs text-amber-600 mt-1 font-medium">
                                    Activo circulante en calle
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                        <Card className="col-span-4 shadow-sm">
                            <CardHeader>
                                <CardTitle>Rendimiento Mensual (Últimos 6 meses)</CardTitle>
                                <CardDescription>Comparativa de ingresos vs gastos.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="h-[250px] w-full flex items-end gap-2 pb-6 pt-10 px-2 border-b border-l relative">
                                    {monthlyData.map((d, i) => {
                                        const maxVal = Math.max(...monthlyData.map(x => Math.max(x.income || 0, x.expenses || 0))) || 1;
                                        return (
                                            <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                                                <div className="flex gap-1 items-end h-full w-full justify-center">
                                                    {/* Bar Income */}
                                                    <div
                                                        className="w-4 bg-green-500 rounded-t-sm transition-all hover:brightness-110 relative"
                                                        style={{ height: d.income > 0 ? `${(d.income / maxVal) * 100}%` : '2px' }}
                                                    >
                                                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-[10px] px-1 py-0.5 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                                            {formatCurrency(d.income)}
                                                        </div>
                                                    </div>
                                                    {/* Bar Expenses */}
                                                    <div
                                                        className="w-4 bg-red-400 rounded-t-sm transition-all hover:brightness-110 relative"
                                                        style={{ height: d.expenses > 0 ? `${(d.expenses / maxVal) * 100}%` : '2px' }}
                                                    >
                                                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-popover text-popover-foreground text-[10px] px-1 py-0.5 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                                            {formatCurrency(d.expenses)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <span className="text-[10px] font-medium text-muted-foreground uppercase">{d.name}</span>
                                            </div>
                                        );
                                    })}
                                    {/* Leyenda */}
                                    <div className="absolute top-2 right-2 flex gap-4 text-xs">
                                        <div className="flex items-center gap-1"><div className="w-2 h-2 bg-green-500 rounded"></div> Ingresos</div>
                                        <div className="flex items-center gap-1"><div className="w-2 h-2 bg-red-400 rounded"></div> Gastos</div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="col-span-3 shadow-sm">
                            <CardHeader>
                                <CardTitle>Top Clientes (Mes)</CardTitle>
                                <CardDescription>Clientes con mayor facturación este mes.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-6">
                                    {topClients.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                                            <p className="text-sm italic">Sin datos este mes.</p>
                                        </div>
                                    ) : (
                                        topClients.map((client, i) => (
                                            <div key={i} className="flex items-center group transition-colors">
                                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs ring-2 ring-primary/5 group-hover:ring-primary/20 transition-all">
                                                    {i + 1}
                                                </div>
                                                <div className="ml-4 space-y-1">
                                                    <p className="text-sm font-semibold leading-none">{client.name}</p>
                                                    <p className="text-xs text-muted-foreground">{client.count} Trabajos registrados</p>
                                                </div>
                                                <div className="ml-auto font-bold text-slate-900">{formatCurrency(client.amount)}</div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                {topClients.length > 0 && (
                                    <Button variant="ghost" className="w-full mt-6 text-xs text-primary" asChild>
                                        <a href="/clientes">Ver todos los clientes</a>
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="details">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Historial Reciente de Transacciones</CardTitle>
                                <CardDescription>Listado detallado de las últimas 20 facturas y gastos.</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="relative overflow-x-auto border rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs uppercase bg-muted/50 border-b">
                                        <tr>
                                            <th className="px-4 py-3">Fecha</th>
                                            <th className="px-4 py-3">Tipo</th>
                                            <th className="px-4 py-3">Tercero</th>
                                            <th className="px-4 py-3 text-right">Monto</th>
                                            <th className="px-4 py-3">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {recentTransactions.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                                                    No hay transacciones registradas.
                                                </td>
                                            </tr>
                                        ) : (
                                            recentTransactions.map((inv) => (
                                                <tr key={inv.id} className="hover:bg-muted/50 transition-colors">
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        {format(new Date((inv.fecha_emision || inv.created_at).split('T')[0] + 'T12:00:00'), 'dd MMM yyyy', { locale: es })}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-1">
                                                            {inv.tipo === 'venta' ? (
                                                                <ArrowUpRight className="w-3 h-3 text-green-500" />
                                                            ) : (
                                                                <ArrowDownRight className="w-3 h-3 text-red-500" />
                                                            )}
                                                            <span className={inv.tipo === 'venta' ? 'text-green-600' : 'text-red-500 font-medium'}>
                                                                {inv.tipo === 'venta' ? 'Venta' : 'Compra'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 font-medium">
                                                        {inv.tercero_nombre || 'S/N'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-bold">
                                                        {formatCurrency(inv.monto)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={cn(
                                                            "px-2 py-0.5 rounded-full text-[10px] uppercase font-bold",
                                                            inv.estado === 'pagada' ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                                                        )}>
                                                            {inv.estado}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

// Helper para classes
function cn(...classes: any[]) {
    return classes.filter(Boolean).join(' ');
}
