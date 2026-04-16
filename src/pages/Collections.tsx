import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Clock3,
  HandCoins,
  Loader2,
  MessageSquare,
  PhoneCall,
  Plus,
  Search,
  Upload,
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
  normalizeRut,
} from "@/lib/treasury";
import type { CollectionPipelineItem } from "@/lib/treasury";
import { supabase } from "@/lib/supabase";
import {
  buildInvoiceDuplicateKey,
  buildInvoiceObjectsFromWorksheet,
  detectReceivablesWorksheetFormat,
  inferReceivableEmissionDate,
  normalizeReceivableInvoiceImportRow,
  type ReceivableInvoiceImportRow,
} from "@/lib/invoice-import";

const today = new Date().toISOString().split("T")[0];

const quickMessage = (invoice: CollectionPipelineItem) =>
  `Hola ${invoice.terceroNombre}, seguimos la factura ${invoice.numeroDocumento || ""} por ${formatTreasuryCurrency(invoice.amount)}. ` +
  `Necesitamos confirmar fecha de pago${invoice.promisedPaymentDate ? ` comprometida para ${formatTreasuryDate(invoice.promisedPaymentDate)}` : ""}.`;

const IMPORT_CHUNK_SIZE = 100;

const chunkArray = <T,>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

export default function Collections() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [asOfDate] = useState(today);
  const [searchTerm, setSearchTerm] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"open" | "all">("open");
  const [activeInvoice, setActiveInvoice] = useState<CollectionPipelineItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [importingReceivables, setImportingReceivables] = useState(false);
  const [allInvoices, setAllInvoices] = useState<CollectionPipelineItem[]>([]);
  const [loadingAllInvoices, setLoadingAllInvoices] = useState(false);
  const [allInvoicesError, setAllInvoicesError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<null | {
    filename: string;
    totalRows: number;
    validRows: number;
    insertedRows: number;
    updatedRows: number;
    paidRows: number;
    duplicateRows: number;
    rejectedRows: number;
    omittedRows: number;
    createdClients: number;
  }>(null);
  const [eventForm, setEventForm] = useState({
    channel: "call",
    eventType: "reminder",
    promisedDate: "",
    promisedAmount: "",
    notes: "",
  });

  const { data: pipeline, loading, error, refresh } = useCollectionPipeline(selectedEmpresaId, asOfDate);
  const { data: policy } = useTreasuryPolicy(selectedEmpresaId);

  useEffect(() => {
    if (!selectedEmpresaId || scopeFilter !== "all") {
      setAllInvoices([]);
      setLoadingAllInvoices(false);
      setAllInvoicesError(null);
      return;
    }

    let cancelled = false;

    const loadAllInvoices = async () => {
      setLoadingAllInvoices(true);
      setAllInvoicesError(null);
      try {
        const { data, error: fetchError } = await supabase
          .from("facturas")
          .select(`
            id,
            tercero_id,
            tercero_nombre,
            numero_documento,
            monto,
            fecha_vencimiento,
            fecha_emision,
            planned_cash_date,
            promised_payment_date,
            cash_confidence_pct,
            last_collection_contact_at,
            disputed,
            estado
          `)
          .eq("empresa_id", selectedEmpresaId)
          .eq("tipo", "venta")
          .is("archived_at", null)
          .order("fecha_vencimiento", { ascending: true });
        if (fetchError) throw fetchError;
        if (cancelled) return;

        const mapped = (data || []).map((row) => {
          const dueDate =
            row.fecha_vencimiento ||
            (row.fecha_emision ? new Date(new Date(`${row.fecha_emision}T12:00:00`).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] : today);
          const expectedDate = row.planned_cash_date || row.promised_payment_date || dueDate;
          const referenceDate = row.estado === "pagada" ? expectedDate : today;
          const daysOverdue = dueDate
            ? Math.max(
                Math.floor(
                  (new Date(`${referenceDate}T12:00:00`).getTime() - new Date(`${dueDate}T12:00:00`).getTime()) /
                    (1000 * 60 * 60 * 24)
                ),
                0
              )
            : 0;

          return {
            facturaId: row.id,
            terceroId: row.tercero_id || "",
            terceroNombre: row.tercero_nombre || "Sin cliente",
            numeroDocumento: row.numero_documento || "",
            estado: row.estado || "pendiente",
            amount: Number(row.monto || 0),
            dueDate,
            expectedDate,
            confidencePct: Number(row.cash_confidence_pct || (row.estado === "pagada" ? 100 : 60)),
            daysOverdue,
            lastContactAt: row.last_collection_contact_at || null,
            promisedPaymentDate: row.promised_payment_date || null,
            lastEventType: row.estado === "pagada" ? "resolved" : null,
            responsibleEmail: null,
            disputed: Boolean(row.disputed),
            suggestedNextAction: row.estado === "pagada" ? "Pagada" : "Monitorear",
          } satisfies CollectionPipelineItem;
        });

        setAllInvoices(mapped);
      } catch (err: any) {
        if (cancelled) return;
        console.error("Error loading all collection invoices:", err);
        setAllInvoicesError(err?.message || "No se pudieron cargar todas las facturas.");
        setAllInvoices([]);
      } finally {
        if (!cancelled) setLoadingAllInvoices(false);
      }
    };

    void loadAllInvoices();
    return () => {
      cancelled = true;
    };
  }, [selectedEmpresaId, scopeFilter]);

  const inferReceivableDueDate = (row: ReceivableInvoiceImportRow) => {
    if (row.fechaVencimiento) return row.fechaVencimiento;
    if (row.fechaEmision) {
      const next = new Date(`${row.fechaEmision}T12:00:00`);
      next.setDate(next.getDate() + 30);
      return next.toISOString().split("T")[0];
    }
    return today;
  };

  const confidenceFromDueDate = (dueDate: string | null) => {
    if (!dueDate) return 60;
    const diffDays = Math.floor((new Date(`${today}T12:00:00`).getTime() - new Date(`${dueDate}T12:00:00`).getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 90;
    if (diffDays <= 15) return 70;
    if (diffDays <= 30) return 50;
    return 30;
  };

  const statusFromDueDate = (dueDate: string | null) => {
    if (!dueDate) return "pendiente";
    return dueDate < today ? "morosa" : "pendiente";
  };

  const matchText = (value: unknown) =>
    (value == null ? "" : String(value))
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const createMissingClients = async (rows: ReceivableInvoiceImportRow[], clients: Array<{ id: string; razon_social: string; rut: string | null }>) => {
    const clientByRut = new Map<string, { id: string; razon_social: string; rut: string | null }>();
    const clientByName = new Map<string, { id: string; razon_social: string; rut: string | null }>();
    for (const client of clients) {
      if (client.rut) clientByRut.set(normalizeRut(client.rut) || "", client);
      clientByName.set(matchText(client.razon_social), client);
    }

    const missing = new Map<string, { razon_social: string; rut: string | null }>();
    for (const row of rows) {
      const rut = normalizeRut(row.rut);
      const nameKey = matchText(row.terceroNombre);
      if ((rut && clientByRut.has(rut)) || clientByName.has(nameKey)) continue;
      missing.set(rut || nameKey, { razon_social: row.terceroNombre, rut });
    }

    const missingClients = Array.from(missing.values());
    for (const chunk of chunkArray(missingClients, IMPORT_CHUNK_SIZE)) {
      const payload = chunk.map((client) => ({
        empresa_id: selectedEmpresaId,
        rut: client.rut,
        razon_social: client.razon_social,
        tipo: "cliente",
        estado: "activo",
      }));
      const { error: insertError } = await supabase.from("terceros").insert(payload);
      if (!insertError) continue;

      for (const client of chunk) {
        const { error: singleInsertError } = await supabase.from("terceros").insert({
          empresa_id: selectedEmpresaId,
          rut: client.rut,
          razon_social: client.razon_social,
          tipo: "cliente",
          estado: "activo",
        });
        if (singleInsertError) {
          throw new Error(`No se pudo crear el cliente ${client.razon_social}${client.rut ? ` (${client.rut})` : ""}: ${singleInsertError.message}`);
        }
      }
    }

    const { data: refreshedClients, error: refreshError } = await supabase
      .from("terceros")
      .select("id, razon_social, rut")
      .eq("empresa_id", selectedEmpresaId)
      .in("tipo", ["cliente", "ambos"])
      .is("archived_at", null);
    if (refreshError) throw refreshError;

    return {
      count: missing.size,
      clients: refreshedClients || [],
    };
  };

  const handleImportReceivables = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedEmpresaId || !user || !canEdit) return;

    setImportingReceivables(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
      const detection = detectReceivablesWorksheetFormat(rows);
      if (detection.kind !== "receivables" || detection.headerRowIndex === null) {
        throw new Error(detection.reason || "No se detectó un layout compatible de cobranzas pendientes.");
      }

      const rawObjects = buildInvoiceObjectsFromWorksheet(rows, detection.headerRowIndex);
      let omittedRows = 0;
      const parsedRows = rawObjects.flatMap((row) => {
        const normalized = normalizeReceivableInvoiceImportRow(row);
        if (normalized && normalized.terceroNombre.toLowerCase() === "saldo cliente") {
          omittedRows += 1;
          return [];
        }
        return normalized ? [normalized] : [];
      }) as ReceivableInvoiceImportRow[];
      const validRows = parsedRows.filter(Boolean);
      const rejectedRows = rawObjects.length - validRows.length - omittedRows;

      const [{ data: clients, error: clientsError }, { data: invoices, error: invoicesError }, { data: salesCategory, error: categoryError }] = await Promise.all([
        supabase
          .from("terceros")
          .select("id, razon_social, rut")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["cliente", "ambos"])
          .is("archived_at", null),
        supabase
          .from("facturas")
          .select("id, numero_documento, rut, tercero_nombre, tercero_id, fecha_emision, monto, estado, tipo_documento")
          .eq("empresa_id", selectedEmpresaId)
          .eq("tipo", "venta")
          .is("archived_at", null),
        supabase
          .from("treasury_categories")
          .select("id")
          .eq("empresa_id", selectedEmpresaId)
          .eq("code", "sales")
          .maybeSingle(),
      ]);

      if (clientsError) throw clientsError;
      if (invoicesError) throw invoicesError;
      if (categoryError) throw categoryError;

      const { count: createdClients, clients: refreshedClients } = await createMissingClients(validRows, clients || []);
      const clientByRut = new Map<string, { id: string; razon_social: string; rut: string | null }>();
      const clientByName = new Map<string, { id: string; razon_social: string; rut: string | null }>();
      for (const client of refreshedClients) {
        if (client.rut) clientByRut.set(normalizeRut(client.rut) || "", client);
        clientByName.set(matchText(client.razon_social), client);
      }

      const existingInvoiceByKey = new Map<string, any>();
      for (const invoice of invoices || []) {
        const key = buildInvoiceDuplicateKey({
          numeroDocumento: invoice.numero_documento,
          rut: invoice.rut,
          terceroNombre: invoice.tercero_nombre || "",
          fechaEmision: invoice.fecha_emision,
          monto: Number(invoice.monto),
        });
        if (!existingInvoiceByKey.has(key)) existingInvoiceByKey.set(key, invoice);
      }

      const seenKeys = new Set<string>();
      const openKeys = new Set<string>();
      let duplicateRows = 0;
      let insertedRows = 0;
      let updatedRows = 0;
      const updates: Array<Record<string, unknown>> = [];
      const inserts: Array<Record<string, unknown>> = [];

      for (const row of validRows) {
        const key = buildInvoiceDuplicateKey({
          numeroDocumento: row.numeroDocumento,
          rut: row.rut,
          terceroNombre: row.terceroNombre,
          fechaEmision: row.fechaEmision || inferReceivableEmissionDate(row),
          monto: row.monto,
        });
        if (seenKeys.has(key)) {
          duplicateRows += 1;
          continue;
        }
        seenKeys.add(key);
        openKeys.add(key);

        const client =
          (row.rut && clientByRut.get(normalizeRut(row.rut) || "")) ||
          clientByName.get(matchText(row.terceroNombre)) ||
          null;
        const emissionDate = row.fechaEmision || inferReceivableEmissionDate(row);
        const dueDate = inferReceivableDueDate(row);
        const payload = {
          empresa_id: selectedEmpresaId,
          tipo: "venta",
          tercero_id: client?.id || null,
          tercero_nombre: row.terceroNombre,
          rut: normalizeRut(row.rut),
          fecha_emision: emissionDate,
          fecha_vencimiento: dueDate,
          numero_documento: row.numeroDocumento,
          monto: row.monto,
          descripcion: row.descripcion || null,
          tipo_documento: row.tipoDocumento || null,
          estado: statusFromDueDate(dueDate),
          planned_cash_date: dueDate,
          cash_confidence_pct: confidenceFromDueDate(dueDate),
          treasury_priority: "high",
          treasury_category_id: salesCategory?.id ?? null,
        };

        const existing = existingInvoiceByKey.get(key);
        if (existing) {
          updates.push({
            id: existing.id,
            empresa_id: selectedEmpresaId,
            tercero_id: existing.tercero_id || payload.tercero_id,
            tercero_nombre: payload.tercero_nombre,
            rut: payload.rut,
            fecha_vencimiento: payload.fecha_vencimiento,
            planned_cash_date: payload.planned_cash_date,
            cash_confidence_pct: payload.cash_confidence_pct,
            treasury_priority: "high",
            estado: payload.estado,
            tipo_documento: existing.tipo_documento || payload.tipo_documento,
          });
        } else {
          inserts.push(payload);
        }
      }

      for (const chunk of chunkArray(updates, IMPORT_CHUNK_SIZE)) {
        const { error: updateError } = await supabase.from("facturas").upsert(chunk, { onConflict: "id" });
        if (!updateError) {
          updatedRows += chunk.length;
          continue;
        }

        for (const item of chunk) {
          const { id, empresa_id, ...payload } = item;
          const { error: singleUpdateError } = await supabase
            .from("facturas")
            .update(payload)
            .eq("id", String(id))
            .eq("empresa_id", String(empresa_id));
          if (singleUpdateError) {
            throw new Error(`No se pudo actualizar la factura pendiente ${String(payload.numero_documento || payload.tercero_nombre || id)}: ${singleUpdateError.message}`);
          }
          updatedRows += 1;
        }
      }

      for (const chunk of chunkArray(inserts, IMPORT_CHUNK_SIZE)) {
        const { error: insertError } = await supabase.from("facturas").insert(chunk);
        if (!insertError) {
          insertedRows += chunk.length;
          continue;
        }

        for (const item of chunk) {
          const { error: singleInsertError } = await supabase.from("facturas").insert(item);
          if (singleInsertError) {
            throw new Error(`No se pudo insertar la factura pendiente ${String(item.numero_documento || item.tercero_nombre || "sin folio")}: ${singleInsertError.message}`);
          }
          insertedRows += 1;
        }
      }

      const paidInvoiceIds: string[] = [];
      for (const invoice of invoices || []) {
        const key = buildInvoiceDuplicateKey({
          numeroDocumento: invoice.numero_documento,
          rut: invoice.rut,
          terceroNombre: invoice.tercero_nombre || "",
          fechaEmision: invoice.fecha_emision,
          monto: Number(invoice.monto),
        });
        if (openKeys.has(key) || invoice.estado === "archivada") continue;
        paidInvoiceIds.push(invoice.id);
      }

      let paidRows = 0;
      for (const chunk of chunkArray(paidInvoiceIds, IMPORT_CHUNK_SIZE)) {
        const { error: paidError } = await supabase
          .from("facturas")
          .update({
            estado: "pagada",
            planned_cash_date: null,
            promised_payment_date: null,
            cash_confidence_pct: 100,
          })
          .eq("empresa_id", selectedEmpresaId)
          .in("id", chunk);
        if (paidError) {
          throw new Error(`No se pudo cerrar como pagado un bloque de facturas ausentes del archivo: ${paidError.message}`);
        }
        paidRows += chunk.length;
      }

      const summaryPayload = {
        filename: file.name,
        totalRows: rawObjects.length,
        validRows: validRows.length,
        insertedRows,
        updatedRows,
        paidRows,
        duplicateRows,
        rejectedRows,
        omittedRows,
        createdClients,
      };

      const { error: runError } = await supabase.from("invoice_import_runs").insert({
        empresa_id: selectedEmpresaId,
        source_kind: "receivables",
        original_filename: summaryPayload.filename,
        imported_by: user.id,
        total_rows: summaryPayload.totalRows,
        inserted_rows: summaryPayload.insertedRows,
        updated_rows: summaryPayload.updatedRows,
        duplicate_rows: summaryPayload.duplicateRows,
        rejected_rows: summaryPayload.rejectedRows,
        notes: `Importación cartera completa desde Cobranzas. Marcadas como pagadas fuera del archivo: ${summaryPayload.paidRows}.`,
      });
      if (runError) throw runError;

      setImportSummary(summaryPayload);
      await refresh();
      if (scopeFilter === "all") {
        setScopeFilter("open");
      }
    } catch (err: any) {
      console.error("Error importing receivables into collections:", err);
      alert(err.message || "No se pudo importar el archivo de cobranzas pendientes.");
    } finally {
      setImportingReceivables(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const visibleInvoices = scopeFilter === "all" ? allInvoices : pipeline;

  const filteredPipeline = useMemo(() => {
    const normalized = searchTerm.toLowerCase().trim();
    if (!normalized) return visibleInvoices;
    return visibleInvoices.filter(
      (item) =>
        item.terceroNombre.toLowerCase().includes(normalized) ||
        item.numeroDocumento.toLowerCase().includes(normalized) ||
        item.suggestedNextAction.toLowerCase().includes(normalized) ||
        (item.estado || "").toLowerCase().includes(normalized)
    );
  }, [visibleInvoices, searchTerm]);

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
        <div className="flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:justify-end">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar cliente, documento o accion..."
              className="pl-10"
            />
          </div>
          <Select value={scopeFilter} onValueChange={(value) => setScopeFilter(value as "open" | "all")}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filtrar facturas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Solo por cobrar</SelectItem>
              <SelectItem value="all">Ver todas</SelectItem>
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImportReceivables}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canEdit || importingReceivables}
          >
            {importingReceivables ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importar pendientes
          </Button>
        </div>
      </div>

      {importSummary && (
        <Card className="border-emerald-200">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-emerald-700">Importación completada: {importSummary.filename}</div>
            <div className="mt-1 text-muted-foreground">
              {importSummary.insertedRows} insertadas, {importSummary.updatedRows} actualizadas, {importSummary.paidRows} marcadas como pagadas, {importSummary.duplicateRows} duplicadas, {importSummary.omittedRows} omitidas por subtotal, {importSummary.rejectedRows} rechazadas y {importSummary.createdClients} clientes creados.
            </div>
          </CardContent>
        </Card>
      )}

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar el pipeline, pero no registrar gestiones.
          </CardContent>
        </Card>
      )}

      {(error || allInvoicesError) && (
        <Card className="border-red-200">
          <CardContent className="pt-6 text-sm text-red-700">{error || allInvoicesError}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Saldo vencido / abierto"
          value={formatTreasuryCurrency(totals.total, policy.monedaBase)}
          description={`${filteredPipeline.length} factura(s) ${scopeFilter === "all" ? "en total" : "en seguimiento"}`}
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
            {scopeFilter === "all"
              ? "Vista completa de facturas de venta. Por defecto este modulo muestra solo documentos por cobrar."
              : "La ultima promesa actualiza el forecast y los eventos quedan trazados por responsable."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Estado</th>
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
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={
                        invoice.estado === "pagada"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : invoice.estado === "morosa"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      {invoice.estado === "pagada" ? "Pagada" : invoice.estado === "morosa" ? "Morosa" : "Pendiente"}
                    </Badge>
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
                      <Button size="sm" onClick={() => handleOpenDialog(invoice)} className="gap-2" disabled={!canEdit || invoice.estado === "pagada"}>
                        <Plus className="h-4 w-4" />
                        Gestion
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredPipeline.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">
                    {loading || loadingAllInvoices ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "No hay facturas para el filtro actual."}
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
