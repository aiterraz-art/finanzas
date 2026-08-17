import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileUp, Loader2, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  buildInvoiceDuplicateKey,
  buildInvoiceObjectsFromWorksheet,
  detectIssuedInvoiceWorksheetFormat,
  detectReceivablesWorksheetFormat,
  extractIssuedInvoicePdfRow,
  inferReceivableEmissionDate,
  normalizeIssuedInvoiceImportRow,
  normalizeReceivableInvoiceImportRow,
  type IssuedInvoiceImportRow,
  type ReceivableInvoiceImportRow,
} from "@/lib/invoice-import";
import { cn } from "@/lib/utils";
import { canEditTreasury, formatTreasuryCurrency, formatTreasuryDate, normalizeRut, normalizeText } from "@/lib/treasury";

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

type PendingIssuedPdfItem = {
  file: File;
  parsedRow: IssuedInvoiceImportRow | null;
  error: string | null;
};

const isPdfInvoiceFile = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

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
  const [pendingIssuedPdfItems, setPendingIssuedPdfItems] = useState<PendingIssuedPdfItem[]>([]);
  const fileRefs = {
    issued: useRef<HTMLInputElement>(null),
    receivables: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    setSummary({ issued: null, receivables: null });
    setPendingIssuedPdfItems([]);
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

  const upsertIssuedRows = async (
    parsedRows: Array<IssuedInvoiceImportRow | null>,
    metadata: { filename: string; notes: string | null }
  ) => {
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
      filename: metadata.filename,
      totalRows: parsedRows.length,
      validRows: validRows.length,
      insertedRows,
      updatedRows,
      duplicateRows,
      rejectedRows,
      createdClients,
      notes: metadata.notes,
    };

    await registerImportRun("issued", importSummary);
    setSummary((current) => ({ ...current, issued: importSummary }));
  };

  const processIssuedSpreadsheetImport = async (file: File) => {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
    const detection = detectIssuedInvoiceWorksheetFormat(rows);
    if (detection.kind !== "issued" || detection.headerRowIndex === null) {
      throw new Error(detection.reason || "No se detectó un layout compatible de facturas emitidas.");
    }

    const rawObjects = buildInvoiceObjectsFromWorksheet(rows, detection.headerRowIndex);
    const parsedRows = rawObjects.map((row) => normalizeIssuedInvoiceImportRow(row));
    await upsertIssuedRows(parsedRows, {
      filename: file.name,
      notes: "Importación de emitidas 6 meses",
    });
  };

  const stageIssuedPdfFiles = async (files: File[]) => {
    const staged = await Promise.all(
      files.map(async (file) => {
        try {
          const parsedRow = await extractIssuedInvoicePdfRow(file);
          return {
            file,
            parsedRow,
            error: parsedRow ? null : "No se pudo reconocer la estructura de la factura.",
          } satisfies PendingIssuedPdfItem;
        } catch (error: any) {
          return {
            file,
            parsedRow: null,
            error: error?.message || "No se pudo leer el PDF.",
          } satisfies PendingIssuedPdfItem;
        }
      })
    );

    setPendingIssuedPdfItems(staged);
    setSummary((current) => ({ ...current, issued: null }));
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

  const importFiles = async (mode: ImportMode, files: File[]) => {
    if (files.length === 0 || !selectedEmpresaId || !user || !canEdit) return;

    setLoading(true);
    try {
      if (mode === "issued") {
        const pdfFiles = files.filter(isPdfInvoiceFile);
        if (pdfFiles.length === files.length) {
          await stageIssuedPdfFiles(pdfFiles);
        } else if (files.length === 1) {
          setPendingIssuedPdfItems([]);
          await processIssuedSpreadsheetImport(files[0]);
        } else {
          throw new Error("Para emitidas puedes subir un Excel/CSV o varios PDF, pero no mezclar formatos.");
        }
      } else {
        await processReceivablesImport(files[0]);
      }
    } catch (error: any) {
      console.error("Error importing invoices:", error);
      alert(error.message || "No se pudo importar el archivo.");
    } finally {
      setLoading(false);
      if (fileRefs[mode].current) fileRefs[mode].current.value = "";
    }
  };

  const handleFileImport = async (mode: ImportMode, event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await importFiles(mode, files);
  };

  const handleAcceptIssuedPdfImport = async () => {
    if (pendingIssuedPdfItems.length === 0) return;
    setLoading(true);
    try {
      const parsedRows = pendingIssuedPdfItems.map((item) => item.parsedRow);
      await upsertIssuedRows(parsedRows, {
        filename:
          pendingIssuedPdfItems.length === 1
            ? pendingIssuedPdfItems[0].file.name
            : `${pendingIssuedPdfItems.length} archivos PDF`,
        notes: "Importación de facturas emitidas PDF",
      });
      setPendingIssuedPdfItems([]);
    } catch (error: any) {
      console.error("Error confirming invoice import:", error);
      alert(error.message || "No se pudieron cargar las facturas al sistema.");
    } finally {
      setLoading(false);
    }
  };

  const pendingIssuedPdfValidRows = pendingIssuedPdfItems.filter((item) => item.parsedRow);
  const pendingIssuedPdfErrors = pendingIssuedPdfItems.filter((item) => item.error);

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
            description="Base histórica de ventas. Acepta Excel/CSV y también PDFs de Factura Electrónica generados por el laboratorio. Si el cliente no existe, se crea. Si la factura ya existe, se actualiza sin duplicar."
            canEdit={canEdit}
            loading={loading}
            inputRef={fileRefs.issued}
            onChange={(event) => void handleFileImport("issued", event)}
            onFilesSelected={(files) => void importFiles("issued", files)}
            pendingIssuedPdfItems={pendingIssuedPdfItems}
            pendingIssuedPdfValidRows={pendingIssuedPdfValidRows.length}
            pendingIssuedPdfErrors={pendingIssuedPdfErrors}
            onAcceptPendingPdfImport={() => void handleAcceptIssuedPdfImport()}
            onClearPendingPdfImport={() => setPendingIssuedPdfItems([])}
            summary={summary.issued}
            accept=".xlsx,.xls,.csv,.pdf"
            multiple
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
            onFilesSelected={(files) => void importFiles("receivables", files)}
            pendingIssuedPdfItems={[]}
            pendingIssuedPdfValidRows={0}
            pendingIssuedPdfErrors={[]}
            onAcceptPendingPdfImport={() => undefined}
            onClearPendingPdfImport={() => undefined}
            summary={summary.receivables}
            accept=".xlsx,.xls,.csv"
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
  onFilesSelected,
  pendingIssuedPdfItems,
  pendingIssuedPdfValidRows,
  pendingIssuedPdfErrors,
  onAcceptPendingPdfImport,
  onClearPendingPdfImport,
  summary,
  accept,
  multiple = false,
}: {
  title: string;
  description: string;
  canEdit: boolean;
  loading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFilesSelected: (files: File[]) => void;
  pendingIssuedPdfItems: PendingIssuedPdfItem[];
  pendingIssuedPdfValidRows: number;
  pendingIssuedPdfErrors: PendingIssuedPdfItem[];
  onAcceptPendingPdfImport: () => void;
  onClearPendingPdfImport: () => void;
  summary: ImportSummary | null;
  accept: string;
  multiple?: boolean;
}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const supportsPdfDrop = accept.includes(".pdf");

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canEdit || loading) return;
    event.preventDefault();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!canEdit || loading) return;
    event.preventDefault();
    setIsDragActive(false);
    onFilesSelected(Array.from(event.dataTransfer.files || []));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={onChange} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => inputRef.current?.click()} disabled={!canEdit || loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            {multiple ? "Seleccionar archivo(s)" : "Seleccionar archivo"}
          </Button>
          {!canEdit && <div className="text-sm text-amber-700">Tu rol es solo lectura.</div>}
        </div>

        <div
          className={cn(
            "rounded-xl border border-dashed p-6 text-center transition-colors",
            canEdit ? "cursor-pointer" : "opacity-70",
            isDragActive
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground"
          )}
          onClick={() => {
            if (!canEdit || loading) return;
            inputRef.current?.click();
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={canEdit ? 0 : -1}
          onKeyDown={(event) => {
            if (!canEdit || loading) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <div className="font-medium">
            {supportsPdfDrop ? "Arrastra PDFs aquí" : "Arrastra archivos aquí"}
          </div>
          <div className="mt-1 text-sm">
            {supportsPdfDrop
              ? "Tambien puedes soltar uno o varios PDFs de facturas emitidas. Primero veras un resumen antes de cargarlas."
              : "Suelta el archivo en esta zona para importarlo sin usar el selector manual."}
          </div>
        </div>

        {supportsPdfDrop && pendingIssuedPdfItems.length > 0 && (
          <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="font-medium text-amber-900">Facturas listas para revisar</div>
                <div className="text-sm text-muted-foreground">
                  {pendingIssuedPdfValidRows} factura(s) validas de {pendingIssuedPdfItems.length}. Solo se cargaran cuando confirmes abajo.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={onClearPendingPdfImport} disabled={loading}>
                  Limpiar adjuntos
                </Button>
                <Button onClick={onAcceptPendingPdfImport} disabled={loading || pendingIssuedPdfValidRows === 0}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Aceptar y cargar
                </Button>
              </div>
            </div>

            <div className="rounded-lg border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Archivo</TableHead>
                    <TableHead>N° factura</TableHead>
                    <TableHead>Razon social</TableHead>
                    <TableHead>Fecha emision</TableHead>
                    <TableHead className="text-right">Monto neto</TableHead>
                    <TableHead className="text-right">Monto con IVA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingIssuedPdfItems.map((item) => (
                    <TableRow key={item.file.name}>
                      <TableCell className="font-medium">{item.file.name}</TableCell>
                      <TableCell>{item.parsedRow?.numeroDocumento || "—"}</TableCell>
                      <TableCell>{item.parsedRow?.terceroNombre || "No reconocida"}</TableCell>
                      <TableCell>
                        {item.parsedRow?.fechaEmision ? formatTreasuryDate(item.parsedRow.fechaEmision) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.parsedRow?.montoNeto != null ? formatTreasuryCurrency(item.parsedRow.montoNeto) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {item.parsedRow?.monto != null ? formatTreasuryCurrency(item.parsedRow.monto) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {pendingIssuedPdfErrors.length > 0 && (
              <Alert>
                <AlertTitle>Algunos PDFs no se pudieron preparar</AlertTitle>
                <AlertDescription>
                  {pendingIssuedPdfErrors.map((item) => `${item.file.name}: ${item.error}`).join(" | ")}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

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
