import { type ReactNode, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  HandCoins,
  Loader2,
  MessageSquare,
  PhoneCall,
  Plus,
  Search,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCollectionPipeline, useTreasuryPolicy } from "@/hooks/useTreasury";
import {
  canEditTreasury,
  formatTreasuryCurrency,
  formatTreasuryDate,
  formatTreasuryDateTime,
  getConfidenceClasses,
  getConfidenceLabel,
} from "@/lib/treasury";
import type { CollectionPipelineItem } from "@/lib/treasury";
import { supabase } from "@/lib/supabase";

const today = new Date().toISOString().split("T")[0];

const quickMessage = (invoice: CollectionPipelineItem) =>
  `Hola ${invoice.terceroNombre}, seguimos la factura ${invoice.numeroDocumento || ""} por ${formatTreasuryCurrency(invoice.amount)}. ` +
  `Necesitamos confirmar fecha de pago${invoice.promisedPaymentDate ? ` comprometida para ${formatTreasuryDate(invoice.promisedPaymentDate)}` : ""}.`;

export default function Collections() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const [asOfDate] = useState(today);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeInvoice, setActiveInvoice] = useState<CollectionPipelineItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [eventForm, setEventForm] = useState({
    channel: "call",
    eventType: "reminder",
    promisedDate: "",
    promisedAmount: "",
    notes: "",
  });

  const { data: pipeline, loading, error, refresh } = useCollectionPipeline(selectedEmpresaId, asOfDate);
  const { data: policy } = useTreasuryPolicy(selectedEmpresaId);

  const filteredPipeline = useMemo(() => {
    const normalized = searchTerm.toLowerCase().trim();
    if (!normalized) return pipeline;
    return pipeline.filter(
      (item) =>
        item.terceroNombre.toLowerCase().includes(normalized) ||
        item.numeroDocumento.toLowerCase().includes(normalized) ||
        item.suggestedNextAction.toLowerCase().includes(normalized)
    );
  }, [pipeline, searchTerm]);

  const totals = useMemo(() => {
    return filteredPipeline.reduce(
      (acc, item) => {
        acc.total += item.amount;
        if (item.promisedPaymentDate) acc.withPromise += item.amount;
        if (item.disputed) acc.disputed += item.amount;
        const needsFollowUp =
          !item.lastContactAt ||
          new Date(item.lastContactAt).getTime() < Date.now() - policy.missingFollowupDays * 24 * 60 * 60 * 1000;
        if (needsFollowUp) acc.followUp += item.amount;
        return acc;
      },
      { total: 0, withPromise: 0, disputed: 0, followUp: 0 }
    );
  }, [filteredPipeline, policy.missingFollowupDays]);

  const resetEventForm = () => {
    setEventForm({
      channel: "call",
      eventType: "reminder",
      promisedDate: "",
      promisedAmount: "",
      notes: "",
    });
  };

  const handleOpenDialog = (invoice: CollectionPipelineItem) => {
    setActiveInvoice(invoice);
    resetEventForm();
  };

  const handleRegisterEvent = async () => {
    if (!selectedEmpresaId || !activeInvoice || !user || !canEdit) return;

    setSaving(true);
    try {
      const payload = {
        empresa_id: selectedEmpresaId,
        factura_id: activeInvoice.facturaId,
        tercero_id: activeInvoice.terceroId,
        channel: eventForm.channel,
        event_type: eventForm.eventType,
        promised_date: eventForm.promisedDate || null,
        promised_amount: eventForm.promisedAmount ? Number(eventForm.promisedAmount) : null,
        notes: eventForm.notes || null,
        created_by: user.id,
      };

      const { error: insertError } = await supabase.from("collection_events").insert(payload);
      if (insertError) throw insertError;

      setActiveInvoice(null);
      resetEventForm();
      await refresh();
    } catch (err: any) {
      console.error("Error registering collection event:", err);
      alert(`No se pudo registrar la gestion: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickWhatsapp = async (invoice: CollectionPipelineItem) => {
    if (!selectedEmpresaId || !user || !canEdit) return;
    try {
      const { data: facturaData, error: facturaError } = await supabase
        .from("facturas")
        .select("terceros(telefono)")
        .eq("empresa_id", selectedEmpresaId)
        .eq("id", invoice.facturaId)
        .single();
      if (facturaError) throw facturaError;

      await supabase.from("collection_events").insert({
        empresa_id: selectedEmpresaId,
        factura_id: invoice.facturaId,
        tercero_id: invoice.terceroId,
        channel: "whatsapp",
        event_type: "reminder",
        notes: "Gestion iniciada desde pipeline de cobranzas.",
        created_by: user.id,
      });

      const terceroInfo = Array.isArray(facturaData?.terceros) ? facturaData.terceros[0] : facturaData?.terceros;
      const rawPhone = terceroInfo?.telefono || "";
      const sanitizedPhone = rawPhone.replace(/[^0-9]/g, "");
      const url = `https://wa.me/${sanitizedPhone}?text=${encodeURIComponent(quickMessage(invoice))}`;
      window.open(url, "_blank", "noopener,noreferrer");
      await refresh();
    } catch (err: any) {
      console.error("Error launching WhatsApp collection flow:", err);
      alert(`No se pudo iniciar la gestion por WhatsApp: ${err.message}`);
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Selecciona una empresa</CardTitle>
            <CardDescription>La gestion de cobranzas depende de la empresa activa.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline de cobranzas</h1>
          <p className="mt-1 text-muted-foreground">
            Seguimiento por factura con promesa de pago, riesgo y proxima accion comercial.
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar cliente, documento o accion..."
            className="pl-10"
          />
        </div>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar el pipeline, pero no registrar gestiones.
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-200">
          <CardContent className="pt-6 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Saldo vencido / abierto"
          value={formatTreasuryCurrency(totals.total, policy.monedaBase)}
          description={`${filteredPipeline.length} factura(s) en seguimiento`}
          icon={<HandCoins className="h-4 w-4" />}
        />
        <SummaryCard
          title="Con promesa activa"
          value={formatTreasuryCurrency(totals.withPromise, policy.monedaBase)}
          description="Cobros ya comprometidos por cliente"
          icon={<Clock3 className="h-4 w-4" />}
        />
        <SummaryCard
          title="Sin follow-up reciente"
          value={formatTreasuryCurrency(totals.followUp, policy.monedaBase)}
          description={`Sin gestion en ${policy.missingFollowupDays} dias o mas`}
          icon={<PhoneCall className="h-4 w-4" />}
        />
        <SummaryCard
          title="En disputa"
          value={formatTreasuryCurrency(totals.disputed, policy.monedaBase)}
          description="Cobros fuera del inflow base"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="danger"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Facturas abiertas en gestion</CardTitle>
          <CardDescription>
            La ultima promesa actualiza el forecast y los eventos quedan trazados por responsable.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Vencimiento</th>
                <th className="px-4 py-3 text-center">Mora</th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-4 py-3 text-left">Fecha esperada</th>
                <th className="px-4 py-3 text-center">Probabilidad</th>
                <th className="px-4 py-3 text-left">Ultima gestion</th>
                <th className="px-4 py-3 text-left">Promesa</th>
                <th className="px-4 py-3 text-left">Responsable</th>
                <th className="px-4 py-3 text-left">Siguiente paso</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredPipeline.map((invoice) => (
                <tr key={invoice.facturaId} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{invoice.terceroNombre}</div>
                    <div className="text-xs text-muted-foreground">Doc. {invoice.numeroDocumento || "S/F"}</div>
                  </td>
                  <td className="px-4 py-3">{formatTreasuryDate(invoice.dueDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge
                      variant="outline"
                      className={
                        invoice.daysOverdue > 30
                          ? "border-red-200 bg-red-50 text-red-700"
                          : invoice.daysOverdue > 0
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }
                    >
                      {invoice.daysOverdue > 0 ? `${invoice.daysOverdue} dias` : "Al dia"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{formatTreasuryCurrency(invoice.amount, policy.monedaBase)}</td>
                  <td className="px-4 py-3">{formatTreasuryDate(invoice.expectedDate)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className={`font-semibold ${getConfidenceClasses(invoice.confidencePct)}`}>
                      {invoice.confidencePct}%
                    </div>
                    <div className="text-xs text-muted-foreground">{getConfidenceLabel(invoice.confidencePct)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{formatTreasuryDateTime(invoice.lastContactAt, "Sin gestion")}</div>
                    {invoice.lastEventType && (
                      <div className="text-xs text-muted-foreground capitalize">{invoice.lastEventType}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {invoice.promisedPaymentDate ? formatTreasuryDate(invoice.promisedPaymentDate) : "Sin promesa"}
                  </td>
                  <td className="px-4 py-3">
                    {invoice.responsibleEmail || <span className="text-muted-foreground">Sin responsable</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{invoice.suggestedNextAction}</div>
                    {invoice.disputed && <div className="text-xs text-red-600">Resolver disputa</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleQuickWhatsapp(invoice)} className="gap-2" disabled={!canEdit}>
                        <MessageSquare className="h-4 w-4" />
                        WhatsApp
                      </Button>
                      <Button size="sm" onClick={() => handleOpenDialog(invoice)} className="gap-2" disabled={!canEdit}>
                        <Plus className="h-4 w-4" />
                        Gestion
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredPipeline.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "No hay facturas para el filtro actual."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(activeInvoice)} onOpenChange={(open) => !open && setActiveInvoice(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar gestion de cobranza</DialogTitle>
            <DialogDescription>
              {activeInvoice
                ? `Cliente ${activeInvoice.terceroNombre} • Documento ${activeInvoice.numeroDocumento || "S/F"}`
                : "Selecciona una factura para registrar gestion."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Canal</Label>
              <Select value={eventForm.channel} onValueChange={(value) => setEventForm((current) => ({ ...current, channel: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona canal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">Llamada</SelectItem>
                  <SelectItem value="email">Correo</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="meeting">Reunion</SelectItem>
                  <SelectItem value="other">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tipo de gestion</Label>
              <Select value={eventForm.eventType} onValueChange={(value) => setEventForm((current) => ({ ...current, eventType: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona evento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reminder">Recordatorio</SelectItem>
                  <SelectItem value="promise">Promesa de pago</SelectItem>
                  <SelectItem value="dispute">Disputa</SelectItem>
                  <SelectItem value="no_answer">Sin respuesta</SelectItem>
                  <SelectItem value="resolved">Resuelto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Fecha prometida</Label>
              <Input
                type="date"
                value={eventForm.promisedDate}
                onChange={(event) => setEventForm((current) => ({ ...current, promisedDate: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Monto prometido</Label>
              <Input
                type="number"
                min="0"
                value={eventForm.promisedAmount}
                onChange={(event) => setEventForm((current) => ({ ...current, promisedAmount: event.target.value }))}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notas de gestion</Label>
            <Textarea
              value={eventForm.notes}
              onChange={(event) => setEventForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Resumen, objeciones, compromiso y siguiente paso."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveInvoice(null)}>
              Cancelar
            </Button>
            <Button onClick={handleRegisterEvent} disabled={saving || !canEdit}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar gestion
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
  icon: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <Card className={tone === "danger" ? "border-red-200" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={tone === "danger" ? "rounded-full bg-red-50 p-2 text-red-700" : "rounded-full bg-primary/10 p-2 text-primary"}>
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
