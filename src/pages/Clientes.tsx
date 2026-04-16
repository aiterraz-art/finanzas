import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { HandCoins, Loader2, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  canEditTreasury,
  formatTreasuryCurrency,
  formatTreasuryDate,
  formatTreasuryDateTime,
  getConfidenceClasses,
  getConfidenceLabel,
} from "@/lib/treasury";
import { useCollectionPipeline, useTreasuryCategories } from "@/hooks/useTreasury";
import { cn } from "@/lib/utils";

type Cliente = {
  id: string;
  rut: string;
  razon_social: string;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  plazo_pago_dias?: number | null;
};

const today = new Date().toISOString().split("T")[0];

export default function Clientes() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewClienteOpen, setIsNewClienteOpen] = useState(false);
  const [isSavingCliente, setIsSavingCliente] = useState(false);
  const [isNewInvoiceOpen, setIsNewInvoiceOpen] = useState(false);
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [promiseTarget, setPromiseTarget] = useState<any | null>(null);
  const [savingPromise, setSavingPromise] = useState(false);
  const [newClienteData, setNewClienteData] = useState({
    rut: "",
    razon_social: "",
    email: "",
    telefono: "",
    direccion: "",
    plazo_pago_dias: 30,
  });
  const [newInvoiceData, setNewInvoiceData] = useState({
    tercero_id: "",
    fecha_emision: today,
    numero_documento: "",
    monto: "",
  });
  const [promiseForm, setPromiseForm] = useState({
    promisedDate: "",
    promisedAmount: "",
    channel: "call",
    notes: "",
  });

  const { data: collectionPipeline, loading: pipelineLoading, refresh: refreshPipeline } = useCollectionPipeline(selectedEmpresaId, today);
  const { data: treasuryCategories } = useTreasuryCategories(selectedEmpresaId);

  useEffect(() => {
    if (selectedEmpresaId) {
      void fetchClientes();
    }
  }, [selectedEmpresaId]);

  const fetchClientes = async () => {
    if (!selectedEmpresaId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("terceros")
        .select("id, rut, razon_social, email, telefono, direccion, plazo_pago_dias")
        .eq("empresa_id", selectedEmpresaId)
        .eq("tipo", "cliente")
        .eq("estado", "activo")
        .order("razon_social", { ascending: true });
      if (error) throw error;
      setClientes((data || []) as Cliente[]);
    } catch (error) {
      console.error("Error fetching clientes:", error);
    } finally {
      setLoading(false);
    }
  };

  const groupedClients = useMemo(() => {
    const pipelineByClient = new Map<string, any[]>();
    for (const item of collectionPipeline) {
      const current = pipelineByClient.get(item.terceroId) || [];
      current.push(item);
      pipelineByClient.set(item.terceroId, current);
    }

    return clientes
      .map((cliente) => {
        const invoices = pipelineByClient.get(cliente.id) || [];
        const outstanding = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
        const activePromises = invoices.filter((invoice) => invoice.promisedPaymentDate).length;
        const highestOverdue = invoices.reduce((max, invoice) => Math.max(max, invoice.daysOverdue), 0);
        return {
          ...cliente,
          invoices,
          outstanding,
          activePromises,
          highestOverdue,
        };
      })
      .filter((cliente) => {
        const normalized = searchQuery.trim().toLowerCase();
        if (!normalized) return true;
        return (
          cliente.razon_social.toLowerCase().includes(normalized) ||
          cliente.rut.toLowerCase().includes(normalized) ||
          cliente.invoices.some((invoice) => invoice.numeroDocumento.toLowerCase().includes(normalized))
        );
      });
  }, [clientes, collectionPipeline, searchQuery]);

  const totals = useMemo(() => {
    return groupedClients.reduce(
      (acc, cliente) => {
        acc.outstanding += cliente.outstanding;
        acc.promised += cliente.invoices
          .filter((invoice) => invoice.promisedPaymentDate)
          .reduce((sum, invoice) => sum + invoice.amount, 0);
        acc.risk += cliente.invoices
          .filter((invoice) => invoice.disputed || invoice.daysOverdue > 30)
          .reduce((sum, invoice) => sum + invoice.amount, 0);
        return acc;
      },
      { outstanding: 0, promised: 0, risk: 0 }
    );
  }, [groupedClients]);

  const salesCategoryId = treasuryCategories.find((category) => category.code === "sales")?.id ?? null;

  const handleCreateClienteManual = async () => {
    if (!selectedEmpresaId) return;
    if (!newClienteData.rut || !newClienteData.razon_social || !newClienteData.email || !newClienteData.telefono) {
      alert("RUT, Razón Social, Email y Teléfono son campos obligatorios.");
      return;
    }

    setIsSavingCliente(true);
    try {
      const cleanRut = newClienteData.rut.replace(/\./g, "").replace(/-/g, "").toUpperCase();
      const { error } = await supabase.from("terceros").insert({
        empresa_id: selectedEmpresaId,
        ...newClienteData,
        rut: cleanRut,
        tipo: "cliente",
        estado: "activo",
      });
      if (error) throw error;

      setIsNewClienteOpen(false);
      setNewClienteData({ rut: "", razon_social: "", email: "", telefono: "", direccion: "", plazo_pago_dias: 30 });
      await fetchClientes();
    } catch (error: any) {
      console.error("Error al crear cliente:", error);
      alert(`No se pudo crear el cliente: ${error.message}`);
    } finally {
      setIsSavingCliente(false);
    }
  };

  const handleCreateVentaInvoice = async () => {
    if (!selectedEmpresaId) return;
    if (!newInvoiceData.tercero_id || !newInvoiceData.fecha_emision || !newInvoiceData.numero_documento || !newInvoiceData.monto) {
      alert("Selecciona cliente y completa fecha, folio y monto.");
      return;
    }

    const selectedClient = clientes.find((cliente) => cliente.id === newInvoiceData.tercero_id);
    if (!selectedClient) {
      alert("Cliente no válido.");
      return;
    }

    setIsSavingInvoice(true);
    try {
      const plazo = Number(selectedClient.plazo_pago_dias ?? 30);
      const vencimiento = format(addDays(new Date(`${newInvoiceData.fecha_emision}T12:00:00`), plazo), "yyyy-MM-dd");
      const { error } = await supabase.from("facturas").insert({
        empresa_id: selectedEmpresaId,
        tipo: "venta",
        tercero_id: selectedClient.id,
        tercero_nombre: selectedClient.razon_social,
        rut: selectedClient.rut,
        fecha_emision: newInvoiceData.fecha_emision,
        fecha_vencimiento: vencimiento,
        numero_documento: newInvoiceData.numero_documento.trim(),
        monto: Number(newInvoiceData.monto),
        estado: "pendiente",
        planned_cash_date: vencimiento,
        cash_confidence_pct: 90,
        treasury_priority: "high",
        treasury_category_id: salesCategoryId,
      });
      if (error) throw error;

      setIsNewInvoiceOpen(false);
      setNewInvoiceData({ tercero_id: "", fecha_emision: today, numero_documento: "", monto: "" });
      await refreshPipeline();
    } catch (error: any) {
      console.error("Error creando factura:", error);
      alert(`No se pudo guardar la factura: ${error.message}`);
    } finally {
      setIsSavingInvoice(false);
    }
  };

  const handleSavePromise = async () => {
    if (!selectedEmpresaId || !promiseTarget || !user) return;
    if (!promiseForm.promisedDate) {
      alert("Debes indicar una fecha prometida.");
      return;
    }

    setSavingPromise(true);
    try {
      const { error } = await supabase.from("collection_events").insert({
        empresa_id: selectedEmpresaId,
        factura_id: promiseTarget.facturaId,
        tercero_id: promiseTarget.terceroId,
        channel: promiseForm.channel,
        event_type: "promise",
        promised_date: promiseForm.promisedDate,
        promised_amount: promiseForm.promisedAmount ? Number(promiseForm.promisedAmount) : promiseTarget.amount,
        notes: promiseForm.notes || "Promesa registrada desde clientes.",
        created_by: user.id,
      });
      if (error) throw error;

      setPromiseTarget(null);
      setPromiseForm({ promisedDate: "", promisedAmount: "", channel: "call", notes: "" });
      await refreshPipeline();
    } catch (error: any) {
      console.error("Error registrando promesa:", error);
      alert(`No se pudo registrar la promesa: ${error.message}`);
    } finally {
      setSavingPromise(false);
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Clientes</CardTitle>
            <CardDescription>Selecciona una empresa para revisar clientes y cobranzas.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clientes y Cobranzas</h1>
          <p className="mt-1 text-muted-foreground">
            Riesgo de cobro, promesas vigentes y creación de facturas de venta con metadata de tesorería.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/collections">Abrir pipeline</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/facturas/importar">Importar base</Link>
          </Button>
          <Button onClick={() => setIsNewInvoiceOpen(true)} disabled={!canEdit}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva factura
          </Button>
          <Button variant="outline" onClick={() => setIsNewClienteOpen(true)} disabled={!canEdit}>
            Nuevo cliente
          </Button>
        </div>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar clientes y cobranzas, pero no crear ni editar.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Clientes activos" value={String(clientes.length)} description="Base comercial vigente" />
        <SummaryCard title="Por cobrar" value={formatTreasuryCurrency(totals.outstanding)} description="Saldo abierto total" icon={<HandCoins className="h-4 w-4" />} />
        <SummaryCard title="Con promesa" value={formatTreasuryCurrency(totals.promised)} description="Cobros con compromiso registrado" />
        <SummaryCard title="Riesgo alto" value={formatTreasuryCurrency(totals.risk)} description="Disputas o mora superior a 30 días" tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Clientes</CardTitle>
              <CardDescription>Resumen por cliente y detalle de facturas abiertas.</CardDescription>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar cliente, RUT o documento..."
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(loading || pipelineLoading) && groupedClients.length === 0 && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {groupedClients.map((cliente) => (
            <div key={cliente.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="font-medium">{cliente.razon_social}</div>
                  <div className="text-sm text-muted-foreground">
                    {cliente.rut} • {cliente.email || "sin email"} • {cliente.telefono || "sin teléfono"}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{formatTreasuryCurrency(cliente.outstanding)}</Badge>
                  {cliente.activePromises > 0 && <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">{cliente.activePromises} promesa(s)</Badge>}
                  {cliente.highestOverdue > 30 && <Badge className="bg-red-100 text-red-700 hover:bg-red-100">riesgo alto</Badge>}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {cliente.invoices.length === 0 && (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Cliente al día.
                  </div>
                )}
                {cliente.invoices.map((invoice: any) => (
                  <div key={invoice.facturaId} className="rounded-xl border bg-muted/15 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.8fr_1fr]">
                      <div>
                        <div className="font-medium">Factura {invoice.numeroDocumento || "Sin folio"}</div>
                        <div className="text-sm text-muted-foreground">
                          Vence {formatTreasuryDate(invoice.dueDate)} • {invoice.daysOverdue > 0 ? `${invoice.daysOverdue} días mora` : "Al día"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Monto</div>
                        <div className="font-semibold">{formatTreasuryCurrency(invoice.amount)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Cobro esperado</div>
                        <div>{formatTreasuryDate(invoice.expectedDate)}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Confianza</div>
                        <div className={cn("font-semibold", getConfidenceClasses(invoice.confidencePct))}>
                          {invoice.confidencePct}% {getConfidenceLabel(invoice.confidencePct)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase text-muted-foreground">Última gestión</div>
                        <div>{formatTreasuryDateTime(invoice.lastContactAt, "Sin gestión")}</div>
                      </div>
                      <div className="flex flex-col items-start gap-2 lg:items-end">
                        <div className="text-sm">{invoice.suggestedNextAction}</div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEdit}
                            onClick={() => {
                              setPromiseTarget(invoice);
                              setPromiseForm({
                                promisedDate: invoice.promisedPaymentDate || "",
                                promisedAmount: String(invoice.amount),
                                channel: "call",
                                notes: "",
                              });
                            }}
                          >
                            Registrar promesa
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!loading && !pipelineLoading && groupedClients.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              No se encontraron clientes para el filtro actual.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isNewClienteOpen} onOpenChange={setIsNewClienteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>Alta manual de cliente activo.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="RUT">
              <Input value={newClienteData.rut} onChange={(event) => setNewClienteData((current) => ({ ...current, rut: event.target.value }))} />
            </Field>
            <Field label="Razón social">
              <Input value={newClienteData.razon_social} onChange={(event) => setNewClienteData((current) => ({ ...current, razon_social: event.target.value }))} />
            </Field>
            <Field label="Email">
              <Input value={newClienteData.email} onChange={(event) => setNewClienteData((current) => ({ ...current, email: event.target.value }))} />
            </Field>
            <Field label="Teléfono">
              <Input value={newClienteData.telefono} onChange={(event) => setNewClienteData((current) => ({ ...current, telefono: event.target.value }))} />
            </Field>
            <Field label="Dirección">
              <Input value={newClienteData.direccion} onChange={(event) => setNewClienteData((current) => ({ ...current, direccion: event.target.value }))} />
            </Field>
            <Field label="Plazo pago (días)">
              <Input type="number" min="0" value={newClienteData.plazo_pago_dias} onChange={(event) => setNewClienteData((current) => ({ ...current, plazo_pago_dias: Number(event.target.value || 0) }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewClienteOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateClienteManual} disabled={isSavingCliente}>
              {isSavingCliente ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNewInvoiceOpen} onOpenChange={setIsNewInvoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva factura de venta</DialogTitle>
            <DialogDescription>Se crea con metadata base de tesorería.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Cliente">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={newInvoiceData.tercero_id}
                onChange={(event) => setNewInvoiceData((current) => ({ ...current, tercero_id: event.target.value }))}
              >
                <option value="">Selecciona un cliente</option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.razon_social}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fecha emisión">
              <Input type="date" value={newInvoiceData.fecha_emision} onChange={(event) => setNewInvoiceData((current) => ({ ...current, fecha_emision: event.target.value }))} />
            </Field>
            <Field label="Número documento">
              <Input value={newInvoiceData.numero_documento} onChange={(event) => setNewInvoiceData((current) => ({ ...current, numero_documento: event.target.value }))} />
            </Field>
            <Field label="Monto">
              <Input type="number" min="0" value={newInvoiceData.monto} onChange={(event) => setNewInvoiceData((current) => ({ ...current, monto: event.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewInvoiceOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateVentaInvoice} disabled={isSavingInvoice}>
              {isSavingInvoice ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear factura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(promiseTarget)} onOpenChange={(open) => !open && setPromiseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar promesa de pago</DialogTitle>
            <DialogDescription>
              {promiseTarget
                ? `${promiseTarget.terceroNombre} • Factura ${promiseTarget.numeroDocumento || "Sin folio"}`
                : "Selecciona una factura."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Fecha prometida">
              <Input type="date" value={promiseForm.promisedDate} onChange={(event) => setPromiseForm((current) => ({ ...current, promisedDate: event.target.value }))} />
            </Field>
            <Field label="Monto prometido">
              <Input type="number" min="0" value={promiseForm.promisedAmount} onChange={(event) => setPromiseForm((current) => ({ ...current, promisedAmount: event.target.value }))} />
            </Field>
            <Field label="Canal">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={promiseForm.channel}
                onChange={(event) => setPromiseForm((current) => ({ ...current, channel: event.target.value }))}
              >
                <option value="call">Llamada</option>
                <option value="email">Correo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="meeting">Reunión</option>
                <option value="other">Otro</option>
              </select>
            </Field>
            <Field label="Notas">
              <Textarea value={promiseForm.notes} onChange={(event) => setPromiseForm((current) => ({ ...current, notes: event.target.value }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromiseTarget(null)}>Cancelar</Button>
            <Button onClick={handleSavePromise} disabled={savingPromise}>
              {savingPromise ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar promesa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  icon,
  tone = "default",
}: {
  title: string;
  value: string;
  description: string;
  icon?: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={tone === "warning" ? "border-amber-200" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon ? <div className="rounded-full bg-primary/10 p-2 text-primary">{icon}</div> : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
