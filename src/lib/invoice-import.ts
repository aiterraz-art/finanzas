import {
  buildObjectsFromWorksheetRows,
  normalizeDateInput,
  normalizeMoneyInput,
  normalizeRut,
  normalizeText,
} from "@/lib/treasury";

export type InvoiceImportSourceKind = "issued" | "receivables";

export type InvoiceImportDetection = {
  kind: InvoiceImportSourceKind | "unknown";
  headerRowIndex: number | null;
  reason?: string;
};

export type IssuedInvoiceImportRow = {
  numeroDocumento: string;
  rut: string | null;
  terceroNombre: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  monto: number;
  montoNeto?: number | null;
  montoIva?: number | null;
  descripcion: string | null;
  tipoDocumento: string | null;
  nombreDocumento: string | null;
  vendedorAsignado: string | null;
};

export type ReceivableInvoiceImportRow = {
  numeroDocumento: string | null;
  rut: string | null;
  terceroNombre: string;
  fechaEmision: string | null;
  fechaVencimiento: string | null;
  monto: number;
  saldoAbierto?: number | null;
  diasMora?: number | null;
  descripcion?: string | null;
  tipoDocumento?: string | null;
};

type RawSheetRow = Record<string, unknown>;

const SPANISH_MONTHS: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

const sanitizeImportText = (value: unknown) =>
  normalizeText(value)
    .replace(/[\uD800-\uDFFF\uFFFD]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeImportHeaderToken = (value: unknown) =>
  sanitizeImportText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();

const getValueFromRow = (rawRow: RawSheetRow, ...keys: string[]) => {
  const normalizedEntries = Object.entries(rawRow).map(([key, value]) => ({
    normalizedKey: normalizeImportHeaderToken(key),
    value,
  }));
  const normalizedKeys = keys.map(normalizeImportHeaderToken).filter(Boolean);

  for (const candidateKey of normalizedKeys) {
    const exact = normalizedEntries.find((entry) => entry.normalizedKey === candidateKey);
    if (exact) return exact.value;
  }

  for (const candidateKey of normalizedKeys) {
    const partial = normalizedEntries.find(
      (entry) =>
        entry.normalizedKey.includes(candidateKey) || candidateKey.includes(entry.normalizedKey)
    );
    if (partial) return partial.value;
  }

  return undefined;
};

const inferRutFromRow = (rawRow: RawSheetRow) => {
  const preferred = normalizeRut(
    getValueFromRow(rawRow, "rut", "r.u.t.", "codigo del cliente", "codigo cliente")
  );
  if (preferred) return preferred;

  let fallback: string | null = null;
  for (const [key, value] of Object.entries(rawRow)) {
    const normalizedKey = normalizeImportHeaderToken(key);
    const normalizedValue = normalizeRut(value);
    if (!normalizedValue) continue;
    if (
      normalizedKey.includes("rut") ||
      normalizedKey.includes("cliente") ||
      normalizedKey.includes("codigo")
    ) {
      return normalizedValue;
    }
    fallback = fallback || normalizedValue;
  }

  return fallback;
};

const rowContainsPatterns = (tokens: string[], patterns: string[]) =>
  tokens.some((token) => patterns.some((pattern) => token.includes(pattern)));

const normalizePdfLineText = (value: string) =>
  value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) => sanitizeImportText(line))
    .filter(Boolean);

const normalizePdfFlatText = (value: string) => normalizePdfLineText(value).join(" ");

const extractMoneyFromMatch = (match: RegExpMatchArray | null) => {
  if (!match?.[1]) return null;
  return normalizeMoneyInput(match[1]);
};

