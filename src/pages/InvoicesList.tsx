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
import { Plus, Search, FileText, Loader2, Trash2 } from "lucide-react";
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

export default function InvoicesList() {
    const { selectedEmpresaId } = useCompany();
    const { user } = useAuth();
    const [invoices, setInvoices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [invoiceNumberFilter, setInvoiceNumberFilter] = useState("");
    const [customerFilter, setCustomerFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [vendorFilter, setVendorFilter] = useState("all");

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
        if (!selectedEmpresaId) return;
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

    const vendorOptions = useMemo(() => {
        const vendors = invoices
            .map((invoice) => invoice.vendedor_asignado?.trim())
            .filter((vendor): vendor is string => Boolean(vendor));
        return Array.from(new Set(vendors)).sort((a, b) => a.localeCompare(b, "es"));
    }, [invoices]);

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
                        <Button>
                            <Plus className="mr-2 h-4 w-4" /> Nueva Factura
                        </Button>
                    </Link>
                    <Link to="/facturas/importar">
                        <Button variant="outline">
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
                                    <TableHead className="text-right">Monto</TableHead>
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
                                                        invoice.estado === 'pendiente' ? 'secondary' :
                                                            invoice.estado === 'archivada' ? 'outline' : 'destructive'
                                                }>
                                                    {invoice.estado?.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                ${parseFloat(invoice.monto).toLocaleString('es-CL')}
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
                                                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                    onClick={() => handleDeleteFactura(invoice.id, invoice.numero_documento)}
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
        </div>
    );
}
