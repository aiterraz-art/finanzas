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
  normalizeSiiPurchaseInvoiceImportRow,
  type IssuedInvoiceImportRow,
  type PurchaseInvoiceImportRow,
  type ReceivableInvoiceImportRow,
} from "@/lib/invoice-import";
import { cn } from "@/lib/utils";
import { canEditTreasury, formatTreasuryCurrency, formatTreasuryDate, normalizeRut, normalizeText } from "@/lib/treasury";

type ImportMode = "issued" | "receivables" | "purchases";

type ImportSummary = {
  filename: string;
  totalRows: number;
  validRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  createdClients: number;
  createdCounterpartyLabel?: string;
  notes: string | null;
};

type ClientRow = {
  id: string;
  razon_social: string;
  rut: string | null;
};

type SupplierRow = ClientRow & {
  tipo: "cliente" | "proveedor" | "ambos";
};

type InvoiceRow = {
  id: string;
  tipo: "venta" | "compra" | "nota_credito";
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
  monto_exento?: number | null;
  monto_neto?: number | null;
  monto_iva?: number | null;
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
const normalizeDocumentNumber = (value: unknown) => matchText(value).replace(/\s+/g, "");

const parseDelimitedRows = (text: string, delimiter: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const normalizedText = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index];
    if (character === '"') {
      if (quoted && normalizedText[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && normalizedText[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
};

const readSpreadsheetRows = async (file: File) => {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const delimiter = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ";" : ",";
    return parseDelimitedRows(text, delimiter) as unknown[][];
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
};

export default function InvoiceImport() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const [activeTab, setActiveTab] = useState<ImportMode>("issued");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Record<ImportMode, ImportSummary | null>>({
    issued: null,
    receivables: null,
    purchases: null,
  });
  const [pendingIssuedPdfItems, setPendingIssuedPdfItems] = useState<PendingIssuedPdfItem[]>([]);
  const fileRefs = {
    issued: useRef<HTMLInputElement>(null),
    receivables: useRef<HTMLInputElement>(null),
    purchases: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    setSummary({ issued: null, receivables: null, purchases: null });
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
          .select("id, tipo, numero_documento, rut, tercero_nombre, tercero_id, fecha_emision, fecha_vencimiento, monto, monto_exento, monto_neto, monto_iva, descripcion, tipo_documento, nombre_documento, vendedor_asignado, estado, archivo_url")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["venta", "nota_credito"])
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
        tipo: invoice.tipo,
        tipoDocumento: invoice.tipo_documento,
      });
      if (!existingInvoiceByKey.has(key)) existingInvoiceByKey.set(key, invoice);
    }

    const findReferencedInvoice = (row: IssuedInvoiceImportRow, client: ClientRow | null) => {
      if (row.tipo !== "nota_credito" || !row.documentoReferencia) return null;
      const matches = Array.from(existingInvoiceByKey.values()).filter(
        (invoice) =>
          invoice.tipo === "venta" &&
          normalizeDocumentNumber(invoice.numero_documento) === normalizeDocumentNumber(row.documentoReferencia)
      );
      return (
        matches.find((invoice) => client?.id && invoice.tercero_id === client.id) ||
        matches.find((invoice) => row.rut && normalizeRut(invoice.rut) === normalizeRut(row.rut)) ||
        matches.find((invoice) => matchText(invoice.tercero_nombre) === matchText(row.terceroNombre)) ||
        matches[0] ||
        null
      );
    };

    const seenKeys = new Set<string>();
    let duplicateRows = 0;
    let insertedRows = 0;
    let updatedRows = 0;

    const orderedRows = [...validRows].sort((left, right) => Number(left.tipo === "nota_credito") - Number(right.tipo === "nota_credito"));

    for (const row of orderedRows) {
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
      const descriptionWithReference =
        row.tipo === "nota_credito" && row.documentoReferencia
          ? [row.descripcion, `Factura asociada: ${row.documentoReferencia}`].filter(Boolean).join(" | ")
          : row.descripcion;
      const referencedInvoice = findReferencedInvoice(row, client);
      const basePayload = {
        empresa_id: selectedEmpresaId,
        tipo: row.tipo,
        tercero_id: client?.id || null,
        tercero_nombre: row.terceroNombre,
        rut: row.rut,
        fecha_emision: row.fechaEmision,
        fecha_vencimiento: dueDate,
        numero_documento: row.numeroDocumento,
        monto: row.monto,
        monto_neto: row.montoNeto ?? null,
        monto_iva: row.montoIva ?? null,
        monto_exento: row.montoExento ?? (row.montoNeto === 0 ? row.monto : null),
        origen_importacion: "sii_ventas",
        ...(referencedInvoice ? { factura_referencia_id: referencedInvoice.id } : {}),
        descripcion: descriptionWithReference,
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
            descripcion: descriptionWithReference || existing.descripcion,
            ...(row.montoNeto != null ? { monto_neto: row.montoNeto } : {}),
            ...(row.montoIva != null ? { monto_iva: row.montoIva } : {}),
            ...(row.montoExento != null || row.montoNeto === 0 ? { monto_exento: row.montoExento ?? row.monto } : {}),
            ...(row.montoNeto != null || row.montoIva != null ? { origen_importacion: "sii_ventas" } : {}),
            ...(referencedInvoice ? { factura_referencia_id: referencedInvoice.id } : {}),
          })
          .eq("id", existing.id)
          .eq("empresa_id", selectedEmpresaId);
        if (error) throw new Error(`No se pudo actualizar la factura ${row.numeroDocumento}: ${error.message}`);
        updatedRows += 1;
      } else {
        const { data, error } = await supabase.from("facturas").insert(basePayload).select().single();
        if (error) throw new Error(`No se pudo insertar la factura ${row.numeroDocumento}: ${error.message}`);
        existingInvoiceByKey.set(key, data as InvoiceRow);
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
    const rows = await readSpreadsheetRows(file);
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

  const fetchPurchaseSupportData = async () => {
    const [{ data: terceros, error: tercerosError }, { data: invoices, error: invoicesError }, { data: category, error: categoryError }] =
      await Promise.all([
        supabase
          .from("terceros")
          .select("id, razon_social, rut, tipo")
          .eq("empresa_id", selectedEmpresaId)
          .eq("estado", "activo")
          .or("es_trabajador.is.null,es_trabajador.eq.false"),
        supabase
          .from("facturas")
          .select("id, tipo, numero_documento, rut, tercero_nombre, tercero_id, fecha_emision, monto, tipo_documento")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["compra", "nota_credito_compra"])
          .is("archived_at", null),
        supabase
          .from("treasury_categories")
          .select("id")
          .eq("empresa_id", selectedEmpresaId)
          .eq("code", "suppliers")
          .maybeSingle(),
      ]);

    if (tercerosError) throw tercerosError;
    if (invoicesError) throw invoicesError;
    if (categoryError) throw categoryError;

    return {
      terceros: (terceros || []) as SupplierRow[],
      invoices: (invoices || []) as InvoiceRow[],
      suppliersCategoryId: category?.id || null,
    };
  };

  const ensurePurchaseSuppliers = async (rows: PurchaseInvoiceImportRow[], terceros: SupplierRow[]) => {
    const byRut = new Map<string, SupplierRow>();
    const byName = new Map<string, SupplierRow>();
    for (const tercero of terceros) {
      if (tercero.rut) byRut.set(normalizeRut(tercero.rut) || "", tercero);
      byName.set(matchText(tercero.razon_social), tercero);
    }

    let createdCount = 0;
    for (const row of rows) {
      const existing =
        (row.rut && byRut.get(normalizeRut(row.rut) || "")) ||
        byName.get(matchText(row.terceroNombre));
      if (existing) {
        if (existing.tipo === "cliente") {
          const { error } = await supabase
            .from("terceros")
            .update({ tipo: "ambos" })
            .eq("id", existing.id)
            .eq("empresa_id", selectedEmpresaId);
          if (error) throw new Error(`No se pudo habilitar como proveedor a ${row.terceroNombre}: ${error.message}`);
          existing.tipo = "ambos";
        }
        continue;
      }

      const { data, error } = await supabase
        .from("terceros")
        .insert({
          empresa_id: selectedEmpresaId,
          rut: normalizeRut(row.rut),
          razon_social: row.terceroNombre,
          tipo: "proveedor",
          estado: "activo",
          es_trabajador: false,
        })
        .select("id, razon_social, rut, tipo")
        .single();
      if (error) throw new Error(`No se pudo crear el proveedor ${row.terceroNombre}: ${error.message}`);
      const supplier = data as SupplierRow;
      if (supplier.rut) byRut.set(normalizeRut(supplier.rut) || "", supplier);
      byName.set(matchText(supplier.razon_social), supplier);
      createdCount += 1;
    }

    return { createdCount, byRut, byName };
  };

  const processSiiPurchaseImport = async (file: File) => {
    const rows = await readSpreadsheetRows(file);
    const headers = (rows[0] || []).map((value) => String(value).toLowerCase());
    if (!headers.some((header) => header.includes("rut proveedor")) || !headers.some((header) => header.includes("monto iva recuperable"))) {
      throw new Error("El archivo no corresponde al Registro de Compras del SII.");
    }

    const parsedRows = buildInvoiceObjectsFromWorksheet(rows, 0).map((row) => normalizeSiiPurchaseInvoiceImportRow(row));
    const validRows = parsedRows.filter(Boolean) as PurchaseInvoiceImportRow[];
    const rejectedRows = parsedRows.length - validRows.length;
    const support = await fetchPurchaseSupportData();
    const { createdCount, byRut, byName } = await ensurePurchaseSuppliers(validRows, support.terceros);
    const existingByKey = new Map<string, InvoiceRow>();
    for (const invoice of support.invoices) {
      const key = [invoice.tipo, invoice.tercero_id || "", normalizeDocumentNumber(invoice.numero_documento)].join("|");
      existingByKey.set(key, invoice);
    }

    let insertedRows = 0;
    let updatedRows = 0;
    let duplicateRows = 0;
    const seenKeys = new Set<string>();
    for (const row of validRows) {
      const supplier =
        (row.rut && byRut.get(normalizeRut(row.rut) || "")) ||
        byName.get(matchText(row.terceroNombre));
      if (!supplier) throw new Error(`No se encontró el proveedor ${row.terceroNombre} después de crearlo.`);
      const key = [row.tipo, supplier.id, normalizeDocumentNumber(row.numeroDocumento)].join("|");
      if (seenKeys.has(key)) {
        duplicateRows += 1;
        continue;
      }
      seenKeys.add(key);

      const payload = {
        empresa_id: selectedEmpresaId,
        tipo: row.tipo,
        tercero_id: supplier.id,
        tercero_nombre: row.terceroNombre,
        rut: row.rut,
        fecha_emision: row.fechaEmision,
        fecha_vencimiento: row.fechaEmision,
        numero_documento: row.numeroDocumento,
        monto: row.monto,
        monto_neto: row.montoNeto,
        monto_iva: row.montoIva,
        monto_exento: row.montoExento,
        descripcion: [row.descripcion, row.documentoReferencia ? `Documento asociado: ${row.documentoReferencia}` : null].filter(Boolean).join(" | ") || null,
        tipo_documento: row.tipoDocumento,
        nombre_documento: row.nombreDocumento,
        estado: row.tipo === "compra" ? statusFromDueDate(row.fechaEmision) : "pagada",
        planned_cash_date: row.fechaEmision,
        treasury_priority: "normal",
        treasury_category_id: support.suppliersCategoryId,
        origen_importacion: "sii_compras",
      };
      const existing = existingByKey.get(key);
      if (existing) {
        duplicateRows += 1;
        continue;
      } else {
        const { error } = await supabase.from("facturas").insert(payload);
        if (error) throw new Error(`No se pudo insertar la compra ${row.numeroDocumento}: ${error.message}`);
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
      createdClients: createdCount,
      createdCounterpartyLabel: "proveedores",
      notes: "Registro de Compras del SII",
    };
    await registerImportRun("purchases", importSummary);
    setSummary((current) => ({ ...current, purchases: importSummary }));
  };

  const stageIssuedPdfFiles = async (files: File[]) => {
    const support = await fetchSupportData();
    const existingKeys = new Set(
      support.invoices.map((invoice) =>
        buildInvoiceDuplicateKey({
          numeroDocumento: invoice.numero_documento,
          rut: invoice.rut,
          terceroNombre: invoice.tercero_nombre || "",
          fechaEmision: invoice.fecha_emision,
          monto: Number(invoice.monto),
          tipo: invoice.tipo,
          tipoDocumento: invoice.tipo_documento,
        })
      )
    );
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

    const seenKeys = new Set<string>();
    const stagedWithDuplicateChecks = staged.map((item) => {
      if (!item.parsedRow || item.error) return item;
      const key = buildInvoiceDuplicateKey(item.parsedRow);
      if (existingKeys.has(key)) {
        return {
          ...item,
          error: `Documento duplicado: el folio ${item.parsedRow.numeroDocumento} ya existe en el sistema.`,
        };
      }
      if (seenKeys.has(key)) {
        return {
          ...item,
          error: "Documento duplicado dentro de los archivos seleccionados.",
        };
      }
      seenKeys.add(key);
      return item;
    });

    setPendingIssuedPdfItems(stagedWithDuplicateChecks);
    setSummary((current) => ({ ...current, issued: null }));
  };

  const processReceivablesImport = async (file: File) => {
    const rows = await readSpreadsheetRows(file);
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
        tipo: invoice.tipo,
        tipoDocumento: invoice.tipo_documento,
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
        tipo: "venta",
        tipoDocumento: row.tipoDocumento,
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
      } else if (mode === "receivables") {
        await processReceivablesImport(files[0]);
      } else {
        if (files.length !== 1) throw new Error("Selecciona un solo archivo de Registro de Compras del SII.");
        await processSiiPurchaseImport(files[0]);
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
      const parsedRows = pendingIssuedPdfItems
        .filter((item) => item.parsedRow && !item.error)
        .map((item) => item.parsedRow);
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

  const pendingIssuedPdfValidRows = pendingIssuedPdfItems.filter((item) => item.parsedRow && !item.error);
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
          <Button variant="outline" onClick={() => setSummary({ issued: null, receivables: null, purchases: null })}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Limpiar resumen
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ImportMode)}>
        <TabsList>
          <TabsTrigger value="issued">Ventas SII</TabsTrigger>
          <TabsTrigger value="purchases">Compras SII</TabsTrigger>
          <TabsTrigger value="receivables">Pendientes</TabsTrigger>
        </TabsList>

        <TabsContent value="issued">
          <ImportCard
            title="Registro de Ventas del SII y facturas emitidas"
            description="Carga el CSV/Excel del Registro de Ventas del SII o facturas emitidas/PDF. Conserva neto, IVA y total; crea clientes faltantes y no duplica documentos."
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

        <TabsContent value="purchases">
          <ImportCard
            title="Registro de Compras del SII"
            description="Carga el CSV/Excel del Registro de Compras. Crea proveedores faltantes, registra neto, IVA y total, y no duplica documentos del mismo proveedor. Las notas de crédito de compra se registran como rebaja de gasto para el P/L."
            canEdit={canEdit}
            loading={loading}
            inputRef={fileRefs.purchases}
            onChange={(event) => void handleFileImport("purchases", event)}
            onFilesSelected={(files) => void importFiles("purchases", files)}
            pendingIssuedPdfItems={[]}
            pendingIssuedPdfValidRows={0}
            pendingIssuedPdfErrors={[]}
            onAcceptPendingPdfImport={() => undefined}
            onClearPendingPdfImport={() => undefined}
            summary={summary.purchases}
            accept=".xlsx,.xls,.csv"
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
              {summary.validRows} válidas de {summary.totalRows}. {summary.insertedRows} insertadas, {summary.updatedRows} actualizadas, {summary.duplicateRows} omitidas por ya existir, {summary.rejectedRows} rechazadas, {summary.createdClients} {summary.createdCounterpartyLabel || "clientes"} creados.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