const normalizeInvoiceMoneyValue = (value: unknown) => {
  const text = sanitizeImportText(value);
  if (!text) return null;

  if (/^-?\d{1,3}(,\d{3})+$/.test(text)) {
    const numeric = Number(text.replace(/,/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }

  return normalizeMoneyInput(text);
};

const normalizeInvoiceDateInput = (value: unknown) => {
  if (typeof value === "number" || value instanceof Date) {
    return normalizeDateInput(value);
  }

  const text = sanitizeImportText(value);
  if (!text) return null;

  const slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const [, first, second, yyyy] = slashMatch;
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    const a = Number(first);
    const b = Number(second);

    const asMonthDay =
      a >= 1 && a <= 12 && b >= 1 && b <= 31
        ? `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`
        : null;
    const asDayMonth =
      a >= 1 && a <= 31 && b >= 1 && b <= 12
        ? `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`
        : null;

    if (a <= 12 && b > 12 && asMonthDay) return asMonthDay;
    if (a > 12 && b <= 12 && asDayMonth) return asDayMonth;
    if (asMonthDay) return asMonthDay;
    if (asDayMonth) return asDayMonth;
  }

  return normalizeDateInput(text);
};

const normalizeSpanishLongDate = (value: string) => {
  const normalized = sanitizeImportText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const match = normalized.match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:del\s+)?(\d{4})/i);
  if (!match) return null;

  const [, dd, monthName, yyyy] = match;
  const mm = SPANISH_MONTHS[monthName];
  if (!mm) return null;
  return `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
};

const subtractDaysIso = (dateIso: string, days: number) => {
  const next = new Date(`${dateIso}T12:00:00`);
  next.setDate(next.getDate() - days);
  return next.toISOString().split("T")[0];
};

export const detectIssuedInvoiceWorksheetFormat = (rows: unknown[][]): InvoiceImportDetection => {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const tokens = rows[rowIndex].map(normalizeImportHeaderToken).filter(Boolean);
    if (tokens.length === 0) continue;

    const looksLikeIssuedHeader =
      (
        rowContainsPatterns(tokens, ["numero", "folio", "documento", "nmerodeldocumento"]) &&
        rowContainsPatterns(tokens, ["cliente", "razonsocial", "nombre"])
      ) &&
      rowContainsPatterns(tokens, ["fechaemision", "emision", "fecha"]) &&
      rowContainsPatterns(tokens, ["monto", "total"]);

    if (looksLikeIssuedHeader) {
      return { kind: "issued", headerRowIndex: rowIndex };
    }
  }

  return {
    kind: "unknown",
    headerRowIndex: null,
    reason: "No se encontró un encabezado compatible con facturas emitidas.",
  };
};

export const detectReceivablesWorksheetFormat = (rows: unknown[][]): InvoiceImportDetection => {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const tokens = rows[rowIndex].map(normalizeImportHeaderToken).filter(Boolean);
    if (tokens.length === 0) continue;

    const looksLikeReceivablesHeader =
      rowContainsPatterns(tokens, ["cliente", "razonsocial", "nombre"]) &&
      rowContainsPatterns(tokens, ["folio", "numero", "documento", "nmero"]) &&
      rowContainsPatterns(tokens, ["saldo", "pendiente", "porcobrar"]) &&
      rowContainsPatterns(tokens, ["vencimiento", "fechaemision", "emision", "mora"]);

    if (looksLikeReceivablesHeader) {
      return { kind: "receivables", headerRowIndex: rowIndex };
    }
  }

  return {
    kind: "unknown",
    headerRowIndex: null,
    reason: "No se encontró un encabezado compatible con facturas pendientes de cobro.",
  };
};

export const normalizeIssuedInvoiceImportRow = (rawRow: RawSheetRow): IssuedInvoiceImportRow | null => {
  const numeroDocumento =
    sanitizeImportText(
      getValueFromRow(
        rawRow,
        "numero documento",
        "nmero del documento",
        "n documento",
        "folio",
        "numero",
        "factura"
      )
    ) || "";
  const terceroNombre =
    sanitizeImportText(
      getValueFromRow(rawRow, "cliente", "razon social", "nombre cliente", "nombre del cliente", "nombre")
    ) || "";
  const fechaEmision = normalizeInvoiceDateInput(
    getValueFromRow(rawRow, "fecha emision", "emision", "fecha")
  );
  const fechaVencimiento = normalizeInvoiceDateInput(
    getValueFromRow(rawRow, "fecha vencimiento", "vencimiento")
  );
  const monto = normalizeMoneyInput(
    getValueFromRow(rawRow, "monto", "monto total", "total", "importe", "saldo")
  );
  const tipoDocumento =
    sanitizeImportText(getValueFromRow(rawRow, "tipo doc", "tipo documento")) || null;
  const nombreDocumento =
    sanitizeImportText(getValueFromRow(rawRow, "nombre doc", "nombre documento")) || null;
  const vendedorAsignado =
    sanitizeImportText(getValueFromRow(rawRow, "nombre del vendedor", "vendedor", "seller")) || null;

  if (!numeroDocumento || !terceroNombre || !fechaEmision || !monto) {
    return null;
  }

  return {
    numeroDocumento,
    rut: inferRutFromRow(rawRow),
    terceroNombre,
    fechaEmision,
    fechaVencimiento,
    monto,
    montoNeto: null,
    montoIva: null,
    descripcion:
      sanitizeImportText(getValueFromRow(rawRow, "descripcion", "detalle", "glosa", "concepto")) || nombreDocumento,
    tipoDocumento,
    nombreDocumento,
    vendedorAsignado,
  };
};

export const parseIssuedInvoicePdfText = (rawText: string): IssuedInvoiceImportRow | null => {
  const lines = normalizePdfLineText(rawText);
  const flatText = normalizePdfFlatText(rawText);
  if (!flatText || !/FACTURA ELECTRONICA/i.test(flatText)) return null;

  const numeroDocumento =
    sanitizeImportText(flatText.match(/FACTURA\s+ELECTRONICA\s+N[º°]?\s*([A-Z0-9-]+)/i)?.[1]) || "";
  const terceroNombre =
    sanitizeImportText(flatText.match(/SEÑOR\(ES\):\s*(.+?)\s*R\.U\.T\.:/i)?.[1]) || "";
  const rut =
    normalizeRut(
      (flatText.match(/SEÑOR\(ES\):.+?R\.U\.T\.\:\s*([0-9.\-\sKk]+?)\s*GIRO:/i)?.[1] || "").replace(/\s+/g, "")
    );
  const fechaEmision =
    normalizeSpanishLongDate(flatText.match(/Fecha\s+Emision:\s*([^.]+?\d{4})/i)?.[1] || "") ||
    normalizeInvoiceDateInput(flatText.match(/Fecha\s+Emision:\s*([^.]+?\d{4})/i)?.[1] || "");
  const montoNeto = extractMoneyFromMatch(flatText.match(/MONTO\s+NETO\s*\$?\s*([\d.,]+)/i));
  const montoIva = extractMoneyFromMatch(flatText.match(/I\.?V\.?A\.?\s*19%\s*\$?\s*([\d.,]+)/i));
  const monto = normalizeMoneyInput(flatText.match(/TOTAL\s*\$?\s*([\d.,]+)/i)?.[1] || "");

  const valorIndex = lines.findIndex((line) => line.toLowerCase() === "valor");
  const formaPagoIndex = lines.findIndex((line) => /^Forma de Pago:/i.test(line));
  const itemLines =
    valorIndex >= 0 && formaPagoIndex > valorIndex
      ? lines
          .slice(valorIndex + 1, formaPagoIndex)
          .filter(
            (line) =>
              line !== "-" &&
              !/^\d+$/.test(line) &&
              !/^[\d.,]+$/.test(line) &&
              !/^%/i.test(line)
          )
      : [];
  const descripcion = itemLines.length > 0 ? itemLines.join(" ") : null;

  if (!numeroDocumento || !terceroNombre || !fechaEmision || !monto) {
    return null;
  }

  return {
    numeroDocumento,
    rut,
    terceroNombre,
    fechaEmision,
    fechaVencimiento: null,
    monto,
    montoNeto: montoNeto ?? null,
    montoIva: montoIva ?? null,
    descripcion,
    tipoDocumento: "FACTURA ELECTRONICA",
    nombreDocumento: "Factura Electrónica",
    vendedorAsignado: null,
  };
};

export const extractIssuedInvoicePdfRow = async (file: File): Promise<IssuedInvoiceImportRow | null> => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      import.meta.url
    ).toString();
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const texts: string[] = [];

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex);
    const content = await page.getTextContent();
    texts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join("\n")
    );
  }

  return parseIssuedInvoicePdfText(texts.join("\n"));
};

export const normalizeReceivableInvoiceImportRow = (rawRow: RawSheetRow): ReceivableInvoiceImportRow | null => {
  const numeroDocumento =
    sanitizeImportText(
      getValueFromRow(rawRow, "numero documento", "nmero", "n documento", "folio", "numero", "factura")
    ) || null;
  const terceroNombre =
    sanitizeImportText(
      getValueFromRow(rawRow, "cliente", "razon social", "nombre cliente", "nombre del cliente", "nombre")
    ) || "";
  const tipoDocumento =
    sanitizeImportText(getValueFromRow(rawRow, "docto", "tipo doc", "tipo documento")) || null;
  const fechaEmision = normalizeInvoiceDateInput(
    getValueFromRow(rawRow, "fecha emision", "emision", "fecha")
  );
  const fechaVencimiento = normalizeInvoiceDateInput(
    getValueFromRow(rawRow, "fecha vencimiento", "vencimiento")
  );
  const saldoAbierto = normalizeInvoiceMoneyValue(
    getValueFromRow(rawRow, "saldo abierto", "saldo", "pendiente", "por cobrar")
  );
  const monto = normalizeInvoiceMoneyValue(
    getValueFromRow(rawRow, "monto", "monto total", "total", "importe", "saldo")
  );
  const resolvedAmount = monto ?? saldoAbierto;
  const diasMoraValue = getValueFromRow(rawRow, "dias mora", "mora", "dias vencido");
  const diasMora = diasMoraValue === undefined || diasMoraValue === null || normalizeText(diasMoraValue) === ""
    ? null
    : Number(diasMoraValue);

  if (!terceroNombre || (!numeroDocumento && !fechaEmision && !fechaVencimiento) || !resolvedAmount) {
    return null;
  }

  return {
    numeroDocumento,
    rut: inferRutFromRow(rawRow),
    terceroNombre,
    fechaEmision,
    fechaVencimiento,
    monto: resolvedAmount,
    saldoAbierto: saldoAbierto || null,
    diasMora: Number.isFinite(diasMora) ? diasMora : null,
    descripcion:
      sanitizeImportText(getValueFromRow(rawRow, "descripcion", "detalle", "glosa", "concepto")) || null,
    tipoDocumento,
  };
};

export const buildInvoiceDuplicateKey = (row: {
  numeroDocumento: string | null;
  rut: string | null;
  terceroNombre: string;
  fechaEmision: string | null;
  monto: number;
}) => {
  if (row.numeroDocumento) {
    return `folio:${normalizeText(row.numeroDocumento).toLowerCase()}`;
  }

  return [
    "fallback",
    normalizeRut(row.rut) || normalizeText(row.terceroNombre).toLowerCase(),
    row.fechaEmision || "",
    Number(row.monto).toFixed(2),
  ].join("|");
};

export const inferReceivableEmissionDate = (row: ReceivableInvoiceImportRow) => {
  if (row.fechaEmision) return row.fechaEmision;
  if (row.fechaVencimiento) return subtractDaysIso(row.fechaVencimiento, 30);
  return new Date().toISOString().split("T")[0];
};

export const buildInvoiceObjectsFromWorksheet = (
  rows: unknown[][],
  headerRowIndex: number
) => buildObjectsFromWorksheetRows(rows, headerRowIndex);
