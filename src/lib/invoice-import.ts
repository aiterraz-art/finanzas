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
  descripcion: string | null;
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
};

type RawSheetRow = Record<string, unknown>;

const normalizeImportHeaderToken = (value: unknown) =>
  normalizeText(value)
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

const rowContainsPatterns = (tokens: string[], patterns: string[]) =>
  tokens.some((token) => patterns.some((pattern) => token.includes(pattern)));

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
      rowContainsPatterns(tokens, ["numero", "folio", "documento"]) &&
      rowContainsPatterns(tokens, ["cliente", "razonsocial", "nombre"]) &&
      rowContainsPatterns(tokens, ["fechaemision", "emision"]) &&
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
      rowContainsPatterns(tokens, ["folio", "numero", "documento"]) &&
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
    normalizeText(
      getValueFromRow(rawRow, "numero documento", "n documento", "folio", "numero", "factura")
    ) || "";
  const terceroNombre =
    normalizeText(
      getValueFromRow(rawRow, "cliente", "razon social", "nombre cliente", "nombre")
    ) || "";
  const fechaEmision = normalizeDateInput(
    getValueFromRow(rawRow, "fecha emision", "emision", "fecha")
  );
  const fechaVencimiento = normalizeDateInput(
    getValueFromRow(rawRow, "fecha vencimiento", "vencimiento")
  );
  const monto = normalizeMoneyInput(
    getValueFromRow(rawRow, "monto", "monto total", "total", "importe", "saldo")
  );

  if (!numeroDocumento || !terceroNombre || !fechaEmision || !monto) {
    return null;
  }

  return {
    numeroDocumento,
    rut: normalizeRut(getValueFromRow(rawRow, "rut", "r.u.t.")),
    terceroNombre,
    fechaEmision,
    fechaVencimiento,
    monto,
    descripcion:
      normalizeText(getValueFromRow(rawRow, "descripcion", "detalle", "glosa", "concepto")) || null,
  };
};

export const normalizeReceivableInvoiceImportRow = (rawRow: RawSheetRow): ReceivableInvoiceImportRow | null => {
  const numeroDocumento =
    normalizeText(
      getValueFromRow(rawRow, "numero documento", "n documento", "folio", "numero", "factura")
    ) || null;
  const terceroNombre =
    normalizeText(
      getValueFromRow(rawRow, "cliente", "razon social", "nombre cliente", "nombre")
    ) || "";
  const fechaEmision = normalizeDateInput(
    getValueFromRow(rawRow, "fecha emision", "emision", "fecha")
  );
  const fechaVencimiento = normalizeDateInput(
    getValueFromRow(rawRow, "fecha vencimiento", "vencimiento")
  );
  const saldoAbierto = normalizeMoneyInput(
    getValueFromRow(rawRow, "saldo abierto", "saldo", "pendiente", "por cobrar")
  );
  const monto = normalizeMoneyInput(
    getValueFromRow(rawRow, "monto", "monto total", "total", "importe", "saldo")
  );
  const diasMoraValue = getValueFromRow(rawRow, "dias mora", "mora", "dias vencido");
  const diasMora = diasMoraValue === undefined || diasMoraValue === null || normalizeText(diasMoraValue) === ""
    ? null
    : Number(diasMoraValue);

  if (!terceroNombre || (!numeroDocumento && !fechaEmision && !fechaVencimiento) || !(monto || saldoAbierto)) {
    return null;
  }

  return {
    numeroDocumento,
    rut: normalizeRut(getValueFromRow(rawRow, "rut", "r.u.t.")),
    terceroNombre,
    fechaEmision,
    fechaVencimiento,
    monto: monto || saldoAbierto,
    saldoAbierto: saldoAbierto || null,
    diasMora: Number.isFinite(diasMora) ? diasMora : null,
    descripcion:
      normalizeText(getValueFromRow(rawRow, "descripcion", "detalle", "glosa", "concepto")) || null,
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
