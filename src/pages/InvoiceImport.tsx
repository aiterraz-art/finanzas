import { type ChangeEvent, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileUp, Loader2, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  buildInvoiceDuplicateKey,
  buildInvoiceObjectsFromWorksheet,
  detectIssuedInvoiceWorksheetFormat,
  detectReceivablesWorksheetFormat,
  inferReceivableEmissionDate,
  normalizeIssuedInvoiceImportRow,
  normalizeReceivableInvoiceImportRow,
  type IssuedInvoiceImportRow,
  type ReceivableInvoiceImportRow,
} from "@/lib/invoice-import";
import { canEditTreasury, normalizeRut, normalizeText } from "@/lib/treasury";

type ImportMode = "issued" | "receivables";

type ImportSummary = {
  filename: string;
  totalRows: number;
  validRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  createdClients: number;
  notes: string | null;
};

type ClientRow = {
  id: string;
  razon_social: string;
  rut: string | null;
};

type InvoiceRow = {
  id: string;
  numero_documento: string | null;
  rut: string | null;
  tercero_nombre: string | null;
  tercero_id: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  monto: number;
  descripcion: string | null;
  tipo_documento: string | null;
  nombre_documento: string | null;
  vendedor_asignado: string | null;
  estado: string | null;
  archivo_url: string | null;
};

const today = new Date().toISOString().split("T")[0];

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

const inferReceivableDueDate = (row: ReceivableInvoiceImportRow) => {
  if (row.fechaVencimiento) return row.fechaVencimiento;
  if (row.fechaEmision) {
    const next = new Date(`${row.fechaEmision}T12:00:00`);
    next.setDate(next.getDate() + 30);
    return next.toISOString().split("T")[0];
  }
  return today;
};

const matchText = (value: unknown) => normalizeText(value).toLowerCase();

