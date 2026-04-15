import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, CreditCard, Landmark, Loader2, Plus, RefreshCcw, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { canEditTreasury, formatTreasuryCurrency, formatTreasuryDate } from "@/lib/treasury";
import { useBankAccounts, useTreasuryKpis, useWebpayReceivables } from "@/hooks/useTreasury";
import type { WebpayReceivable } from "@/lib/treasury";
import { cn } from "@/lib/utils";

type InvoiceOption = {
  id: string;
  numero_documento: string | null;
  tercero_id: string | null;
  tercero_nombre: string | null;
  monto: number;
};

type ClientOption = {
  id: string;
  razon_social: string;
};

type WebpayForm = {
  canal: WebpayReceivable["canal"];
  ordenCompra: string;
  codigoAutorizacion: string;
  marcaTarjeta: string;
  cuotas: string;
  terceroId: string;
  facturaId: string;
  bankAccountId: string;
  montoBruto: string;
  montoComision: string;
  montoNeto: string;
  montoAplicadoFactura: string;
  fechaVenta: string;
  fechaAbonoEsperada: string;
  estado: WebpayReceivable["estado"];
  notas: string;
};

const today = new Date().toISOString().split("T")[0];

const addDaysIso = (days: number) => {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString().split("T")[0];
};

const createWebpayForm = (): WebpayForm => ({
  canal: "webpay_plus",
  ordenCompra: "",
  codigoAutorizacion: "",
  marcaTarjeta: "",
  cuotas: "1",
  terceroId: "none",
  facturaId: "none",
  bankAccountId: "none",
  montoBruto: "",
  montoComision: "0",
  montoNeto: "",
  montoAplicadoFactura: "",
  fechaVenta: today,
  fechaAbonoEsperada: addDaysIso(2),
  estado: "pendiente",
  notas: "",
});

const webpayStatusLabels: Record<WebpayReceivable["estado"], string> = {
  pendiente: "Pendiente",
  conciliado: "Conciliado",
  rechazado: "Rechazado",
  anulado: "Anulado",
};

const webpayStatusClasses: Record<WebpayReceivable["estado"], string> = {
  pendiente: "border-amber-200 bg-amber-50 text-amber-700",
  conciliado: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rechazado: "border-red-200 bg-red-50 text-red-700",
  anulado: "border-slate-200 bg-slate-50 text-slate-700",
};

const webpayChannelLabels: Record<WebpayReceivable["canal"], string> = {
  webpay_plus: "WebPay Plus",
  webpay_link: "WebPay Link",
  transbank: "Transbank",
  otro: "Otro",
};

