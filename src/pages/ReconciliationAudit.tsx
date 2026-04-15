import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { ShieldCheck, AlertCircle, FileWarning, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useCompany } from "@/contexts/CompanyContext";

export default function ReconciliationAudit() {
    const { selectedEmpresaId } = useCompany();
    const [loading, setLoading] = useState(true);
    const [unmatchedMovements, setUnmatchedMovements] = useState<any[]>([]);
    const [unpaidInvoices, setUnpaidInvoices] = useState<any[]>([]);
    const [stats, setStats] = useState({ healthScore: 100, pendingAmount: 0 });

    useEffect(() => {
        if (selectedEmpresaId) fetchAudit();
    }, [selectedEmpresaId]);

    const fetchAudit = async () => {
        if (!selectedEmpresaId) return;
        setLoading(true);
        try {
            // 1. Movimientos de banco NO conciliados
            const { data: movements } = await supabase
                .from('movimientos_banco')
                .select('*')
                .eq('empresa_id', selectedEmpresaId)
                .eq('estado', 'no_conciliado')
                .order('fecha_movimiento', { ascending: false });
            setUnmatchedMovements(movements || []);

            // 2. Facturas (Venta) pagadas pero sin relación en facturas_pagos
            // Detectamos inconsistencias de integridad localmente
            const { data: paidInv } = await supabase.from('facturas').select('id, monto, tercero_nombre').eq('empresa_id', selectedEmpresaId).eq('estado', 'pagada');
            const { data: rels } = await supabase
                .from('facturas_pagos')
                .select('factura_id')
                .eq('empresa_id', selectedEmpresaId)
                .eq('estado', 'aplicado');
            const relSet = new Set(rels?.map(r => r.factura_id));
            const orphanPaid = paidInv?.filter(inv => !relSet.has(inv.id)) || [];
            setUnpaidInvoices(orphanPaid);

            // 3. Health Score Logic
            const totalPending = (movements || []).reduce((sum, m) => sum + Math.abs(Number(m.monto)), 0);
            const score = Math.max(0, 100 - ((movements?.length || 0) * 5));
            setStats({ healthScore: score, pendingAmount: totalPending });

        } catch (error) {
            console.error("Error in audit:", error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(amount);
    };

    if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="container mx-auto py-6 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Auditoría de Conciliación</h2>
                    <p className="text-muted-foreground">Integridad de datos bancarios vs. facturación.</p>
                </div>
                <div className="flex items-center gap-4 bg-card border rounded-lg px-6 py-2 shadow-sm">
                    <div className="text-right">
                        <p className="text-xs text-muted-foreground uppercase font-semibold">Salud Contable</p>
                        <p className={`text-2xl font-black ${stats.healthScore > 80 ? 'text-green-600' : 'text-amber-600'}`}>{stats.healthScore}%</p>
                    </div>
                    <ShieldCheck className={`h-10 w-10 ${stats.healthScore > 80 ? 'text-green-500' : 'text-amber-500'}`} />
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Unmatched Bank Movements */}
                <Card className="border-l-4 border-l-amber-500">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <FileWarning className="text-amber-600 h-5 w-5" />
                            <CardTitle>Movimientos Bancarios sin Respaldar</CardTitle>
                        </div>
                        <CardDescription>Dinero que entró o salió pero no tiene una factura asociada.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="text-2xl font-bold text-amber-900">{formatCurrency(stats.pendingAmount)} <span className="text-sm font-normal text-muted-foreground">por justificar</span></div>
                        <div className="max-h-[400px] overflow-y-auto space-y-2 pr-2">
                            {unmatchedMovements.map(m => (
                                <div key={m.id} className="flex justify-between items-center p-3 bg-muted/40 rounded-lg text-sm border hover:border-amber-300 transition-colors">
                                    <div>
                                        <p className="font-semibold">{m.descripcion}</p>
                                        <p className="text-xs text-muted-foreground">{format(new Date(m.fecha_movimiento), 'dd MMM yyyy', { locale: es })}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className={`font-bold ${Number(m.monto) > 0 ? 'text-green-600' : 'text-red-500'}`}>{formatCurrency(m.monto)}</p>
                                        <a href="/reconciliation" className="text-[10px] text-primary hover:underline flex items-center justify-end gap-1">Conciliar <ArrowRight className="w-2 h-2" /></a>
                                    </div>
                                </div>
                            ))}
                            {unmatchedMovements.length === 0 && <p className="text-center py-10 text-muted-foreground italic">Nada pendiente. ¡Buen trabajo!</p>}
                        </div>
                    </CardContent>
                </Card>

                {/* Inconsistency Alerts */}
                <Card className="border-l-4 border-l-red-500">
                    <CardHeader>
                        <div className="flex items-center gap-2">
                            <AlertCircle className="text-red-600 h-5 w-5" />
                            <CardTitle>Inconsistencias Detectadas</CardTitle>
                        </div>
                        <CardDescription>Documentos marcados como "Pagado" pero sin registro de pago bancario.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {unpaidInvoices.map(inv => (
                                <div key={inv.id} className="flex items-center justify-between p-4 border border-red-100 bg-red-50/30 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-red-100 p-2 rounded-full"><FileWarning className="h-4 w-4 text-red-600" /></div>
                                        <div>
                                            <p className="text-sm font-bold text-red-900">{inv.tercero_nombre}</p>
                                            <p className="text-[10px] text-red-700 uppercase">Factura Huérfana</p>
                                        </div>
                                    </div>
                                    <p className="font-black text-red-900">{formatCurrency(inv.monto)}</p>
                                </div>
                            ))}
                            {unpaidInvoices.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                                    <CheckCircle2 className="h-12 w-12 mb-4 text-green-500 opacity-50" />
                                    <p>No se encontraron huérfanos.</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
