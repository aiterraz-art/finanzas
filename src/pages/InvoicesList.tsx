import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { canEditTreasury } from "@/lib/treasury";
import { extractReferencedDocumentNumber } from "@/lib/invoice-import";

const statusButtonOptions = [
    { value: "all", label: "Ver todos" },
    { value: "paid", label: "Pagadas" },
    { value: "unpaid", label: "No pagadas" },
    { value: "abonada", label: "Abonadas" },
    { value: "pendiente", label: "Pendientes" },
    { value: "morosa", label: "Morosas" },
    { value: "archivada", label: "Archivadas" },
] as const;

type InvoiceEditForm = {
    tipo: "venta" | "compra" | "nota_credito";
    tipo_documento: string;
    nombre_documento: string;
    numero_documento: string;
    rut: string;
    tercero_nombre: string;
    vendedor_asignado: string;
    fecha_emision: string;
    fecha_vencimiento: string;
    monto: string;
    descripcion: string;
};

const invoiceDateValue = (value: string | null | undefined) => value?.split("T")[0] || "";
const normalizeInvoiceNumber = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, "");

export default function InvoicesList() {
    const { selectedEmpresaId, selectedRole } = useCompany();
    const { user } = useAuth();
    const canEdit = canEditTreasury(selectedRole);
    const [invoices, setInvoices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [invoiceNumberFilter, setInvoiceNumberFilter] = useState("");
    const [customerFilter, setCustomerFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [vendorFilter, setVendorFilter] = useState("all");
    const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
    const [savingInvoice, setSavingInvoice] = useState(false);
    const [editForm, setEditForm] = useState<InvoiceEditForm | null>(null);

    useEffect(() => {
        if (selectedEmpresaId) fetchInvoices();
    }, [selectedEmpresaId]);

    async function fetchInvoices() {
        if (!selectedEmpresaId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('facturas')
                .select('*')
                .eq('empresa_id', selectedEmpresaId)
                .order('fecha_emision', { ascending: false });

            if (error) throw error;
            setInvoices(data || []);
        } catch (error) {
            console.error('Error fetching invoices:', error);
        } finally {
            setLoading(false);
        }
    }

    const handleDeleteFactura = async (id: string, numero: string) => {
        if (!selectedEmpresaId || !canEdit) return;
        const confirm = window.confirm(`¿Archivar la factura folio ${numero}? El documento seguirá existiendo para revisión histórica.`);
        if (!confirm) return;

        try {
            const { error } = await supabase
                .from('facturas')
                .update({
                    estado: 'archivada',
                    archived_at: new Date().toISOString(),
                    archived_by: user?.id ?? null,
                    archive_reason: 'Factura archivada desde listado de facturas',
                })
                .eq('id', id)
                .eq('empresa_id', selectedEmpresaId);

            if (error) throw error;

            setInvoices(prev => prev.map((inv) => (
                inv.id === id
                    ? { ...inv, estado: 'archivada', archived_at: new Date().toISOString() }
                    : inv
            )));
            alert("Factura archivada correctamente.");
        } catch (error) {
            console.error("Error al archivar factura:", error);
            alert("Error al archivar la factura.");
        }
    };

    const openEditDialog = (invoice: any) => {
        setEditingInvoice(invoice);
        setEditForm({
            tipo: invoice.tipo === "compra" || invoice.tipo === "nota_credito" ? invoice.tipo : "venta",
            tipo_documento: invoice.tipo_documento || "",
            nombre_documento: invoice.nombre_documento || "",
            numero_documento: invoice.numero_documento || "",
            rut: invoice.rut || "",
            tercero_nombre: invoice.tercero_nombre || "",
            vendedor_asignado: invoice.vendedor_asignado || "",
            fecha_emision: invoiceDateValue(invoice.fecha_emision || invoice.created_at),
            fecha_vencimiento: invoiceDateValue(invoice.fecha_vencimiento),
            monto: String(invoice.monto ?? ""),
            descripcion: invoice.descripcion || "",
        });
    };

    const handleSaveInvoice = async () => {
        if (!selectedEmpresaId || !editingInvoice || !editForm || !canEdit) return;

        const amount = Number(editForm.monto);
        if (!editForm.tercero_nombre.trim() || !editForm.fecha_emision || !Number.isFinite(amount) || amount <= 0) {
            alert("Completa la razón social, fecha de emisión y un monto mayor a cero.");
            return;
        }

        setSavingInvoice(true);
        try {
            const { data, error } = await supabase
                .from("facturas")
                .update({
                    tipo: editForm.tipo,
                    tipo_documento: editForm.tipo_documento.trim() || null,
                    nombre_documento: editForm.nombre_documento.trim() || null,
                    numero_documento: editForm.numero_documento.trim() || null,
                    rut: editForm.rut.trim() || null,
                    tercero_nombre: editForm.tercero_nombre.trim(),
                    vendedor_asignado: editForm.vendedor_asignado.trim() || null,
                    fecha_emision: editForm.fecha_emision,
                    fecha_vencimiento: editForm.fecha_vencimiento || null,
                    monto: amount,
                    descripcion: editForm.descripcion.trim() || null,
                })
                .eq("id", editingInvoice.id)
                .eq("empresa_id", selectedEmpresaId)
                .select()
                .single();

            if (error) throw error;

            setInvoices((current) => current.map((invoice) => invoice.id === data.id ? data : invoice));
            setEditingInvoice(null);
            setEditForm(null);
        } catch (error: any) {
            console.error("Error al actualizar factura:", error);
            alert(`No se pudo actualizar la factura: ${error.message}`);
        } finally {
            setSavingInvoice(false);
        }
    };

    const vendorOptions = useMemo(() => {
        const vendors = invoices
            .map((invoice) => invoice.vendedor_asignado?.trim())
            .filter((vendor): vendor is string => Boolean(vendor));
        return Array.from(new Set(vendors)).sort((a, b) => a.localeCompare(b, "es"));
    }, [invoices]);

    const creditNotesByInvoiceId = useMemo(() => {
        const amounts = new Map<string, number>();
        for (const invoice of invoices) {
            if (invoice.tipo !== "nota_credito" || invoice.estado === "archivada") continue;
            const referencedInvoiceId =
                invoice.factura_referencia_id ||
                invoices.find(
                    (candidate) =>
                        candidate.tipo === "venta" &&
                        normalizeInvoiceNumber(candidate.numero_documento) === normalizeInvoiceNumber(extractReferencedDocumentNumber(invoice.descripcion)) &&
                        (!invoice.tercero_nombre || candidate.tercero_nombre === invoice.tercero_nombre)
                )?.id;
            if (!referencedInvoiceId) continue;
            amounts.set(
                referencedInvoiceId,
                (amounts.get(referencedInvoiceId) || 0) + Number(invoice.monto || 0)
            );
        }
        return amounts;
    }, [invoices]);

    const getEffectiveInvoiceAmount = (invoice: any) =>
        invoice.tipo === "venta"
            ? Math.max(Number(invoice.monto || 0) - (creditNotesByInvoiceId.get(invoice.id) || 0), 0)
            : Number(invoice.monto || 0);

    const filteredInvoices = useMemo(() => {
        const normalizedSearch = searchTerm.toLowerCase().trim();
        const normalizedInvoiceNumber = invoiceNumberFilter.toLowerCase().trim();
        const normalizedCustomer = customerFilter.toLowerCase().trim();

        return invoices.filter((inv) => {
            const invoiceNumber = String(inv.numero_documento || "").toLowerCase();
            const customerName = String(inv.tercero_nombre || "").toLowerCase();
            const seller = String(inv.vendedor_asignado || "");
            const status = String(inv.estado || "").toLowerCase();

            const matchesSearch =
                !normalizedSearch ||
                customerName.includes(normalizedSearch) ||
                String(inv.descripcion || "").toLowerCase().includes(normalizedSearch) ||
                invoiceNumber.includes(normalizedSearch) ||
                String(inv.rut || "").toLowerCase().includes(normalizedSearch) ||
                seller.toLowerCase().includes(normalizedSearch) ||
                String(inv.tipo_documento || "").toLowerCase().includes(normalizedSearch) ||
                String(inv.nombre_documento || "").toLowerCase().includes(normalizedSearch);

            const matchesInvoiceNumber = !normalizedInvoiceNumber || invoiceNumber.includes(normalizedInvoiceNumber);
            const matchesCustomer = !normalizedCustomer || customerName.includes(normalizedCustomer);
            const matchesVendor = vendorFilter === "all" || seller === vendorFilter;
            const matchesStatus =
                statusFilter === "all" ||
                (statusFilter === "paid" && status === "pagada") ||
                (statusFilter === "unpaid" && status !== "pagada" && status !== "archivada") ||
                status === statusFilter;

            return matchesSearch && matchesInvoiceNumber && matchesCustomer && matchesVendor && matchesStatus;
        });
    }, [customerFilter, invoiceNumberFilter, invoices, searchTerm, statusFilter, vendorFilter]);

    return (
        <div className="container mx-auto py-10 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Facturas</h2>
                    <p className="text-muted-foreground">Revisa facturas con tipo de documento, folio, RUT, razón social, fecha, monto y vendedor asignado.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Link to="/facturas/nueva">
                        <Button disabled={!canEdit}>
                            <Plus className="mr-2 h-4 w-4" /> Nueva Factura
                        </Button>
                    </Link>
                    <Link to="/facturas/importar">
                        <Button variant="outline" disabled={!canEdit}>
                            <Plus className="mr-2 h-4 w-4" /> Importar Base
                        </Button>
                    </Link>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                        <CardTitle>Historial de Facturación</CardTitle>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                            <div className="relative min-w-[220px]">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar general..."
                                    className="pl-8"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Input
                                placeholder="Filtrar por número"
                                value={invoiceNumberFilter}
                                onChange={(e) => setInvoiceNumberFilter(e.target.value)}
                            />
                            <Input
                                placeholder="Filtrar por razón social"
                                value={customerFilter}
                                onChange={(e) => setCustomerFilter(e.target.value)}
                            />
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="min-w-[180px]">
                                    <SelectValue placeholder="Estado" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Ver todos</SelectItem>
                                    <SelectItem value="paid">Pagadas</SelectItem>
                                    <SelectItem value="unpaid">No pagadas</SelectItem>
                                    <SelectItem value="abonada">Abonadas</SelectItem>
                                    <SelectItem value="pendiente">Pendientes</SelectItem>
                                    <SelectItem value="morosa">Morosas</SelectItem>
                                    <SelectItem value="archivada">Archivadas</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={vendorFilter} onValueChange={setVendorFilter}>
                                <SelectTrigger className="min-w-[180px]">
                                    <SelectValue placeholder="Vendedor" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos los vendedores</SelectItem>
                                    {vendorOptions.map((vendor) => (
                                        <SelectItem key={vendor} value={vendor}>
                                            {vendor}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                        {statusButtonOptions.map((option) => (
                            <Button
                                key={option.value}
                                type="button"
                                variant={statusFilter === option.value ? "default" : "outline"}
                                size="sm"
                                onClick={() => setStatusFilter(option.value)}
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Tipo Doc</TableHead>
                                    <TableHead>Nombre Doc</TableHead>
                                    <TableHead>Factura</TableHead>
                                    <TableHead>RUT</TableHead>
                                    <TableHead>Razón social</TableHead>
                                    <TableHead>Vendedor</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Monto / saldo</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredInvoices.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                                            No se encontraron facturas.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredInvoices.map((invoice) => (
                                        <TableRow key={invoice.id}>
                                            <TableCell>{invoice.tipo_documento || "-"}</TableCell>
                                            <TableCell>{invoice.nombre_documento || "-"}</TableCell>
                                            <TableCell className="font-medium">{invoice.numero_documento || "-"}</TableCell>
                                            <TableCell>{invoice.rut || "-"}</TableCell>
                                            <TableCell>{invoice.tercero_nombre || "Sin nombre"}</TableCell>
                                            <TableCell>{invoice.vendedor_asignado || "-"}</TableCell>
                                            <TableCell>
                                                {new Date((invoice.fecha_emision || invoice.created_at).split('T')[0] + 'T12:00:00').toLocaleDateString()}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={
                                                    invoice.estado === 'pagada' ? 'default' :
                                                        invoice.estado === 'abonada' ? 'secondary' :
                                                        invoice.estado === 'pendiente' ? 'secondary' :
                                                            invoice.estado === 'archivada' ? 'outline' : 'destructive'
                                                }>
                                                    {invoice.estado?.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                ${getEffectiveInvoiceAmount(invoice).toLocaleString('es-CL')}
                                            </TableCell>
                                            <TableCell className="text-right flex justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className={cn(!invoice.archivo_url && "opacity-30 cursor-not-allowed")}
                                                    onClick={() => invoice.archivo_url && window.open(invoice.archivo_url, '_blank')}
                                                    title={invoice.archivo_url ? "Ver PDF escaneado" : "No hay PDF asociado"}
                                                >
                                                    <FileText className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openEditDialog(invoice)}
                                                    disabled={!canEdit}
                                                    title="Editar factura"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                    onClick={() => handleDeleteFactura(invoice.id, invoice.numero_documento)}
                                                    disabled={!canEdit}
                                                    title="Archivar factura"
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

            <Dialog open={Boolean(editingInvoice)} onOpenChange={(open) => {
                if (!open) {
                    setEditingInvoice(null);
                    setEditForm(null);
                }
            }}>
                <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Editar factura</DialogTitle>
                        <DialogDescription>
                            Actualiza los datos de la factura. El estado de pago se gestiona desde la conciliación bancaria.
                        </DialogDescription>
                    </DialogHeader>
                    {editForm && (
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Tipo</label>
                                <Select value={editForm.tipo} onValueChange={(value) => setEditForm((current) => current ? { ...current, tipo: value as InvoiceEditForm["tipo"] } : current)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="venta">Venta</SelectItem>
                                        <SelectItem value="compra">Compra</SelectItem>
                                        <SelectItem value="nota_credito">Nota de crédito</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Folio / número</label>
                                <Input value={editForm.numero_documento} onChange={(event) => setEditForm((current) => current ? { ...current, numero_documento: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Tipo de documento</label>
                                <Input placeholder="Ej.: 33" value={editForm.tipo_documento} onChange={(event) => setEditForm((current) => current ? { ...current, tipo_documento: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Nombre del documento</label>
                                <Input placeholder="Ej.: Factura electrónica" value={editForm.nombre_documento} onChange={(event) => setEditForm((current) => current ? { ...current, nombre_documento: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Razón social</label>
                                <Input value={editForm.tercero_nombre} onChange={(event) => setEditForm((current) => current ? { ...current, tercero_nombre: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">RUT</label>
                                <Input value={editForm.rut} onChange={(event) => setEditForm((current) => current ? { ...current, rut: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Fecha de emisión</label>
                                <Input type="date" value={editForm.fecha_emision} onChange={(event) => setEditForm((current) => current ? { ...current, fecha_emision: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Fecha de vencimiento</label>
                                <Input type="date" value={editForm.fecha_vencimiento} onChange={(event) => setEditForm((current) => current ? { ...current, fecha_vencimiento: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Monto</label>
                                <Input type="number" min="0.01" step="0.01" value={editForm.monto} onChange={(event) => setEditForm((current) => current ? { ...current, monto: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Vendedor asignado</label>
                                <Input value={editForm.vendedor_asignado} onChange={(event) => setEditForm((current) => current ? { ...current, vendedor_asignado: event.target.value } : current)} />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-sm font-medium">Descripción / notas</label>
                                <Textarea value={editForm.descripcion} onChange={(event) => setEditForm((current) => current ? { ...current, descripcion: event.target.value } : current)} />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setEditingInvoice(null); setEditForm(null); }} disabled={savingInvoice}>Cancelar</Button>
                        <Button onClick={handleSaveInvoice} disabled={savingInvoice || !canEdit}>
                            {savingInvoice && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar cambios
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