export default function WebPay() {
  const { selectedEmpresa, selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const [form, setForm] = useState<WebpayForm>(createWebpayForm());
  const [saving, setSaving] = useState(false);
  const [supportLoading, setSupportLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingItem, setEditingItem] = useState<WebpayReceivable | null>(null);
  const [editForm, setEditForm] = useState({
    estado: "pendiente" as WebpayReceivable["estado"],
    bankAccountId: "none",
    fechaAbonoEsperada: today,
    fechaAbonoReal: "",
    notas: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: webpayRows, loading, refresh } = useWebpayReceivables(selectedEmpresaId);
  const { data: bankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: kpis } = useTreasuryKpis(selectedEmpresaId, today);

  const invoiceMap = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);
  const bankAccountMap = useMemo(() => new Map(bankAccounts.map((account) => [account.id, account])), [bankAccounts]);

  useEffect(() => {
    if (selectedEmpresaId) {
      void fetchSupportData();
    } else {
      setInvoices([]);
      setClients([]);
    }
  }, [selectedEmpresaId]);

  const fetchSupportData = async () => {
    if (!selectedEmpresaId) return;
    setSupportLoading(true);
    try {
      const [{ data: invoiceRows, error: invoiceError }, { data: clientRows, error: clientError }] = await Promise.all([
        supabase
          .from("facturas")
          .select("id, numero_documento, tercero_id, tercero_nombre, monto")
          .eq("empresa_id", selectedEmpresaId)
          .eq("tipo", "venta")
          .in("estado", ["pendiente", "morosa"])
          .order("fecha_emision", { ascending: false }),
        supabase
          .from("terceros")
          .select("id, razon_social")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["cliente", "ambos"])
          .order("razon_social", { ascending: true }),
      ]);
      if (invoiceError) throw invoiceError;
      if (clientError) throw clientError;
      setInvoices((invoiceRows || []) as InvoiceOption[]);
      setClients((clientRows || []) as ClientOption[]);
    } catch (error) {
      console.error("Error loading WebPay support data:", error);
    } finally {
      setSupportLoading(false);
    }
  };

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return webpayRows.filter((row) => {
      if (statusFilter !== "all" && row.estado !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return [
        row.ordenCompra,
        row.codigoAutorizacion,
        row.terceroNombre,
        row.facturaNumero,
        row.marcaTarjeta,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [search, statusFilter, webpayRows]);

  const pendingRows = useMemo(
    () => webpayRows.filter((row) => row.estado === "pendiente"),
    [webpayRows]
  );

  const pendingNetAmount = useMemo(
    () => pendingRows.reduce((sum, row) => sum + row.montoNeto, 0),
    [pendingRows]
  );

  const pendingGrossAmount = useMemo(
    () => pendingRows.reduce((sum, row) => sum + row.montoBruto, 0),
    [pendingRows]
  );

  const nextThreeDaysNet = useMemo(() => {
    const limit = addDaysIso(3);
    return pendingRows
      .filter((row) => row.fechaAbonoEsperada <= limit)
      .reduce((sum, row) => sum + row.montoNeto, 0);
  }, [pendingRows]);

  const handleInvoiceSelect = (invoiceId: string) => {
    const invoice = invoiceMap.get(invoiceId);
    setForm((current) => ({
      ...current,
      facturaId: invoiceId,
      terceroId: invoice?.tercero_id || current.terceroId,
      montoAplicadoFactura: invoice ? String(invoice.monto) : current.montoAplicadoFactura,
      montoBruto: invoice ? String(invoice.monto) : current.montoBruto,
      montoNeto: invoice ? String(invoice.monto - Number(current.montoComision || 0)) : current.montoNeto,
    }));
  };

  const setGrossAndFees = (gross: string, fee: string) => {
    const grossValue = Number(gross || 0);
    const feeValue = Number(fee || 0);
    setForm((current) => ({
      ...current,
      montoBruto: gross,
      montoComision: fee,
      montoNeto: String(Math.max(grossValue - feeValue, 0)),
      montoAplicadoFactura: current.facturaId === "none" ? current.montoAplicadoFactura : gross,
    }));
  };

  const handleCreateRow = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedEmpresaId || !user || !canEdit) return;
    if (!form.ordenCompra || !form.montoBruto || !form.fechaAbonoEsperada) {
      alert("Orden de compra, monto bruto y fecha esperada son obligatorios.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("webpay_liquidaciones").insert({
        empresa_id: selectedEmpresaId,
        bank_account_id: form.bankAccountId === "none" ? null : form.bankAccountId,
        tercero_id: form.terceroId === "none" ? null : form.terceroId,
        factura_id: form.facturaId === "none" ? null : form.facturaId,
        canal: form.canal,
        orden_compra: form.ordenCompra,
        codigo_autorizacion: form.codigoAutorizacion || null,
        marca_tarjeta: form.marcaTarjeta || null,
        cuotas: Number(form.cuotas || 1),
        moneda: "CLP",
        monto_bruto: Number(form.montoBruto || 0),
        monto_comision: Number(form.montoComision || 0),
        monto_neto: Number(form.montoNeto || 0),
        monto_aplicado_factura: Number(form.montoAplicadoFactura || 0),
        fecha_venta: form.fechaVenta,
        fecha_abono_esperada: form.fechaAbonoEsperada,
        estado: form.estado,
        notas: form.notas || null,
        created_by: user.id,
      });
      if (error) throw error;
      setForm(createWebpayForm());
      await refresh();
    } catch (error: any) {
      console.error("Error creating WebPay row:", error);
      alert(error.message || "No se pudo registrar el pago WebPay.");
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (row: WebpayReceivable) => {
    setEditingItem(row);
    setEditForm({
      estado: row.estado,
      bankAccountId: row.bankAccountId || "none",
      fechaAbonoEsperada: row.fechaAbonoEsperada,
      fechaAbonoReal: row.fechaAbonoReal || "",
      notas: row.notas || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!selectedEmpresaId || !editingItem || !canEdit) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from("webpay_liquidaciones")
        .update({
          estado: editForm.estado,
          bank_account_id: editForm.bankAccountId === "none" ? null : editForm.bankAccountId,
          fecha_abono_esperada: editForm.fechaAbonoEsperada,
          fecha_abono_real: editForm.fechaAbonoReal || null,
          notas: editForm.notas || null,
        })
        .eq("id", editingItem.id)
        .eq("empresa_id", selectedEmpresaId);
      if (error) throw error;
      setEditingItem(null);
      await refresh();
    } catch (error: any) {
      console.error("Error updating WebPay row:", error);
      alert(error.message || "No se pudo actualizar el registro WebPay.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>WebPay sin empresa activa</CardTitle>
            <CardDescription>Selecciona una empresa para registrar pagos WebPay por recibir.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">WebPay</h1>
          <p className="mt-1 text-muted-foreground">
            Controla los abonos WebPay pendientes de liquidación para {selectedEmpresa?.nombre || "la empresa"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/cashflow">
              <Wallet className="mr-2 h-4 w-4" />
              Ver Tesorería
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/reconciliation">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Ir a Banco
            </Link>
          </Button>
          <Button variant="outline" onClick={() => { void refresh(); void fetchSupportData(); }}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refrescar
          </Button>
        </div>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar WebPay pendiente, pero no crear ni editar registros.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Neto pendiente"
          value={formatTreasuryCurrency(pendingNetAmount)}
          description={`${pendingRows.length} abono(s) pendientes`}
          icon={<CreditCard className="h-4 w-4" />}
        />
        <MetricCard
          title="Bruto comprometido"
          value={formatTreasuryCurrency(pendingGrossAmount)}
          description="Pago aceptado por clientes"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          title="Abona en 3 días"
          value={formatTreasuryCurrency(nextThreeDaysNet)}
          description="Entrada esperada a muy corto plazo"
          icon={<Landmark className="h-4 w-4" />}
        />
        <MetricCard
          title="Caja actual"
          value={formatTreasuryCurrency(kpis.currentCash)}
          description="Saldo bancario consolidado"
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Registrar pago WebPay por recibir</CardTitle>
            <CardDescription>
              Vincúlalo a la factura para que la caja considere solo el abono neto pendiente, sin duplicar la cobranza comercial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateRow}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Canal</Label>
                  <Select value={form.canal} onValueChange={(value) => setForm((current) => ({ ...current, canal: value as WebpayReceivable["canal"] }))} disabled={!canEdit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="webpay_plus">WebPay Plus</SelectItem>
                      <SelectItem value="webpay_link">WebPay Link</SelectItem>
                      <SelectItem value="transbank">Transbank</SelectItem>
                      <SelectItem value="otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Orden de compra</Label>
                  <Input value={form.ordenCompra} onChange={(event) => setForm((current) => ({ ...current, ordenCompra: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Código autorización</Label>
                  <Input value={form.codigoAutorizacion} onChange={(event) => setForm((current) => ({ ...current, codigoAutorizacion: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Marca tarjeta</Label>
                  <Input value={form.marcaTarjeta} onChange={(event) => setForm((current) => ({ ...current, marcaTarjeta: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Cliente / tercero</Label>
                  <Select value={form.terceroId} onValueChange={(value) => setForm((current) => ({ ...current, terceroId: value }))} disabled={!canEdit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin tercero vinculado</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.razon_social}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Factura asociada</Label>
                  <Select value={form.facturaId} onValueChange={handleInvoiceSelect} disabled={!canEdit || supportLoading}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin factura asociada</SelectItem>
                      {invoices.map((invoice) => (
                        <SelectItem key={invoice.id} value={invoice.id}>
                          {(invoice.numero_documento || "Sin folio")} • {invoice.tercero_nombre || "Sin cliente"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Monto bruto</Label>
                  <Input type="number" min="0" value={form.montoBruto} onChange={(event) => setGrossAndFees(event.target.value, form.montoComision)} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Comisión</Label>
                  <Input type="number" min="0" value={form.montoComision} onChange={(event) => setGrossAndFees(form.montoBruto, event.target.value)} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Monto neto</Label>
                  <Input type="number" min="0" value={form.montoNeto} onChange={(event) => setForm((current) => ({ ...current, montoNeto: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Monto aplicado a factura</Label>
                  <Input type="number" min="0" value={form.montoAplicadoFactura} onChange={(event) => setForm((current) => ({ ...current, montoAplicadoFactura: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Cuotas</Label>
                  <Input type="number" min="1" value={form.cuotas} onChange={(event) => setForm((current) => ({ ...current, cuotas: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Cuenta destino</Label>
                  <Select value={form.bankAccountId} onValueChange={(value) => setForm((current) => ({ ...current, bankAccountId: value }))} disabled={!canEdit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin cuenta asignada</SelectItem>
                      {bankAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha venta</Label>
                  <Input type="date" value={form.fechaVenta} onChange={(event) => setForm((current) => ({ ...current, fechaVenta: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha abono esperada</Label>
                  <Input type="date" value={form.fechaAbonoEsperada} onChange={(event) => setForm((current) => ({ ...current, fechaAbonoEsperada: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={form.estado} onValueChange={(value) => setForm((current) => ({ ...current, estado: value as WebpayReceivable["estado"] }))} disabled={!canEdit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Notas</Label>
                  <Textarea value={form.notas} onChange={(event) => setForm((current) => ({ ...current, notas: event.target.value }))} disabled={!canEdit} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <div className="text-sm text-muted-foreground">
                  Tesorería tomará el monto neto como caja futura y descontará el bruto de la factura vinculada.
                </div>
                <Button type="submit" disabled={!canEdit || saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Guardar WebPay
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Abonos pendientes</CardTitle>
            <CardDescription>Lo que ya cobraste al cliente, pero aún no llegó a banco.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingRows.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                No hay WebPay pendiente.
              </div>
            )}
            {pendingRows.slice(0, 6).map((row) => (
              <div key={row.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {row.ordenCompra} • {row.terceroNombre || row.facturaNumero || "Cobro sin vínculo"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {webpayChannelLabels[row.canal]} • abono esperado {formatTreasuryDate(row.fechaAbonoEsperada)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatTreasuryCurrency(row.montoNeto, row.moneda)}</div>
                    <Badge variant="outline" className={cn(webpayStatusClasses[row.estado])}>
                      {webpayStatusLabels[row.estado]}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Liquidaciones WebPay</CardTitle>
            <CardDescription>Gestiona estado, fecha de abono y cuenta de destino de cada operación.</CardDescription>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar orden, cliente o autorización..." />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="conciliado">Conciliado</SelectItem>
                <SelectItem value="rechazado">Rechazado</SelectItem>
                <SelectItem value="anulado">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Orden</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Neto</TableHead>
                <TableHead>Abono esperado</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Gestión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">{row.ordenCompra}</div>
                    <div className="text-xs text-muted-foreground">{webpayChannelLabels[row.canal]}</div>
                  </TableCell>
                  <TableCell>
                    <div>{row.terceroNombre || "Sin tercero"}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.facturaNumero ? `Factura ${row.facturaNumero}` : row.codigoAutorizacion || "Sin autorización"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{formatTreasuryCurrency(row.montoBruto, row.moneda)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatTreasuryCurrency(row.montoNeto, row.moneda)}</TableCell>
                  <TableCell>{formatTreasuryDate(row.fechaAbonoEsperada)}</TableCell>
                  <TableCell>{row.bankAccountId ? bankAccountMap.get(row.bankAccountId)?.nombre || "Cuenta" : "Sin cuenta"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(webpayStatusClasses[row.estado])}>
                      {webpayStatusLabels[row.estado]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => openEditDialog(row)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "No hay liquidaciones WebPay para el filtro actual."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar registro WebPay</DialogTitle>
            <DialogDescription>
              Ajusta el estado y la fecha real de abono para que Tesorería y Banco reflejen la recepción efectiva.
            </DialogDescription>
          </DialogHeader>

          {editingItem && (
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Operación</Label>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="font-medium">
                    {editingItem.ordenCompra} • {editingItem.terceroNombre || editingItem.facturaNumero || "Sin vínculo"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Neto {formatTreasuryCurrency(editingItem.montoNeto, editingItem.moneda)} • abono esperado {formatTreasuryDate(editingItem.fechaAbonoEsperada)}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Select value={editForm.estado} onValueChange={(value) => setEditForm((current) => ({ ...current, estado: value as WebpayReceivable["estado"] }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendiente">Pendiente</SelectItem>
                    <SelectItem value="conciliado">Conciliado</SelectItem>
                    <SelectItem value="rechazado">Rechazado</SelectItem>
                    <SelectItem value="anulado">Anulado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cuenta destino</Label>
                <Select value={editForm.bankAccountId} onValueChange={(value) => setEditForm((current) => ({ ...current, bankAccountId: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cuenta asignada</SelectItem>
                    {bankAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fecha abono esperada</Label>
                <Input type="date" value={editForm.fechaAbonoEsperada} onChange={(event) => setEditForm((current) => ({ ...current, fechaAbonoEsperada: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Fecha abono real</Label>
                <Input type="date" value={editForm.fechaAbonoReal} onChange={(event) => setEditForm((current) => ({ ...current, fechaAbonoReal: event.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notas</Label>
                <Textarea value={editForm.notas} onChange={(event) => setEditForm((current) => ({ ...current, notas: event.target.value }))} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)} disabled={savingEdit}>
              Cerrar
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
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
  icon: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={cn(tone === "warning" && "border-amber-200")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={cn("rounded-full p-2", tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-primary/10 text-primary")}>
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
