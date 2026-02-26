import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import {
    Plus,
    Loader2,
    FileText,
    Trash2,
    Receipt,
    X,
    Upload,
    Paperclip,
    Printer
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface RendicionItem {
    id?: string;
    descripcion: string;
    monto: number;
}

export default function Rendiciones() {
    const [rendiciones, setRendiciones] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form state
    const [terceros, setTerceros] = useState<any[]>([]);
    const [selectedTercero, setSelectedTercero] = useState("");
    const [descripcion, setDescripcion] = useState("");
    const [items, setItems] = useState<RendicionItem[]>([{ descripcion: "", monto: 0 }]);
    const [files, setFiles] = useState<File[]>([]);

    // Quick-add employee state
    const [isAddEmployeeOpen, setIsAddEmployeeOpen] = useState(false);
    const [newEmployee, setNewEmployee] = useState({ nombre: "", rut: "", telefono: "", cargo: "" });
    const [isSavingEmployee, setIsSavingEmployee] = useState(false);

    useEffect(() => {
        fetchRendiciones();
        fetchTerceros();
    }, []);

    const fetchRendiciones = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('rendiciones')
                .select('*, terceros(razon_social)')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setRendiciones(data || []);
        } catch (error) {
            console.error("Error fetching rendiciones:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchTerceros = async () => {
        try {
            const { data, error } = await supabase
                .from('terceros')
                .select('id, razon_social, cargo')
                .eq('estado', 'activo')
                .eq('es_trabajador', true);
            if (error) throw error;
            setTerceros(data || []);
        } catch (error) {
            console.error("Error fetching terceros:", error);
        }
    };

    const handleAddEmployee = async () => {
        if (!newEmployee.nombre || !newEmployee.rut) {
            alert("Nombre y RUT son obligatorios.");
            return;
        }

        setIsSavingEmployee(true);
        try {
            const { data, error } = await supabase
                .from('terceros')
                .insert({
                    razon_social: newEmployee.nombre,
                    rut: newEmployee.rut,
                    telefono: newEmployee.telefono || null,
                    cargo: newEmployee.cargo || null,
                    tipo: 'proveedor',
                    es_trabajador: true,
                    estado: 'activo'
                })
                .select()
                .single();

            if (error) throw error;

            setIsAddEmployeeOpen(false);
            setNewEmployee({ nombre: "", rut: "", telefono: "", cargo: "" });
            await fetchTerceros();
            setSelectedTercero(data.id);
        } catch (error: any) {
            console.error("Error adding employee:", error);
            alert(`Error al agregar trabajador: ${error.message}`);
        } finally {
            setIsSavingEmployee(false);
        }
    };

    const handleAddItem = () => {
        setItems([...items, { descripcion: "", monto: 0 }]);
    };

    const handleRemoveItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    const handleUpdateItem = (index: number, field: keyof RendicionItem, value: string | number) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        setItems(newItems);
    };

    const totalMonto = items.reduce((sum, item) => sum + Number(item.monto || 0), 0);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const newFiles = Array.from(e.target.files);
            setFiles([...files, ...newFiles]);
        }
    };

    const removeFile = (index: number) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        if (!selectedTercero || items.some(i => !i.descripcion || i.monto <= 0)) {
            alert("Por favor completa todos los campos requeridos.");
            return;
        }

        setIsSubmitting(true);
        try {
            const uploadedUrls: string[] = [];

            // Upload all files
            for (const file of files) {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
                const filePath = `rendiciones/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('invoices')
                    .upload(filePath, file);

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage
                    .from('invoices')
                    .getPublicUrl(filePath);

                uploadedUrls.push(publicUrl);
            }

            // 1. Insert Rendición Header
            const { data: rendicion, error: rendicionError } = await supabase
                .from('rendiciones')
                .insert({
                    tercero_id: selectedTercero,
                    tercero_nombre: terceros.find(t => t.id === selectedTercero)?.razon_social,
                    descripcion: descripcion,
                    monto_total: totalMonto,
                    archivos_urls: uploadedUrls, // Updated column name
                    estado: 'pendiente'
                })
                .select()
                .single();

            if (rendicionError) throw rendicionError;

            // 2. Insert Details
            const detailsToInsert = items.map(item => ({
                rendicion_id: rendicion.id,
                descripcion: item.descripcion,
                monto: item.monto
            }));

            const { error: detailsError } = await supabase
                .from('rendicion_detalles')
                .insert(detailsToInsert);

            if (detailsError) throw detailsError;

            setIsCreateOpen(false);
            resetForm();
            fetchRendiciones();
        } catch (error: any) {
            console.error("Error saving rendicion:", error);
            alert(`Error al guardar la rendición: ${error.message || error.details || JSON.stringify(error)}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setSelectedTercero("");
        setDescripcion("");
        setItems([{ descripcion: "", monto: 0 }]);
        setFiles([]);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Rendiciones</h1>
                    <p className="text-muted-foreground">Gestiona reembolsos y gastos del equipo.</p>
                </div>
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="w-4 h-4" /> Nueva Rendición
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Ingresar Rendición</DialogTitle>
                            <DialogDescription>
                                Detalla los gastos realizados para solicitar el reembolso.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Persona que rinde</Label>
                                    <Select value={selectedTercero} onValueChange={setSelectedTercero}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccionar persona" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {terceros.map(t => (
                                                <SelectItem key={t.id} value={t.id}>
                                                    {t.razon_social} {t.cargo && `(${t.cargo})`}
                                                </SelectItem>
                                            ))}
                                            <div className="border-t mt-1 pt-1">
                                                <button
                                                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded-sm flex items-center gap-2 text-primary font-medium"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        setIsAddEmployeeOpen(true);
                                                    }}
                                                >
                                                    <Plus className="w-3 h-3" />
                                                    Agregar nuevo trabajador
                                                </button>
                                            </div>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Descripción General (Opcional)</Label>
                                    <Input
                                        placeholder="Ej: Gastos viaje a Santiago"
                                        value={descripcion}
                                        onChange={(e) => setDescripcion(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <Label className="text-sm font-bold uppercase text-muted-foreground">Detalle de Gastos</Label>
                                    <Button variant="outline" size="sm" onClick={handleAddItem} className="h-7 text-xs">
                                        + Agregar Item
                                    </Button>
                                </div>

                                {items.map((item, index) => (
                                    <div key={index} className="flex gap-3 items-end">
                                        <div className="flex-1 space-y-1">
                                            <Label className="text-[10px]">Descripción</Label>
                                            <Input
                                                className="h-9 px-3 text-xs"
                                                placeholder="Ej: Combustible, Colación..."
                                                value={item.descripcion}
                                                onChange={(e) => handleUpdateItem(index, 'descripcion', e.target.value)}
                                            />
                                        </div>
                                        <div className="w-32 space-y-1">
                                            <Label className="text-[10px]">Monto</Label>
                                            <Input
                                                type="number"
                                                className="h-9 px-3 text-xs"
                                                placeholder="0"
                                                value={item.monto}
                                                onChange={(e) => handleUpdateItem(index, 'monto', e.target.value)}
                                            />
                                        </div>
                                        {items.length > 1 && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 text-muted-foreground hover:text-red-500"
                                                onClick={() => handleRemoveItem(index)}
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </div>
                                ))}

                                <div className="flex justify-end pt-2 border-t mt-4">
                                    <div className="text-right">
                                        <p className="text-xs text-muted-foreground">Total a Rendir:</p>
                                        <p className="text-xl font-bold text-primary">{formatCurrency(totalMonto)}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Comprobantes (Imágenes o PDFs)</Label>
                                <div className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 hover:bg-muted/50 transition-colors cursor-pointer relative">
                                    <input
                                        type="file"
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        onChange={handleFileChange}
                                        accept="image/*,application/pdf"
                                        multiple // Allow multiple files
                                    />
                                    <Upload className="w-8 h-8 text-muted-foreground" />
                                    <p className="text-sm font-medium">
                                        Haga clic o arrastre archivos aquí
                                    </p>
                                    <p className="text-xs text-muted-foreground">Soporta múltiples archivos</p>
                                </div>

                                {/* File List */}
                                {files.length > 0 && (
                                    <div className="space-y-2 mt-2">
                                        {files.map((f, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-2 bg-muted rounded-md text-sm">
                                                <div className="flex items-center gap-2">
                                                    <Paperclip className="w-4 h-4 text-muted-foreground" />
                                                    <span className="truncate max-w-[200px]">{f.name}</span>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 hover:text-red-500"
                                                    onClick={() => removeFile(idx)}
                                                >
                                                    <X className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                            <Button onClick={handleSubmit} disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Guardar Rendición
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Dialog for Quick-Add Employee */}
            <Dialog open={isAddEmployeeOpen} onOpenChange={setIsAddEmployeeOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Agregar Nuevo Trabajador</DialogTitle>
                        <DialogDescription>
                            Ingresa los datos del trabajador autorizado para realizar rendiciones.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nombre Completo *</Label>
                            <Input
                                placeholder="Ej: Juan Pérez"
                                value={newEmployee.nombre}
                                onChange={(e) => setNewEmployee({ ...newEmployee, nombre: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>RUT *</Label>
                            <Input
                                placeholder="Ej: 12345678-9"
                                value={newEmployee.rut}
                                onChange={(e) => setNewEmployee({ ...newEmployee, rut: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Teléfono</Label>
                            <Input
                                placeholder="Ej: +56912345678"
                                value={newEmployee.telefono}
                                onChange={(e) => setNewEmployee({ ...newEmployee, telefono: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Cargo</Label>
                            <Input
                                placeholder="Ej: Técnico, Vendedor, etc."
                                value={newEmployee.cargo}
                                onChange={(e) => setNewEmployee({ ...newEmployee, cargo: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddEmployeeOpen(false)}>Cancelar</Button>
                        <Button onClick={handleAddEmployee} disabled={isSavingEmployee}>
                            {isSavingEmployee && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Agregar Trabajador
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium uppercase text-muted-foreground">Por Pagar</CardTitle>
                        <CardDescription className="text-2xl font-bold text-primary">
                            {formatCurrency(rendiciones.filter(r => r.estado === 'pendiente').reduce((sum, r) => sum + Number(r.monto_total), 0))}
                        </CardDescription>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium uppercase text-muted-foreground">Total Rendido</CardTitle>
                        <CardDescription className="text-2xl font-bold">
                            {formatCurrency(rendiciones.reduce((sum, r) => sum + Number(r.monto_total), 0))}
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Historial de Rendiciones</CardTitle>
                    <CardDescription>Movimientos registrados por el equipo.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {rendiciones.length === 0 ? (
                                <div className="text-center py-20 border-2 border-dashed rounded-lg">
                                    <Receipt className="w-12 h-12 mx-auto text-muted-foreground opacity-20 mb-4" />
                                    <p className="text-muted-foreground text-sm">No hay rendiciones registradas.</p>
                                </div>
                            ) : (
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/50 border-b">
                                            <tr>
                                                <th className="text-left p-3 font-semibold">Fecha</th>
                                                <th className="text-left p-3 font-semibold">Persona</th>
                                                <th className="text-left p-3 font-semibold">Descripción</th>
                                                <th className="text-right p-3 font-semibold">Monto</th>
                                                <th className="text-center p-3 font-semibold">Estado</th>
                                                <th className="text-right p-3 font-semibold">Archivos</th>
                                                <th className="p-3"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rendiciones.map((r) => (
                                                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                                                    <td className="p-3 text-muted-foreground">{format(new Date(r.fecha), 'dd/MM/yyyy')}</td>
                                                    <td className="p-3 font-medium">{r.terceros?.razon_social}</td>
                                                    <td className="p-3 text-muted-foreground max-w-xs truncate">{r.descripcion || '---'}</td>
                                                    <td className="p-3 text-right font-bold">{formatCurrency(r.monto_total)}</td>
                                                    <td className="p-3 text-center">
                                                        <Badge variant={r.estado === 'pagado' ? 'default' : 'secondary'} className="uppercase text-[9px]">
                                                            {r.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                                                        </Badge>
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div className="flex gap-1 justify-end flex-wrap max-w-[100px]">
                                                            {/* Support both old single file and new array */}
                                                            {r.archivos_urls?.map((url: string, idx: number) => (
                                                                <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                                                    <FileText className="w-4 h-4 inline" />
                                                                </a>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500">
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                                                            onClick={() => window.open(`/rendiciones/print/${r.id}`, '_blank')}
                                                            title="Imprimir / Guardar PDF"
                                                        >
                                                            <Printer className="w-4 h-4" />
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