export default function InvoiceImport() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const [activeTab, setActiveTab] = useState<ImportMode>("issued");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Record<ImportMode, ImportSummary | null>>({
    issued: null,
    receivables: null,
  });
  const fileRefs = {
    issued: useRef<HTMLInputElement>(null),
    receivables: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    setSummary({ issued: null, receivables: null });
  }, [selectedEmpresaId]);

  const fetchSupportData = async () => {
    if (!selectedEmpresaId) {
      return {
        clients: [] as ClientRow[],
        invoices: [] as InvoiceRow[],
        salesCategoryId: null as string | null,
      };
    }

    const [{ data: clients, error: clientsError }, { data: invoices, error: invoicesError }, { data: categoryRows, error: categoryError }] =
      await Promise.all([
        supabase
          .from("terceros")
          .select("id, razon_social, rut")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["cliente", "ambos"])
          .is("archived_at", null),
        supabase
          .from("facturas")
          .select("id, numero_documento, rut, tercero_nombre, tercero_id, fecha_emision, fecha_vencimiento, monto, descripcion, tipo_documento, nombre_documento, vendedor_asignado, estado, archivo_url")
          .eq("empresa_id", selectedEmpresaId)
          .eq("tipo", "venta")
          .is("archived_at", null),
        supabase
          .from("treasury_categories")
          .select("id")
          .eq("empresa_id", selectedEmpresaId)
          .eq("code", "sales")
          .limit(1)
          .maybeSingle(),
      ]);

    if (clientsError) throw clientsError;
    if (invoicesError) throw invoicesError;
    if (categoryError) throw categoryError;

    return {
      clients: (clients || []) as ClientRow[],
      invoices: (invoices || []) as InvoiceRow[],
      salesCategoryId: categoryRows?.id ?? null,
    };
  };

  const registerImportRun = async (mode: ImportMode, importSummary: ImportSummary) => {
    if (!selectedEmpresaId || !user) return;
    const { error } = await supabase.from("invoice_import_runs").insert({
      empresa_id: selectedEmpresaId,
      source_kind: mode,
      original_filename: importSummary.filename,
      imported_by: user.id,
      total_rows: importSummary.totalRows,
      inserted_rows: importSummary.insertedRows,
      updated_rows: importSummary.updatedRows,
      duplicate_rows: importSummary.duplicateRows,
      rejected_rows: importSummary.rejectedRows,
      notes: importSummary.notes,
    });
    if (error) throw error;
  };

  const createMissingClients = async (
    rows: Array<IssuedInvoiceImportRow | ReceivableInvoiceImportRow>,
    clients: ClientRow[]
  ) => {
    const clientByRut = new Map<string, ClientRow>();
    const clientByName = new Map<string, ClientRow>();
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

    if (missing.size === 0) return { count: 0, clients };

    for (const client of missing.values()) {
      const { error } = await supabase.from("terceros").insert({
        empresa_id: selectedEmpresaId,
        rut: client.rut,
        razon_social: client.razon_social,
        tipo: "cliente",
        estado: "activo",
      });
      if (error) {
        throw new Error(`No se pudo crear el cliente ${client.razon_social}${client.rut ? ` (${client.rut})` : ""}: ${error.message}`);
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
      clients: (refreshedClients || []) as ClientRow[],
    };
  };

  const processIssuedImport = async (file: File) => {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
    const detection = detectIssuedInvoiceWorksheetFormat(rows);
    if (detection.kind !== "issued" || detection.headerRowIndex === null) {
      throw new Error(detection.reason || "No se detectó un layout compatible de facturas emitidas.");
    }

    const rawObjects = buildInvoiceObjectsFromWorksheet(rows, detection.headerRowIndex);
    const parsedRows = rawObjects.map((row) => normalizeIssuedInvoiceImportRow(row));
    const validRows = parsedRows.filter(Boolean) as IssuedInvoiceImportRow[];
    const rejectedRows = parsedRows.length - validRows.length;

    const support = await fetchSupportData();
    const { count: createdClients, clients } = await createMissingClients(validRows, support.clients);
    const clientByRut = new Map<string, ClientRow>();
    const clientByName = new Map<string, ClientRow>();
    for (const client of clients) {
      if (client.rut) clientByRut.set(normalizeRut(client.rut) || "", client);
      clientByName.set(matchText(client.razon_social), client);
    }

    const existingInvoiceByKey = new Map<string, InvoiceRow>();
    for (const invoice of support.invoices) {
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
    let duplicateRows = 0;
    let insertedRows = 0;
    let updatedRows = 0;

    for (const row of validRows) {
      const key = buildInvoiceDuplicateKey(row);
      if (seenKeys.has(key)) {
        duplicateRows += 1;
        continue;
      }
      seenKeys.add(key);

      const client =
        (row.rut && clientByRut.get(normalizeRut(row.rut) || "")) ||
        clientByName.get(matchText(row.terceroNombre)) ||
        null;
      const dueDate = row.fechaVencimiento || row.fechaEmision;
      const basePayload = {
        empresa_id: selectedEmpresaId,
        tipo: "venta",
        tercero_id: client?.id || null,
        tercero_nombre: row.terceroNombre,
        rut: row.rut,
        fecha_emision: row.fechaEmision,
        fecha_vencimiento: dueDate,
        numero_documento: row.numeroDocumento,
        monto: row.monto,
        descripcion: row.descripcion,
        tipo_documento: row.tipoDocumento,
        nombre_documento: row.nombreDocumento,
        vendedor_asignado: row.vendedorAsignado,
        estado: statusFromDueDate(dueDate),
        planned_cash_date: dueDate,
        cash_confidence_pct: confidenceFromDueDate(dueDate),
        treasury_priority: "high",
        treasury_category_id: support.salesCategoryId,
      };

      const existing = existingInvoiceByKey.get(key);
      if (existing) {
        const { error } = await supabase
          .from("facturas")
          .update({
            tercero_id: existing.tercero_id || basePayload.tercero_id,
            tercero_nombre: basePayload.tercero_nombre,
            rut: basePayload.rut,
            fecha_emision: existing.fecha_emision || basePayload.fecha_emision,
            fecha_vencimiento: basePayload.fecha_vencimiento,
            monto: basePayload.monto,
            descripcion: existing.descripcion || basePayload.descripcion,
            tipo_documento: existing.tipo_documento || basePayload.tipo_documento,
            nombre_documento: existing.nombre_documento || basePayload.nombre_documento,
            vendedor_asignado: existing.vendedor_asignado || basePayload.vendedor_asignado,
            estado: existing.estado === "pagada" ? existing.estado : basePayload.estado,
            planned_cash_date: basePayload.planned_cash_date,
            cash_confidence_pct: basePayload.cash_confidence_pct,
            treasury_priority: "high",
            treasury_category_id: support.salesCategoryId,
          })
          .eq("id", existing.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw new Error(`No se pudo actualizar la factura ${row.numeroDocumento}: ${error.message}`);
        updatedRows += 1;
      } else {
        const { error } = await supabase.from("facturas").insert(basePayload);
        if (error) throw new Error(`No se pudo insertar la factura ${row.numeroDocumento}: ${error.message}`);
        insertedRows += 1;
      }
    }

    const importSummary: ImportSummary = {
      filename: file.name,
      totalRows: parsedRows.length,
      validRows: validRows.length,
      insertedRows,
      updatedRows,
      duplicateRows,
      rejectedRows,
      createdClients,
      notes: "Importación de emitidas 6 meses",
    };

    await registerImportRun("issued", importSummary);
    setSummary((current) => ({ ...current, issued: importSummary }));
  };

  const processReceivablesImport = async (file: File) => {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
    const detection = detectReceivablesWorksheetFormat(rows);
    if (detection.kind !== "receivables" || detection.headerRowIndex === null) {
      throw new Error(detection.reason || "No se detectó un layout compatible de facturas pendientes.");
    }

    const rawObjects = buildInvoiceObjectsFromWorksheet(rows, detection.headerRowIndex);
    const parsedRows = rawObjects.map((row) => normalizeReceivableInvoiceImportRow(row));
    const validRows = parsedRows.filter(Boolean) as ReceivableInvoiceImportRow[];
    const rejectedRows = parsedRows.length - validRows.length;

    const support = await fetchSupportData();
    const { count: createdClients, clients } = await createMissingClients(validRows, support.clients);
    const clientByRut = new Map<string, ClientRow>();
    const clientByName = new Map<string, ClientRow>();
    for (const client of clients) {
      if (client.rut) clientByRut.set(normalizeRut(client.rut) || "", client);
      clientByName.set(matchText(client.razon_social), client);
    }

    const existingInvoiceByKey = new Map<string, InvoiceRow>();
    for (const invoice of support.invoices) {
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
    let duplicateRows = 0;
    let insertedRows = 0;
    let updatedRows = 0;

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
        rut: row.rut,
        fecha_emision: emissionDate,
        fecha_vencimiento: dueDate,
        numero_documento: row.numeroDocumento,
        monto: row.monto,
        descripcion: row.descripcion || null,
        estado: statusFromDueDate(dueDate),
        planned_cash_date: dueDate,
        cash_confidence_pct: confidenceFromDueDate(dueDate),
        treasury_priority: "high",
        treasury_category_id: support.salesCategoryId,
      };

      const existing = existingInvoiceByKey.get(key);
      if (existing) {
        const { error } = await supabase
          .from("facturas")
          .update({
            tercero_id: existing.tercero_id || payload.tercero_id,
            tercero_nombre: payload.tercero_nombre,
            rut: payload.rut,
            fecha_vencimiento: payload.fecha_vencimiento,
            planned_cash_date: payload.planned_cash_date,
            cash_confidence_pct: payload.cash_confidence_pct,
            treasury_priority: "high",
            estado: payload.estado,
          })
          .eq("id", existing.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw new Error(`No se pudo actualizar la factura pendiente ${row.numeroDocumento || row.terceroNombre}: ${error.message}`);
        updatedRows += 1;
      } else {
        const { error } = await supabase.from("facturas").insert(payload);
        if (error) throw new Error(`No se pudo insertar la factura pendiente ${row.numeroDocumento || row.terceroNombre}: ${error.message}`);
        insertedRows += 1;
      }
    }

    const importSummary: ImportSummary = {
      filename: file.name,
      totalRows: parsedRows.length,
      validRows: validRows.length,
      insertedRows,
      updatedRows,
      duplicateRows,
      rejectedRows,
      createdClients,
      notes: "Importación de pendientes de cobro",
    };

    await registerImportRun("receivables", importSummary);
    setSummary((current) => ({ ...current, receivables: importSummary }));
  };

  const handleFileImport = async (mode: ImportMode, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedEmpresaId || !user || !canEdit) return;

    setLoading(true);
    try {
      if (mode === "issued") {
        await processIssuedImport(file);
      } else {
        await processReceivablesImport(file);
      }
    } catch (error: any) {
      console.error("Error importing invoices:", error);
      alert(error.message || "No se pudo importar el archivo.");
    } finally {
      setLoading(false);
      if (fileRefs[mode].current) fileRefs[mode].current.value = "";
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Importar facturas</CardTitle>
            <CardDescription>Selecciona una empresa para cargar la base de facturas.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Importar Facturas</h1>
          <p className="mt-1 text-muted-foreground">
            Carga la base histórica emitida y luego la cartera pendiente para dejar cobranzas y banco alineados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/facturas">Ver Facturas</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/collections">Ver Cobranzas</Link>
          </Button>
          <Button variant="outline" onClick={() => setSummary({ issued: null, receivables: null })}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Limpiar resumen
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ImportMode)}>
        <TabsList>
          <TabsTrigger value="issued">Emitidas</TabsTrigger>
          <TabsTrigger value="receivables">Pendientes</TabsTrigger>
        </TabsList>

        <TabsContent value="issued">
          <ImportCard
            title="Facturas emitidas últimos 6 meses"
            description="Base histórica de ventas. Si el cliente no existe, se crea. Si la factura ya existe, se actualiza sin duplicar."
            canEdit={canEdit}
            loading={loading}
            inputRef={fileRefs.issued}
            onChange={(event) => void handleFileImport("issued", event)}
            summary={summary.issued}
          />
        </TabsContent>

        <TabsContent value="receivables">
          <ImportCard
            title="Facturas pendientes de cobro"
            description="Fuente de verdad operativa para dejar la cartera viva. Si una factura no existe todavía, se crea igual."
            canEdit={canEdit}
            loading={loading}
            inputRef={fileRefs.receivables}
            onChange={(event) => void handleFileImport("receivables", event)}
            summary={summary.receivables}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ImportCard({
  title,
  description,
  canEdit,
  loading,
  inputRef,
  onChange,
  summary,
}: {
  title: string;
  description: string;
  canEdit: boolean;
  loading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  summary: ImportSummary | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onChange} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => inputRef.current?.click()} disabled={!canEdit || loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            Seleccionar archivo
          </Button>
          {!canEdit && <div className="text-sm text-amber-700">Tu rol es solo lectura.</div>}
        </div>

        {summary && (
          <div className="rounded-xl border border-emerald-200 p-4 text-sm">
            <div className="font-medium text-emerald-700">Importación completada: {summary.filename}</div>
            <div className="mt-1 text-muted-foreground">
              {summary.validRows} válidas de {summary.totalRows}. {summary.insertedRows} insertadas, {summary.updatedRows} actualizadas, {summary.duplicateRows} duplicadas, {summary.rejectedRows} rechazadas, {summary.createdClients} clientes creados.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
