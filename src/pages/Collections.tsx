import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { format, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";
import { HandCoins, MessageSquare, Mail, Search, Clock } from "lucide-react";

export default function Collections() {
    const [loading, setLoading] = useState(true);
    const [overdueInvoices, setOverdueInvoices] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        fetchOverdue();
    }, []);

    const fetchOverdue = async () => {
        setLoading(true);
        try {
            const now = new Date().toISOString();
            const { data } = await supabase
                .from('facturas')
                .select('*, terceros(telefono, email)')
                .eq('tipo', 'venta')
                .eq('estado', 'pendiente')
                .lt('fecha_vencimiento', now)
                .order('fecha_vencimiento', { ascending: true });

            setOverdueInvoices(data || []);
        } catch (error) {
            console.error("Error fetching overdue:", error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const sendWhatsApp = (invoice: any) => {
        const phone = invoice.terceros?.telefono || "";
        const message = `Hola ${invoice.tercero_nombre}, te saludamos de LAB3D. Te recordamos que la factura ${invoice.numero_documento || ""} por ${formatCurrency(invoice.monto)} venció el ${format(new Date(invoice.fecha_vencimiento + 'T12:00:00'), 'dd/MM/yyyy')}. ¿Podrías confirmarnos el estado del pago? Gracias.`;
        window.open(`https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`, '_blank');
    };

    const filtered = overdueInvoices.filter(inv =>
        inv.tercero_nombre?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.numero_documento?.includes(searchTerm)
    );

    const totalOverdue = filtered.reduce((sum, inv) => sum + Number(inv.monto), 0);

    return (
        <div className="container mx-auto py-6 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Gestión de Cobranzas</h2>
                    <p className="text-muted-foreground">Facturas de venta con fecha de vencimiento superada.</p>
                </div>
                <Card className="bg-red-50 border-red-200">
                    <CardContent className="py-4 flex items-center gap-4">
                        <div className="bg-red-100 p-2 rounded-full">
                            <HandCoins className="text-red-600 h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-xs text-red-700 font-medium uppercase">Deuda Total Vencida</p>
                            <p className="text-2xl font-bold text-red-900">{formatCurrency(totalOverdue)}</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row justify-between gap-4">
                        <div>
                            <CardTitle>Facturas en Mora</CardTitle>
                            <CardDescription>Clientes que requieren gestión de cobro inmediata.</CardDescription>
                        </div>
                        <div className="relative w-full md:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar cliente o documento..."
                                className="pl-10"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="relative overflow-x-auto border rounded-xl">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-xs uppercase border-b">
                                <tr>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4">Vencimiento</th>
                                    <th className="px-6 py-4">Días Mora</th>
                                    <th className="px-6 py-4 text-right">Monto</th>
                                    <th className="px-6 py-4 text-center">Acciones de Cobro</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {filtered.map(inv => {
                                    const delay = differenceInDays(new Date(), new Date(inv.fecha_vencimiento + 'T12:00:00'));
                                    return (
                                        <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                                            <td className="px-6 py-4 font-medium">{inv.tercero_nombre}</td>
                                            <td className="px-6 py-4">{format(new Date(inv.fecha_vencimiento), 'dd MMM yyyy', { locale: es })}</td>
                                            <td className="px-6 py-4">
                                                <span className={`flex items-center gap-1 font-bold ${delay > 30 ? 'text-red-600' : 'text-amber-600'}`}>
                                                    <Clock className="w-4 h-4" />
                                                    {delay} días
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-right font-bold">{formatCurrency(inv.monto)}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex justify-center gap-2">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-2 text-green-600 hover:text-green-700 hover:bg-green-50"
                                                        onClick={() => sendWhatsApp(inv)}
                                                    >
                                                        <MessageSquare className="w-4 h-4" /> WhatsApp
                                                    </Button>
                                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                        <Mail className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-20 text-center text-muted-foreground italic">
                                            {loading ? <Clock className="animate-spin mx-auto" /> : "Felicidades, no hay facturas vencidas."}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
