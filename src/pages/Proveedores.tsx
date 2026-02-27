import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ArrowRight, Plus, Loader2, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCompany } from "@/contexts/CompanyContext";

import { useNavigate } from "react-router-dom";

export default function Proveedores() {
    const { selectedEmpresaId } = useCompany();
    const navigate = useNavigate();
    const [proveedores, setProveedores] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [isNewProvOpen, setIsNewProvOpen] = useState(false);
    const [isSavingProv, setIsSavingProv] = useState(false);
    const [newProvData, setNewProvData] = useState({
        rut: "",
        razon_social: "",
        email: "",
        telefono: "",
        direccion: ""
    });

    useEffect(() => {
        if (selectedEmpresaId) fetchProveedores();
    }, [selectedEmpresaId]);

    const handleDeleteProveedor = async (prov: any) => {
        if (!selectedEmpresaId) return;
        const hasDocs = (prov.facturas || []).length > 0;
        const msg = hasDocs
            ? `ATENCIÓN: El proveedor ${prov.razon_social} tiene ${prov.facturas.length} facturas asociadas. Si lo borras, estas facturas quedarán sin vínculo. ¿Deseas continuar?`
            : `¿Estás seguro de que deseas eliminar al proveedor ${prov.razon_social}?`;

        const confirm = window.confirm(msg);
        if (!confirm) return;

        try {
            const { error } = await supabase
                .from('terceros')
                .delete()
                .eq('id', prov.id)
                .eq('empresa_id', selectedEmpresaId);

            if (error) throw error;

            setProveedores(prev => prev.filter(p => p.id !== prov.id));
            alert("Proveedor eliminado correctamente.");
        } catch (error: any) {
            console.error("Error al eliminar proveedor:", error);
            alert(`Error al eliminar: ${error.message}`);
        }
    };

    const handleCreateProvManual = async () => {
        if (!selectedEmpresaId) return;
        if (!newProvData.rut || !newProvData.razon_social || !newProvData.direccion || !newProvData.email || !newProvData.telefono) {
            alert("RUT, Razón Social, Dirección, Email y Teléfono son obligatorios para registrar un nuevo proveedor.");
            return;
        }

        setIsSavingProv(true);
        try {
            const cleanRut = newProvData.rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
            const { data, error } = await supabase
                .from('terceros')
                .insert([{
                    empresa_id: selectedEmpresaId,
                    ...newProvData,
                    rut: cleanRut,
                    tipo: 'proveedor',
                    estado: 'activo'
                }])
                .select()
                .single();

            if (error) throw error;

            setProveedores(prev => [data, ...prev]);
            setIsNewProvOpen(false);
            setNewProvData({ rut: "", razon_social: "", email: "", telefono: "", direccion: "" });
            alert("Proveedor creado correctamente.");
        } catch (error: any) {
            console.error("Error al crear proveedor:", error);
            alert(`Error: ${error.message}`);
        } finally {
            setIsSavingProv(false);
        }
    };

    const fetchProveedores = async () => {
        if (!selectedEmpresaId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('terceros')
                .select(`
                    *,
                    facturas (
                        id,
                        monto,
                        estado,
                        fecha_emision,
                        tipo
                    )
                `)
                .eq('empresa_id', selectedEmpresaId)
                .eq('tipo', 'proveedor')
                .order('razon_social', { ascending: true });

            if (error) throw error;
            setProveedores(data || []);
        } catch (error) {
            console.error("Error fetching proveedores:", error);
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

    const calculateTotals = () => {
        let totalDeuda = 0;
        let totalSemana = 0;

        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);

        proveedores.forEach(prov => {
            (prov.facturas || []).forEach((f: any) => {
                const monto = parseFloat(f.monto);
                if (f.estado === 'pendiente' || f.estado === 'morosa') {
                    totalDeuda += monto;
                    // Aproximación de pagos pendientes esta semana (facturas de hace > 20 días ya venciendo)
                    const fechaEmi = new Date(f.fecha_emision);
                    const diffDays = Math.ceil((now.getTime() - fechaEmi.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 25) {
                        totalSemana += monto;
                    }
                }
            });
        });

        return { totalDeuda, totalSemana };
    };

    const getAgingData = (facturas: any[]) => {
        const pendientes = (facturas || []).filter(f => f.estado === 'pendiente' || f.estado === 'morosa');
        if (pendientes.length === 0) return null;

        const now = new Date().getTime();
        let oldestDate = now;

        pendientes.forEach(f => {
            const fecha = new Date(f.fecha_emision).getTime();
            if (fecha < oldestDate) oldestDate = fecha;
        });

        return Math.floor((now - oldestDate) / (1000 * 60 * 60 * 24));
    };

    const getProveedorSaldo = (facturas: any[]) => {
        return (facturas || [])
            .filter(f => f.estado === 'pendiente' || f.estado === 'morosa')
            .reduce((sum, f) => sum + parseFloat(f.monto), 0);
    };

    const totals = calculateTotals();



    const filteredProveedores = proveedores.filter(p =>
        p.razon_social.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.rut.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="container mx-auto py-10 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Proveedores</h2>
                    <p className="text-muted-foreground">Administra tus compras y cuentas por pagar.</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <Dialog open={isNewProvOpen} onOpenChange={setIsNewProvOpen}>
                        <DialogTrigger asChild>
                            <Button className="flex-1 md:flex-none">
                                <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Registrar Nuevo Proveedor</DialogTitle>
                                <p className="text-sm text-muted-foreground">Ingresa los datos del proveedor. RUT, Nombre y Dirección son requeridos.</p>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="rut">RUT</Label>
                                    <Input
                                        id="rut"
                                        placeholder="12.345.678-9"
                                        value={newProvData.rut}
                                        onChange={(e) => setNewProvData({ ...newProvData, rut: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="name">Razón Social</Label>
                                    <Input
                                        id="name"
                                        placeholder="Proveedor SpA..."
                                        value={newProvData.razon_social}
                                        onChange={(e) => setNewProvData({ ...newProvData, razon_social: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="email" className="flex items-center gap-1">Email <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">REQ</Badge></Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="contacto@proveedor.com"
                                        value={newProvData.email}
                                        onChange={(e) => setNewProvData({ ...newProvData, email: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="phone" className="flex items-center gap-1">Teléfono <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">REQ</Badge></Label>
                                    <Input
                                        id="phone"
                                        placeholder="+56..."
                                        value={newProvData.telefono}
                                        onChange={(e) => setNewProvData({ ...newProvData, telefono: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="address" className="flex items-center gap-1">Dirección <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">REQ</Badge></Label>
                                    <Input
                                        id="address"
                                        placeholder="Calle 123..."
                                        value={newProvData.direccion}
                                        onChange={(e) => setNewProvData({ ...newProvData, direccion: e.target.value })}
                                    />
                                </div>
                            </div>
                            <Button
                                onClick={handleCreateProvManual}
                                disabled={isSavingProv}
                                className="w-full"
                            >
                                {isSavingProv ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Guardar Proveedor"}
                            </Button>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-slate-50 border-slate-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Deuda Total a Proveedores</CardTitle>
                        <CardDescription className="text-2xl font-bold text-slate-900">{formatCurrency(totals.totalDeuda)}</CardDescription>
                    </CardHeader>
                </Card>
                <Card className="bg-orange-50 border-orange-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Pagos Pendientes (Estimados Semana)</CardTitle>
                        <CardDescription className="text-2xl font-bold text-orange-600">{formatCurrency(totals.totalSemana)}</CardDescription>
                    </CardHeader>
                </Card>
            </div>

            <div className="flex items-center space-x-2">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar proveedor..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Listado de Proveedores</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Razón Social</TableHead>
                                    <TableHead>RUT</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Saldo Pendiente</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredProveedores.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                                            No se encontraron proveedores.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredProveedores.map((supplier) => (
                                        <TableRow key={supplier.id}>
                                            <TableCell className="font-medium">{supplier.razon_social}</TableCell>
                                            <TableCell className="font-mono text-xs">{supplier.rut}</TableCell>
                                            <TableCell>
                                                <Badge variant={supplier.estado === 'activo' ? 'default' : 'secondary'}>
                                                    {supplier.estado === 'activo' ? 'Activo' : 'Inactivo'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <span className={cn(
                                                    "font-bold",
                                                    getProveedorSaldo(supplier.facturas) > 0 ? "text-red-600" : "text-green-600"
                                                )}>
                                                    {formatCurrency(getProveedorSaldo(supplier.facturas))}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {getAgingData(supplier.facturas) !== null ? (
                                                    <span className={cn(
                                                        "font-medium px-2 py-1 rounded-full text-xs",
                                                        (getAgingData(supplier.facturas) || 0) > 30 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                                                    )}>
                                                        {getAgingData(supplier.facturas)} días
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">N/A</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => navigate(`/proveedores/${supplier.id}`)}
                                                >
                                                    Ver Cta. Cte. <ArrowRight className="ml-2 h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => handleDeleteProveedor(supplier)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
