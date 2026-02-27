import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    ArrowLeft,
    CreditCard,
    MapPin,
    Plus,
    CheckCircle2,
    Clock,
    Trash2,
    Edit3,
    Loader2
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";

export default function TerceroDetalle() {
    const { selectedEmpresaId } = useCompany();
    const { id } = useParams();
    const navigate = useNavigate();
    const [tercero, setTercero] = useState<any>(null);
    const [documentos, setDocumentos] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [columnMissing, setColumnMissing] = useState(false);
    const [editData, setEditData] = useState({
        razon_social: "",
        rut: "",
        email: "",
        telefono: "",
        direccion: "",
        plazo_pago_dias: 30
    });

    useEffect(() => {
        if (id && selectedEmpresaId) {
            fetchData();
        }
    }, [id, selectedEmpresaId]);

    useEffect(() => {
        if (tercero) {
            setEditData({
                razon_social: tercero.razon_social || "",
                rut: tercero.rut || "",
                email: tercero.email || "",
                telefono: tercero.telefono || "",
                direccion: tercero.direccion || "",
                plazo_pago_dias: tercero.plazo_pago_dias || 30
            });
        }
    }, [tercero]);

    const handleDeleteTercero = async () => {
        if (!selectedEmpresaId) return;
        const hasDocs = documentos.length > 0;
        const msg = hasDocs
            ? `ATENCIÓN: El cliente ${tercero.razon_social} tiene ${documentos.length} documentos asociados. Si lo borras, se ELIMINARÁN permanentemente todas sus facturas. ¿Deseas continuar?`
            : `¿Estás seguro de que deseas eliminar al cliente ${tercero.razon_social}?`;

        const confirm = window.confirm(msg);
        if (!confirm) return;

        try {
            setIsSaving(true);
            // 1. Primero eliminamos las facturas asociadas
            if (hasDocs) {
                const { error: fError } = await supabase
                    .from('facturas')
                    .delete()
                    .eq('rut', tercero.rut)
                    .eq('empresa_id', selectedEmpresaId);

                if (fError) throw fError;
            }

            // 2. Ahora borramos al tercero
            const { error } = await supabase
                .from('terceros')
                .delete()
                .eq('id', id)
                .eq('empresa_id', selectedEmpresaId);

            if (error) throw error;

            alert("Cliente y sus documentos eliminados correctamente.");
            navigate('/clientes');
        } catch (error: any) {
            console.error("Error al eliminar cliente:", error);
            alert(`Error al eliminar: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdateTercero = async () => {
        if (!selectedEmpresaId) return;
        setIsSaving(true);
        try {
            const payload: any = {
                razon_social: editData.razon_social,
                email: editData.email,
                telefono: editData.telefono,
                direccion: editData.direccion,
            };

            // Solo incluimos plazo_pago_dias si no sabemos que falta la columna
            if (!columnMissing) {
                payload.plazo_pago_dias = editData.plazo_pago_dias;
            }

            const { error } = await supabase
                .from('terceros')
                .update(payload)
                .eq('id', id)
                .eq('empresa_id', selectedEmpresaId);

            if (error) {
                if (error.message.includes("plazo_pago_dias")) {
                    setColumnMissing(true);
                    alert("Aviso: El campo 'Días de Crédito' no se pudo guardar porque la columna no existe en la base de datos. Se guardaron los demás cambios.");
                    // Reintentamos sin esa columna
                    delete payload.plazo_pago_dias;
                    await supabase.from('terceros').update(payload).eq('id', id).eq('empresa_id', selectedEmpresaId);
                } else {
                    throw error;
                }
            }

            setTercero({ ...tercero, ...editData });
            setIsEditOpen(false);
            if (!error) alert("Ficha actualizada correctamente.");
        } catch (error: any) {
            console.error("Error updating entity:", error);
            alert(`Error al actualizar: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const fetchData = async () => {
        if (!selectedEmpresaId) return;
        setLoading(true);
        try {
            // 1. Obtener info del tercero
            const { data: entity, error: entityError } = await supabase
                .from('terceros')
                .select('*')
                .eq('id', id)
                .eq('empresa_id', selectedEmpresaId)
                .single();

            if (entityError) throw entityError;
            setTercero(entity);

            // 2. Obtener sus documentos (por ahora simulado o simple query)
            // Nota: En el futuro esto unirá con pagos
            const { data: docs, error: docsError } = await supabase
                .from('facturas')
                .select('*')
                .eq('rut', entity.rut) // O por tercero_id si ya está migrado
                .eq('empresa_id', selectedEmpresaId)
                .order('fecha_emision', { ascending: false });

            if (docsError) throw docsError;
            setDocumentos(docs || []);

        } catch (error) {
            console.error("Error fetching detail:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteFactura = async (id: string, numero: string) => {
        if (!selectedEmpresaId) return;
        const confirm = window.confirm(`¿Estás seguro de que deseas eliminar la factura folio ${numero}? Esta acción no se puede deshacer.`);
        if (!confirm) return;

        try {
            const { error } = await supabase
                .from('facturas')
                .delete()
                .eq('id', id)
                .eq('empresa_id', selectedEmpresaId);

            if (error) throw error;

            // Actualizar estado local
            setDocumentos(prev => prev.filter(d => d.id !== id));
            alert("Factura eliminada correctamente.");
        } catch (error) {
            console.error("Error al eliminar factura:", error);
            alert("Error al eliminar la factura.");
        }
    };

    if (loading) return <div className="p-10 text-center">Cargando detalles...</div>;
    if (!tercero) return <div className="p-10 text-center">Entidad no encontrada.</div>;

    const saldoTotal = documentos.reduce((acc, doc) => acc + (doc.tipo === 'nota_credito' ? -doc.monto : doc.monto), 0);

    return (
        <div className="container mx-auto py-8 space-y-6">
            <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver al listado
            </Button>

            {/* Header del Tercero */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <h2 className="text-3xl font-bold">{tercero.razon_social}</h2>
                        <Badge variant={tercero.tipo === 'cliente' ? 'default' : 'secondary'}>
                            {tercero.tipo.toUpperCase()}
                        </Badge>
                    </div>
                    <p className="text-muted-foreground font-mono">{tercero.rut}</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                        <div className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" /> {tercero.direccion || 'Sin dirección'}
                        </div>
                        <div className="flex items-center gap-1 ml-4">
                            <Clock className="h-4 w-4" /> Plazo: {tercero.plazo_pago_dias} días
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                    <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="gap-2">
                                <Edit3 className="h-4 w-4" /> Editar Ficha
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Editar Ficha de {tercero.tipo === 'cliente' ? 'Cliente' : 'Proveedor'}</DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-name">Razón Social</Label>
                                    <Input
                                        id="edit-name"
                                        value={editData.razon_social}
                                        onChange={(e) => setEditData({ ...editData, razon_social: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-rut">RUT (No editable)</Label>
                                    <Input
                                        id="edit-rut"
                                        value={editData.rut}
                                        disabled
                                        className="bg-muted font-mono"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-email">Email</Label>
                                    <Input
                                        id="edit-email"
                                        type="email"
                                        value={editData.email}
                                        onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-phone">Teléfono</Label>
                                    <Input
                                        id="edit-phone"
                                        value={editData.telefono}
                                        onChange={(e) => setEditData({ ...editData, telefono: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-address">Dirección</Label>
                                    <Input
                                        id="edit-address"
                                        value={editData.direccion}
                                        onChange={(e) => setEditData({ ...editData, direccion: e.target.value })}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="edit-plazo" className={columnMissing ? "text-muted-foreground" : ""}>
                                        Días de Crédito / Plazo de Pago {columnMissing && "(Columna faltante en DB)"}
                                    </Label>
                                    <Input
                                        id="edit-plazo"
                                        type="number"
                                        value={editData.plazo_pago_dias}
                                        onChange={(e) => setEditData({ ...editData, plazo_pago_dias: parseInt(e.target.value) || 0 })}
                                        disabled={columnMissing}
                                        className={columnMissing ? "opacity-50" : ""}
                                    />
                                    {columnMissing && (
                                        <p className="text-[10px] text-orange-600">
                                            Ejecuta el script SQL en Supabase para habilitar este campo.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <Button onClick={handleUpdateTercero} disabled={isSaving} className="w-full">
                                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Guardar Cambios"}
                            </Button>
                        </DialogContent>
                    </Dialog>

                    <Button
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 gap-2 border border-red-100"
                        onClick={handleDeleteTercero}
                        disabled={isSaving}
                    >
                        <Trash2 className="h-4 w-4" /> Eliminar
                    </Button>

                    <Card className="w-full md:w-auto min-w-[200px] bg-primary/5 border-primary/20">
                        <CardHeader className="p-4 pb-0 text-center">
                            <CardDescription className="text-xs uppercase font-semibold">Saldo Pendiente</CardDescription>
                            <CardTitle className={`text-2xl font-bold ${saldoTotal > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ${saldoTotal.toLocaleString('es-CL')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-2 flex justify-center gap-2">
                            <Button size="sm" className="w-full" onClick={() => navigate('/facturas/nueva')}>
                                <Plus className="mr-1 h-3 w-3" /> Ingresar Factura Manual
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Tabs de Información */}
            <Tabs defaultValue="documentos" className="w-full">
                <TabsList className="grid w-full grid-cols-2 md:w-[400px]">
                    <TabsTrigger value="documentos">Documentos</TabsTrigger>
                    <TabsTrigger value="pagos">Pagos Recibidos</TabsTrigger>
                </TabsList>

                <TabsContent value="documentos" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Facturas y Notas de Crédito</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Número</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Monto</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {documentos.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                                                No hay documentos registrados.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        documentos.map((doc) => (
                                            <TableRow key={doc.id}>
                                                <TableCell>{new Date(doc.fecha_emision + 'T12:00:00').toLocaleDateString('es-CL')}</TableCell>
                                                <TableCell className="font-mono">{doc.numero_documento || '---'}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">
                                                        {doc.tipo === 'nota_credito' ? 'Nota de Crédito' : 'Factura'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className={doc.tipo === 'nota_credito' ? 'text-green-600' : ''}>
                                                    {doc.tipo === 'nota_credito' ? '-' : ''}${doc.monto.toLocaleString('es-CL')}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        {doc.estado === 'pagada' ? (
                                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                                        ) : (
                                                            <Clock className="h-4 w-4 text-orange-500" />
                                                        )}
                                                        <span className="text-xs capitalize">{doc.estado}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right flex justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className={!doc.archivo_url ? "opacity-30 cursor-not-allowed" : ""}
                                                        onClick={() => doc.archivo_url && window.open(doc.archivo_url, '_blank')}
                                                        title={doc.archivo_url ? "Ver PDF escaneado" : "No hay PDF asociado"}
                                                    >
                                                        Ver PDF
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                        onClick={() => handleDeleteFactura(doc.id, doc.numero_documento)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="pagos" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Conciliaciones Bancarias</CardTitle>
                            <CardDescription>Pagos vinculados directamente desde el banco.</CardDescription>
                        </CardHeader>
                        <CardContent className="h-40 flex flex-col items-center justify-center text-muted-foreground">
                            <CreditCard className="h-10 w-10 mb-2 opacity-20" />
                            <p>Próximamente: Historial de transferencias conciliadas.</p>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
