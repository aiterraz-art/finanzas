import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, FileUp, ArrowRight, Plus, Loader2, MapPin, Trash2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import InvoiceUpload from "@/components/InvoiceUpload";

import { useNavigate } from "react-router-dom";

export default function Clientes() {
    const navigate = useNavigate();
    const [clientes, setClientes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [isNewClienteOpen, setIsNewClienteOpen] = useState(false);
    const [isSavingCliente, setIsSavingCliente] = useState(false);
    const [newClienteData, setNewClienteData] = useState({
        rut: "",
        razon_social: "",
        email: "",
        telefono: "",
        direccion: "",
        plazo_pago_dias: 30
    });

    useEffect(() => {
        fetchClientes();
    }, []);

    const handleSendCollectionEmail = async (cliente: any) => {
        const saldo = getClienteSaldo(cliente.facturas);
        if (saldo <= 0) {
            alert("Este cliente no tiene saldo pendiente.");
            return;
        }

        const confirm = window.confirm(`¿Deseas enviar un recordatorio de cobranza por ${formatCurrency(saldo)} a ${cliente.razon_social}?`);
        if (!confirm) return;

        const n8nWebhookUrl = import.meta.env.VITE_N8N_COLLECTION_WEBHOOK_URL;
        if (!n8nWebhookUrl) {
            alert("No se ha configurado la URL del Webhook de cobranza (VITE_N8N_COLLECTION_WEBHOOK_URL).");
            return;
        }

        try {
            const response = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tercero_id: cliente.id,
                    nombre: cliente.razon_social,
                    email: cliente.email || 'no-email@example.com',
                    saldo_total: saldo,
                    antiguedad: getAgingData(cliente)?.diffDays || 0
                })
            });

            if (!response.ok) throw new Error("Error al contactar con n8n");

            alert("Recordatorio de cobranza enviado exitosamente a la cola de procesamiento.");
        } catch (error: any) {
            console.error("Error enviando cobranza:", error);
            alert(`No se pudo enviar la cobranza: ${error.message}`);
        }
    };

    const handleCreateClienteManual = async () => {
        if (!newClienteData.rut || !newClienteData.razon_social || !newClienteData.email || !newClienteData.telefono) {
            alert("RUT, Razón Social, Email y Teléfono son campos obligatorios.");
            return;
        }

        setIsSavingCliente(true);
        try {
            const cleanRut = newClienteData.rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
            const { data, error } = await supabase
                .from('terceros')
                .insert([{
                    ...newClienteData,
                    rut: cleanRut,
                    tipo: 'cliente',
                    estado: 'activo'
                }])
                .select()
                .single();

            if (error) throw error;

            setClientes(prev => [data, ...prev]);
            setIsNewClienteOpen(false);
            setNewClienteData({ rut: "", razon_social: "", email: "", telefono: "", direccion: "", plazo_pago_dias: 30 });
            alert("Cliente creado correctamente.");
        } catch (error: any) {
            console.error("Error al crear cliente:", error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsSavingCliente(false);
        }
    };

    const handleDeleteCliente = async (cliente: any) => {
        const hasDocs = (cliente.facturas || []).length > 0;
        const msg = hasDocs
            ? `ATENCIÓN: El cliente ${cliente.razon_social} tiene ${cliente.facturas.length} documentos asociados. Si lo borras, se ELIMINARÁN permanentemente todas sus facturas. ¿Deseas continuar?`
            : `¿Estás seguro de que deseas eliminar al cliente ${cliente.razon_social}?`;

        const confirm = window.confirm(msg);
        if (!confirm) return;

        try {
            // 1. Primero eliminamos las facturas asociadas para evitar error de foreign key
            if (hasDocs) {
                const { error: fError } = await supabase
                    .from('facturas')
                    .delete()
                    .eq('tercero_id', cliente.id); // Borramos por ID relacional para asegurar integridad

                if (fError) throw fError;
            }

            // 2. Ahora borramos al tercero
            const { error } = await supabase
                .from('terceros')
                .delete()
                .eq('id', cliente.id);

            if (error) throw error;

            setClientes(prev => prev.filter(c => c.id !== cliente.id));
            alert("Cliente y sus documentos eliminados correctamente.");
        } catch (error: any) {
            console.error("Error al eliminar cliente:", error);
            alert(`Error al eliminar: ${error.message}`);
        }
    };

    const fetchClientes = async () => {
        setLoading(true);
        try {
            // Intento 1: Con plazo_pago_dias (Ideal)
            const { data, error } = await supabase
                .from('terceros')
                .select(`
                    *,
                    facturas (
                        id, monto, estado, fecha_emision, fecha_vencimiento, tipo
                    )
                `)
                .eq('tipo', 'cliente')
                .order('razon_social', { ascending: true });

            if (error) {
                if (error.code === 'PGRST204' || error.message.includes('plazo_pago_dias')) {
                    console.warn("Columna plazo_pago_dias no encontrada, reintentando sin ella...");
                    // Intento 2: Sin plazo_pago_dias (Resiliencia)
                    const { data: data2, error: error2 } = await supabase
                        .from('terceros')
                        .select(`
                            id, rut, razon_social, email, telefono, direccion, estado, tipo,
                            facturas (
                                id, monto, estado, fecha_emision, fecha_vencimiento, tipo
                            )
                        `)
                        .eq('tipo', 'cliente')
                        .order('razon_social', { ascending: true });

                    if (error2) throw error2;
                    setClientes(data2 || []);
                } else {
                    throw error;
                }
            } else {
                setClientes(data || []);
            }
        } catch (error) {
            console.error("Error fetching clientes:", error);
        } finally {
            setLoading(false);
        }
    };

    // Cálculos para KPIs globales
    const calculateTotals = () => {
        let totalCobrar = 0;
        let totalVencido = 0;
        let totalMes = 0;

        const now = new Date();
        now.setHours(12, 0, 0, 0); // Estándar mediodía

        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        clientes.forEach(cliente => {
            (cliente.facturas || []).forEach((f: any) => {
                const fechaEmi = new Date(f.fecha_emision + 'T12:00:00');
                const monto = parseFloat(f.monto);

                if (f.estado === 'pendiente' || f.estado === 'morosa') {
                    totalCobrar += monto;

                    // Usar fecha_vencimiento si existe, sino emision + plazo (fallback 30)
                    const plazo = cliente.plazo_pago_dias ?? 30;
                    const fechaVenc = f.fecha_vencimiento
                        ? new Date(f.fecha_vencimiento + 'T12:00:00')
                        : new Date(fechaEmi.getTime() + (plazo * 24 * 60 * 60 * 1000));

                    if (fechaVenc < now) {
                        totalVencido += monto;
                    }
                }

                if (fechaEmi >= firstDayOfMonth) {
                    totalMes += monto;
                }
            });
        });

        return { totalCobrar, totalVencido, totalMes };
    };

    const getAgingData = (cliente: any) => {
        const pend = (cliente.facturas || []).filter((f: any) => f.estado === 'pendiente' || f.estado === 'morosa');
        if (pend.length === 0) return null;

        const now = new Date();
        now.setHours(12, 0, 0, 0);

        // Buscamos la factura más crítica (la más antigua o más vencida)
        let mostCriticalDate = new Date(8640000000000000); // Infinity

        pend.forEach((f: any) => {
            const emi = new Date(f.fecha_emision + 'T12:00:00');
            const plazo = cliente.plazo_pago_dias ?? 30;
            const venc = f.fecha_vencimiento
                ? new Date(f.fecha_vencimiento + 'T12:00:00')
                : new Date(emi.getTime() + (plazo * 24 * 60 * 60 * 1000));

            if (venc < mostCriticalDate) {
                mostCriticalDate = venc;
            }
        });

        const diffTime = mostCriticalDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
            return {
                label: `Vencida hace ${Math.abs(diffDays)} días`,
                variant: "bg-red-100 text-red-700",
                isOverdue: true,
                diffDays
            };
        } else {
            return {
                label: `Vence en ${diffDays} días`,
                variant: "bg-blue-100 text-blue-700",
                isOverdue: false,
                diffDays
            };
        }
    };

    const totals = calculateTotals();

    const getClienteSaldo = (facturas: any[]) => {
        return (facturas || [])
            .filter(f => f.estado === 'pendiente' || f.estado === 'morosa')
            .reduce((sum, f) => sum + parseFloat(f.monto), 0);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const filteredClientes = clientes.filter(c =>
        c.razon_social.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.rut.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="container mx-auto py-10 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Gestión de Clientes</h2>
                    <p className="text-muted-foreground">Administra las cuentas corrientes y documentos de tus clínicas.</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="flex-1 md:flex-none border-primary text-primary hover:bg-primary/5">
                                <FileUp className="mr-2 h-4 w-4" /> Cargar Factura/NC
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-[95vw] w-full max-h-[95vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Procesar Documento (OCR)</DialogTitle>
                            </DialogHeader>
                            <InvoiceUpload
                                targetType="cliente"
                                onSuccess={fetchClientes}
                            />
                        </DialogContent>
                    </Dialog>
                    <Dialog open={isNewClienteOpen} onOpenChange={setIsNewClienteOpen}>
                        <DialogTrigger asChild>
                            <Button className="flex-1 md:flex-none">
                                <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Registrar Nuevo Cliente</DialogTitle>
                                <p className="text-sm text-muted-foreground">Ingresa los datos básicos. El email y teléfono son requeridos para cobranza.</p>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="rut">RUT</Label>
                                    <Input
                                        id="rut"
                                        placeholder="12.345.678-9"
                                        value={newClienteData.rut}
                                        onChange={(e) => setNewClienteData({ ...newClienteData, rut: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="name">Razón Social / Nombre</Label>
                                    <Input
                                        id="name"
                                        placeholder="Clínica Dental..."
                                        value={newClienteData.razon_social}
                                        onChange={(e) => setNewClienteData({ ...newClienteData, razon_social: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="email" className="flex items-center gap-1">Email <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">REQ</Badge></Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="doctor@ejemplo.com"
                                        value={newClienteData.email}
                                        onChange={(e) => setNewClienteData({ ...newClienteData, email: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="phone" className="flex items-center gap-1">Teléfono <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">REQ</Badge></Label>
                                    <Input
                                        id="phone"
                                        placeholder="+569..."
                                        value={newClienteData.telefono}
                                        onChange={(e) => setNewClienteData({ ...newClienteData, telefono: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="address">Dirección</Label>
                                    <Input
                                        id="address"
                                        placeholder="Calle 123, Ciudad"
                                        value={newClienteData.direccion}
                                        onChange={(e) => setNewClienteData({ ...newClienteData, direccion: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="plazo" className="flex items-center gap-1">Plazo de Pago (Días)</Label>
                                    <Input
                                        id="plazo"
                                        type="number"
                                        placeholder="30"
                                        value={newClienteData.plazo_pago_dias}
                                        onChange={(e) => setNewClienteData({ ...newClienteData, plazo_pago_dias: parseInt(e.target.value) || 0 })}
                                    />
                                </div>
                            </div>
                            <Button
                                onClick={handleCreateClienteManual}
                                disabled={isSavingCliente}
                                className="w-full"
                            >
                                {isSavingCliente ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Guardar Cliente"}
                            </Button>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Saldo Total por Cobrar</CardTitle>
                        <CardDescription className="text-2xl font-bold text-primary">{formatCurrency(totals.totalCobrar)}</CardDescription>
                    </CardHeader>
                </Card>
                <Card className="bg-red-50 border-red-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Deuda Vencida (&gt;30 días)</CardTitle>
                        <CardDescription className="text-2xl font-bold text-red-600">{formatCurrency(totals.totalVencido)}</CardDescription>
                    </CardHeader>
                </Card>
                <Card className="bg-green-50 border-green-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Facturación del Mes</CardTitle>
                        <CardDescription className="text-2xl font-bold text-green-600">{formatCurrency(totals.totalMes)}</CardDescription>
                    </CardHeader>
                </Card>
            </div>

            <div className="flex items-center space-x-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nombre o RUT..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : filteredClientes.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed rounded-lg">
                    <p className="text-muted-foreground">No se encontraron clientes.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredClientes.map((cliente) => (
                        <Card key={cliente.id} className="hover:shadow-md transition-shadow group">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-lg font-bold truncate pr-4">
                                    {cliente.razon_social}
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    <Badge variant={cliente.estado === 'activo' ? 'default' : 'secondary'}>
                                        {cliente.estado === 'activo' ? 'Activo' : 'Inactivo'}
                                    </Badge>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            "h-8 w-8 text-muted-foreground",
                                            getClienteSaldo(cliente.facturas) > 0 ? "hover:text-primary hover:bg-primary/5" : "opacity-30 cursor-not-allowed"
                                        )}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (getClienteSaldo(cliente.facturas) > 0) handleSendCollectionEmail(cliente);
                                        }}
                                        title="Enviar Recordatorio de Cobranza"
                                    >
                                        <Mail className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteCliente(cliente);
                                        }}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <CardDescription className="mb-4 font-mono text-xs">{cliente.rut}</CardDescription>
                                <div className="space-y-3 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4 shrink-0" />
                                        <span className="truncate">{cliente.direccion || 'Sin dirección'}</span>
                                    </div>
                                    <div className="mt-4 p-3 bg-muted/50 rounded-md space-y-2">
                                        <div className="flex justify-between items-center text-xs">
                                            <span>Saldo Pendiente:</span>
                                            <span className={cn(
                                                "font-bold",
                                                getClienteSaldo(cliente.facturas) > 0 ? "text-red-600" : "text-green-600"
                                            )}>
                                                {formatCurrency(getClienteSaldo(cliente.facturas))}
                                            </span>
                                        </div>
                                        {getAgingData(cliente) && (
                                            <div className="flex justify-between items-center text-[10px]">
                                                <span>Estado Pago:</span>
                                                <span className={cn(
                                                    "font-medium px-1.5 py-0.5 rounded",
                                                    getAgingData(cliente)?.variant
                                                )}>
                                                    {getAgingData(cliente)?.label}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter>
                                <Button
                                    variant="outline"
                                    className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                                    onClick={() => navigate(`/clientes/${cliente.id}`)}
                                >
                                    Estado de Cuenta <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
