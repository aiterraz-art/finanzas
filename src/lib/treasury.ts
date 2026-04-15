import { format } from "date-fns";
import { es } from "date-fns/locale";

export type TreasuryPriority = "critical" | "high" | "normal" | "deferrable";
export type TreasuryDirection = "inflow" | "outflow";

export type TreasuryWeek = {
  weekStart: string;
  weekEnd: string;
  openingCash: number;
  expectedInflows: number;
  committedOutflows: number;
  netCash: number;
  closingCash: number;
  minimumBuffer: number;
  belowBuffer: boolean;
  negativeCash: boolean;
};

export type TreasuryOpenItem = {
  sourceType: "invoice_receivable" | "invoice_payable" | "rendicion" | "commitment" | "cheque_receivable" | "webpay_receivable";
  sourceId: string;
  empresaId: string;
  bankAccountId: string | null;
  direction: TreasuryDirection;
  counterparty: string;
  categoryCode: string;
  categoryName: string;
  amount: number;
  dueDate: string;
  expectedDate: string;
  confidencePct: number;
  priority: TreasuryPriority;
  status: string;
  agingDays: number;
  notes: string | null;
};

export type BankAccountPosition = {
  empresaId: string;
  bankAccountId: string;
  accountName: string;
  banco: string;
  tipo: string;
  moneda: string;
  latestStatementDate: string | null;
  currentBalance: number;
  staleImport: boolean;
  unreconciledCount: number;
  unreconciledAmount: number;
};

export type TreasuryKpis = {
  currentCash: number;
  freeCashNext7d: number;
  minProjectedCash: number;
  minProjectedWeek: string | null;
  dueOutflowsNext7d: number;
  expectedInflowsNext7d: number;
  overdueReceivables: number;
  taxesDueNext14d: number;
  payrollDueNext14d: number;
  staleBankAccountsCount: number;
  missingForecastDataCount: number;
};

export type PaymentQueueItem = {
  sourceType: TreasuryOpenItem["sourceType"];
  sourceId: string;
  counterparty: string;
  categoryCode: string;
  categoryName: string;
  amount: number;
  dueDate: string;
  expectedDate: string;
  priority: TreasuryPriority;
  bankAccountId: string | null;
  notes: string | null;
  suggestedAction: string;
};

export type CollectionPipelineItem = {
  facturaId: string;
  terceroId: string;
  terceroNombre: string;
  numeroDocumento: string;
  amount: number;
  dueDate: string;
  expectedDate: string;
  confidencePct: number;
  daysOverdue: number;
  lastContactAt: string | null;
  promisedPaymentDate: string | null;
  lastEventType: string | null;
  responsibleEmail: string | null;
  disputed: boolean;
  suggestedNextAction: string;
};

export type TreasuryPolicy = {
  empresaId: string;
  monedaBase: string;
  timezone: string;
  forecastWeeks: number;
  weekStartsOn: number;
  minimumCashBuffer: number;
  criticalCashBuffer: number;
  staleBankImportDays: number;
  missingFollowupDays: number;
};

export type BankAccount = {
  id: string;
  empresaId: string;
  nombre: string;
  banco: string;
  tipo: "corriente" | "vista" | "ahorro" | "caja_chica";
  moneda: string;
  numeroMascarado: string | null;
  saldoInicial: number;
  saldoInicialFecha: string;
  activa: boolean;
  esPrincipal: boolean;
};

export type TreasuryCategory = {
  id: string;
  empresaId: string;
  code: string;
  nombre: string;
  directionScope: "inflow" | "outflow" | "both";
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
};

export type CashCommitmentTemplate = {
  id: string;
  empresaId: string;
  categoryId: string;
  bankAccountId: string | null;
  obligationType: "tax" | "payroll" | "recurring" | "manual" | "debt" | "capex";
  description: string;
  counterparty: string | null;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  defaultAmount: number | null;
  requiresAmountConfirmation: boolean;
  priority: TreasuryPriority;
  active: boolean;
  nextDueDate: string;
  categoryName?: string;
  bankAccountName?: string;
};

export type CashCommitment = {
  id: string;
  empresaId: string;
  templateId: string | null;
  bankAccountId: string | null;
  categoryId: string;
  sourceType: "manual" | "template" | "tax" | "payroll" | "debt" | "capex";
  sourceReference: string | null;
  direction: TreasuryDirection;
  counterparty: string | null;
  description: string;
  amount: number;
  isEstimated: boolean;
  dueDate: string;
  expectedDate: string;
  priority: TreasuryPriority;
  status: "planned" | "confirmed" | "paid" | "cancelled" | "deferred";
  notes: string | null;
  categoryName?: string;
  bankAccountName?: string;
};

export type BankImportPreviewRow = {
  fechaMovimiento: string;
  descripcion: string;
  monto: number;
  saldo: number | null;
  numeroOperacion: string | null;
  sucursal: string | null;
  postedAt: string | null;
  entradaBanco: number;
  salidaBanco: number;
  sourceHash: string;
  columnasExtra: Record<string, string | number | null>;
};

export type WorksheetImportDetection = {
  kind: "bank_statement" | "receivables_aging_report" | "unknown";
  headerRowIndex: number | null;
  reason?: string;
};

export type ChequeReceivable = {
  id: string;
  empresaId: string;
  bankAccountId: string | null;
  terceroId: string | null;
  facturaId: string | null;
  movimientoBancoId: string | null;
  numeroCheque: string;
  bancoEmisor: string | null;
  librador: string;
  rutLibrador: string | null;
  moneda: string;
  monto: number;
  montoAplicadoFactura: number;
  fechaEmision: string | null;
  fechaVencimiento: string;
  fechaCobroEsperada: string;
  fechaCobroReal: string | null;
  estado: "en_cartera" | "depositado" | "cobrado" | "rechazado" | "anulado";
  notas: string | null;
  createdAt: string | null;
  bankAccountName?: string;
  terceroNombre?: string;
  facturaNumero?: string;
};

export type WebpayReceivable = {
  id: string;
  empresaId: string;
  bankAccountId: string | null;
  terceroId: string | null;
  facturaId: string | null;
  movimientoBancoId: string | null;
  canal: "webpay_plus" | "webpay_link" | "transbank" | "otro";
  ordenCompra: string;
  codigoAutorizacion: string | null;
  marcaTarjeta: string | null;
  cuotas: number;
  moneda: string;
  montoBruto: number;
  montoComision: number;
  montoNeto: number;
  montoAplicadoFactura: number;
  fechaVenta: string;
  fechaAbonoEsperada: string;
  fechaAbonoReal: string | null;
  estado: "pendiente" | "conciliado" | "rechazado" | "anulado";
  notas: string | null;
  createdAt: string | null;
  bankAccountName?: string;
  terceroNombre?: string;
  facturaNumero?: string;
};

const toNumber = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
};

const toPriority = (value: unknown): TreasuryPriority => {
  switch (value) {
    case "critical":
    case "high":
    case "normal":
    case "deferrable":
      return value;
    default:
      return "normal";
  }
};

export const PRIORITY_LABELS: Record<TreasuryPriority, string> = {
  critical: "Critica",
  high: "Alta",
  normal: "Normal",
  deferrable: "Postergable",
};

export const PRIORITY_BADGE_CLASSES: Record<TreasuryPriority, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-amber-100 text-amber-700 border-amber-200",
  normal: "bg-slate-100 text-slate-700 border-slate-200",
  deferrable: "bg-blue-100 text-blue-700 border-blue-200",
};

export const formatTreasuryCurrency = (amount: number, currency = "CLP") =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);

export const formatTreasuryDate = (value: string | null | undefined, fallback = "Sin fecha") => {
  if (!value) return fallback;
  try {
    return format(new Date(`${value}T12:00:00`), "dd MMM yyyy", { locale: es });
  } catch {
    return fallback;
  }
};

export const formatTreasuryDateTime = (value: string | null | undefined, fallback = "Sin registro") => {
  if (!value) return fallback;
  try {
    return format(new Date(value), "dd MMM yyyy HH:mm", { locale: es });
  } catch {
    return fallback;
  }
};

export const getPriorityWeight = (priority: TreasuryPriority) => {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    default:
      return 1;
  }
};

export const getConfidenceLabel = (confidencePct: number) => {
  if (confidencePct >= 85) return "Alta";
  if (confidencePct >= 60) return "Media";
  if (confidencePct >= 30) return "Baja";
  return "Critica";
};

export const getConfidenceClasses = (confidencePct: number) => {
  if (confidencePct >= 85) return "text-emerald-700";
  if (confidencePct >= 60) return "text-amber-700";
  if (confidencePct >= 30) return "text-orange-700";
  return "text-red-700";
};

export const canEditTreasury = (role: string | null) => role !== "viewer" && role !== null;

export const normalizeText = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const formatUtcDate = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

export const normalizeDateInput = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return format(value, "yyyy-MM-dd");
  }

  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const parsed = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    if (!Number.isNaN(parsed.getTime())) {
      return formatUtcDate(parsed);
    }
  }

  const text = normalizeText(value);
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return format(direct, "yyyy-MM-dd");
  }

  const slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch;
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    const parsed = new Date(`${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return format(parsed, "yyyy-MM-dd");
    }
  }

  return null;
};

export const normalizeMoneyInput = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = normalizeText(value);
  if (!text) return 0;
  const cleaned = text.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const buildBankSourceHash = (params: {
  bankAccountId: string;
  fechaMovimiento: string;
  descripcion: string;
  monto: number;
  saldo?: number | null;
  numeroOperacion?: string | null;
}) =>
  [
    params.bankAccountId,
    params.fechaMovimiento,
    normalizeText(params.numeroOperacion),
    normalizeText(params.descripcion).toLowerCase(),
    params.monto.toFixed(2),
    params.saldo === null || params.saldo === undefined ? "" : Number(params.saldo).toFixed(2),
  ].join("|");

const normalizeImportHeaderToken = (value: unknown) =>
  normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();

const rowContainsPatterns = (tokens: string[], patterns: string[]) =>
  tokens.some((token) => patterns.some((pattern) => token.includes(pattern)));

export const detectWorksheetImportFormat = (rows: unknown[][]): WorksheetImportDetection => {
  const bankDatePatterns = ["fecha", "date", "fechamovimiento", "postedat"];
  const bankDescriptionPatterns = ["descripcion", "glosa", "detalle", "description", "concepto", "movimiento"];
  const bankAmountPatterns = ["abono", "deposito", "credito", "entrada", "ingreso", "cargo", "debito", "salida", "egreso", "monto", "amount", "importe"];

  const hasReceivablesTitle = rows.some((row) =>
    row.some((cell) => {
      const token = normalizeImportHeaderToken(cell);
      return token.includes("cuentasporcobrar") || token.includes("documentosvencidos");
    })
  );

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const tokens = rows[rowIndex].map(normalizeImportHeaderToken).filter(Boolean);
    if (tokens.length === 0) continue;

    const looksLikeBankHeader =
      rowContainsPatterns(tokens, bankDatePatterns) &&
      rowContainsPatterns(tokens, bankDescriptionPatterns) &&
      rowContainsPatterns(tokens, bankAmountPatterns);

    if (looksLikeBankHeader) {
      return { kind: "bank_statement", headerRowIndex: rowIndex };
    }

    const looksLikeReceivablesHeader =
      rowContainsPatterns(tokens, ["nombre"]) &&
      rowContainsPatterns(tokens, ["docto"]) &&
      rowContainsPatterns(tokens, ["vencimiento"]) &&
      rowContainsPatterns(tokens, ["saldo"]);

    if (looksLikeReceivablesHeader || hasReceivablesTitle) {
      return {
        kind: "receivables_aging_report",
        headerRowIndex: looksLikeReceivablesHeader ? rowIndex : null,
        reason: "El archivo corresponde a un reporte de cuentas por cobrar, no a una cartola bancaria.",
      };
    }
  }

  return {
    kind: "unknown",
    headerRowIndex: null,
    reason: "No se encontró un encabezado compatible con cartola bancaria.",
  };
};

export const buildObjectsFromWorksheetRows = (
  rows: unknown[][],
  headerRowIndex: number
): Record<string, unknown>[] => {
  const headerRow = rows[headerRowIndex] || [];
  const seenHeaders = new Map<string, number>();
  const headers = headerRow.map((cell, index) => {
    const base = normalizeText(cell) || `__col_${index}`;
    const count = seenHeaders.get(base) || 0;
    seenHeaders.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  return rows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => normalizeText(cell) !== ""))
    .map((row) =>
      headers.reduce<Record<string, unknown>>((acc, header, index) => {
        acc[header] = row[index] ?? "";
        return acc;
      }, {})
    );
};

export const normalizeBankImportRow = (
  rawRow: Record<string, unknown>,
  bankAccountId: string
): BankImportPreviewRow | null => {
  const entries = Object.entries(rawRow);
  const normalizedEntries = entries.map(([key, value]) => ({
    key,
    normalizedKey: normalizeImportHeaderToken(key),
    value,
  }));
  const getValue = (...keys: string[]) => {
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

  const fechaMovimiento = normalizeDateInput(
    getValue(
      "fecha transaccion",
      "fecha movimiento",
      "fecha_movimiento",
      "fecha",
      "date",
      "posted_at"
    )
  );
  if (!fechaMovimiento) return null;

  const descripcion = normalizeText(
    getValue("descripcion", "descripción", "glosa", "detalle", "description", "concepto", "movimiento")
  );
  if (!descripcion) return null;

  const abono = normalizeMoneyInput(
    getValue("abono", "deposito", "credito", "entrada", "ingreso", "ingreso (+)")
  );
  const cargo = normalizeMoneyInput(
    getValue("cargo", "debito", "salida", "egreso", "egreso (-)")
  );
  const montoRaw = normalizeMoneyInput(getValue("monto", "amount", "importe"));
  const monto = abono || cargo ? abono - cargo : montoRaw;
  if (!monto) return null;

  const saldo = (() => {
    const value = getValue("saldo", "balance");
    if (value === null || value === undefined || normalizeText(value) === "") return null;
    return normalizeMoneyInput(value);
  })();

  const numeroOperacion = normalizeText(
    getValue("n_operacion", "n operacion", "operacion", "referencia", "nro operacion", "nro_operacion")
  ) || null;
  const sucursal = normalizeText(getValue("sucursal", "branch")) || null;
  const postedAt = normalizeDateInput(getValue("fecha contable", "posted_at"));
  const knownKeys = new Set([
    "fecha",
    "date",
    "fechatransaccion",
    "fechamovimiento",
    "fecha_movimiento",
    "fechacontable",
    "postedat",
    "descripcion",
    "glosa",
    "detalle",
    "description",
    "concepto",
    "movimiento",
    "abono",
    "deposito",
    "credito",
    "entrada",
    "ingreso",
    "ingreso",
    "egreso",
    "cargo",
    "debito",
    "salida",
    "monto",
    "amount",
    "importe",
    "saldo",
    "balance",
    "noperacion",
    "operacion",
    "referencia",
    "nrooperacion",
    "sucursal",
    "branch",
  ]);

  const columnasExtra = entries.reduce<Record<string, string | number | null>>((acc, [key, value]) => {
    const normalizedKey = normalizeImportHeaderToken(key);
    if (knownKeys.has(normalizedKey)) return acc;
    acc[key] = value === undefined ? null : (value as string | number | null);
    return acc;
  }, {});

  return {
    fechaMovimiento,
    descripcion,
    monto,
    saldo,
    numeroOperacion,
    sucursal,
    postedAt,
    entradaBanco: monto > 0 ? monto : 0,
    salidaBanco: monto < 0 ? Math.abs(monto) : 0,
    sourceHash: buildBankSourceHash({
      bankAccountId,
      fechaMovimiento,
      descripcion,
      monto,
      saldo,
      numeroOperacion,
    }),
    columnasExtra,
  };
};

export const normalizeTreasuryWeek = (row: any): TreasuryWeek => ({
  weekStart: row?.week_start ?? "",
  weekEnd: row?.week_end ?? "",
  openingCash: toNumber(row?.opening_cash),
  expectedInflows: toNumber(row?.expected_inflows),
  committedOutflows: toNumber(row?.committed_outflows),
  netCash: toNumber(row?.net_cash),
  closingCash: toNumber(row?.closing_cash),
  minimumBuffer: toNumber(row?.minimum_buffer),
  belowBuffer: Boolean(row?.below_buffer),
  negativeCash: Boolean(row?.negative_cash),
});

export const normalizeTreasuryOpenItem = (row: any): TreasuryOpenItem => ({
  sourceType: row?.source_type ?? "commitment",
  sourceId: row?.source_id ?? "",
  empresaId: row?.empresa_id ?? "",
  bankAccountId: row?.bank_account_id ?? null,
  direction: row?.direction ?? "outflow",
  counterparty: row?.counterparty ?? "Sin contraparte",
  categoryCode: row?.category_code ?? "other_outflow",
  categoryName: row?.category_name ?? "Sin categoria",
  amount: toNumber(row?.amount),
  dueDate: row?.due_date ?? "",
  expectedDate: row?.expected_date ?? "",
  confidencePct: toNumber(row?.confidence_pct || 0),
  priority: toPriority(row?.priority),
  status: row?.status ?? "",
  agingDays: toNumber(row?.aging_days),
  notes: row?.notes ?? null,
});

export const normalizeBankAccountPosition = (row: any): BankAccountPosition => ({
  empresaId: row?.empresa_id ?? "",
  bankAccountId: row?.bank_account_id ?? "",
  accountName: row?.account_name ?? "Cuenta",
  banco: row?.banco ?? "",
  tipo: row?.tipo ?? "",
  moneda: row?.moneda ?? "CLP",
  latestStatementDate: row?.latest_statement_date ?? null,
  currentBalance: toNumber(row?.current_balance),
  staleImport: Boolean(row?.stale_import),
  unreconciledCount: toNumber(row?.unreconciled_count),
  unreconciledAmount: toNumber(row?.unreconciled_amount),
});

export const normalizeTreasuryKpis = (row: any): TreasuryKpis => ({
  currentCash: toNumber(row?.current_cash),
  freeCashNext7d: toNumber(row?.free_cash_next_7d),
  minProjectedCash: toNumber(row?.min_projected_cash),
  minProjectedWeek: row?.min_projected_week ?? null,
  dueOutflowsNext7d: toNumber(row?.due_outflows_next_7d),
  expectedInflowsNext7d: toNumber(row?.expected_inflows_next_7d),
  overdueReceivables: toNumber(row?.overdue_receivables),
  taxesDueNext14d: toNumber(row?.taxes_due_next_14d),
  payrollDueNext14d: toNumber(row?.payroll_due_next_14d),
  staleBankAccountsCount: toNumber(row?.stale_bank_accounts_count),
  missingForecastDataCount: toNumber(row?.missing_forecast_data_count),
});

export const normalizePaymentQueueItem = (row: any): PaymentQueueItem => ({
  sourceType: row?.source_type ?? "commitment",
  sourceId: row?.source_id ?? "",
  counterparty: row?.counterparty ?? "Sin contraparte",
  categoryCode: row?.category_code ?? "other_outflow",
  categoryName: row?.category_name ?? "Sin categoria",
  amount: toNumber(row?.amount),
  dueDate: row?.due_date ?? "",
  expectedDate: row?.expected_date ?? "",
  priority: toPriority(row?.priority),
  bankAccountId: row?.bank_account_id ?? null,
  notes: row?.notes ?? null,
  suggestedAction: row?.suggested_action ?? "Revisar programacion",
});

export const normalizeCollectionPipelineItem = (row: any): CollectionPipelineItem => ({
  facturaId: row?.factura_id ?? "",
  terceroId: row?.tercero_id ?? "",
  terceroNombre: row?.tercero_nombre ?? "Sin cliente",
  numeroDocumento: row?.numero_documento ?? "",
  amount: toNumber(row?.amount),
  dueDate: row?.due_date ?? "",
  expectedDate: row?.expected_date ?? "",
  confidencePct: toNumber(row?.confidence_pct),
  daysOverdue: toNumber(row?.days_overdue),
  lastContactAt: row?.last_contact_at ?? null,
  promisedPaymentDate: row?.promised_payment_date ?? null,
  lastEventType: row?.last_event_type ?? null,
  responsibleEmail: row?.responsible_email ?? null,
  disputed: Boolean(row?.disputed),
  suggestedNextAction: row?.suggested_next_action ?? "Monitorear",
});

export const normalizeTreasuryPolicy = (row: any): TreasuryPolicy => ({
  empresaId: row?.empresa_id ?? "",
  monedaBase: row?.moneda_base ?? "CLP",
  timezone: row?.timezone ?? "America/Santiago",
  forecastWeeks: toNumber(row?.forecast_weeks || 13),
  weekStartsOn: toNumber(row?.week_starts_on || 1),
  minimumCashBuffer: toNumber(row?.minimum_cash_buffer),
  criticalCashBuffer: toNumber(row?.critical_cash_buffer),
  staleBankImportDays: toNumber(row?.stale_bank_import_days || 3),
  missingFollowupDays: toNumber(row?.missing_followup_days || 7),
});

export const normalizeBankAccount = (row: any): BankAccount => ({
  id: row?.id ?? "",
  empresaId: row?.empresa_id ?? "",
  nombre: row?.nombre ?? "Cuenta",
  banco: row?.banco ?? "",
  tipo: row?.tipo ?? "corriente",
  moneda: row?.moneda ?? "CLP",
  numeroMascarado: row?.numero_mascarado ?? null,
  saldoInicial: toNumber(row?.saldo_inicial),
  saldoInicialFecha: row?.saldo_inicial_fecha ?? format(new Date(), "yyyy-MM-dd"),
  activa: row?.activa !== false,
  esPrincipal: Boolean(row?.es_principal),
});

export const normalizeTreasuryCategory = (row: any): TreasuryCategory => ({
  id: row?.id ?? "",
  empresaId: row?.empresa_id ?? "",
  code: row?.code ?? "",
  nombre: row?.nombre ?? "",
  directionScope: row?.direction_scope ?? "outflow",
  sortOrder: toNumber(row?.sort_order || 100),
  active: row?.active !== false,
  isSystem: Boolean(row?.is_system),
});

export const normalizeCashCommitmentTemplate = (row: any): CashCommitmentTemplate => ({
  id: row?.id ?? "",
  empresaId: row?.empresa_id ?? "",
  categoryId: row?.category_id ?? "",
  bankAccountId: row?.bank_account_id ?? null,
  obligationType: row?.obligation_type ?? "manual",
  description: row?.description ?? "",
  counterparty: row?.counterparty ?? null,
  frequency: row?.frequency ?? "monthly",
  dayOfMonth: row?.day_of_month ?? null,
  dayOfWeek: row?.day_of_week ?? null,
  defaultAmount: row?.default_amount === null ? null : toNumber(row?.default_amount),
  requiresAmountConfirmation: Boolean(row?.requires_amount_confirmation),
  priority: toPriority(row?.priority),
  active: row?.active !== false,
  nextDueDate: row?.next_due_date ?? format(new Date(), "yyyy-MM-dd"),
  categoryName: row?.treasury_categories?.nombre ?? row?.category_name,
  bankAccountName: row?.bank_accounts?.nombre ?? row?.bank_account_name,
});

export const normalizeCashCommitment = (row: any): CashCommitment => ({
  id: row?.id ?? "",
  empresaId: row?.empresa_id ?? "",
  templateId: row?.template_id ?? null,
  bankAccountId: row?.bank_account_id ?? null,
  categoryId: row?.category_id ?? "",
  sourceType: row?.source_type ?? "manual",
  sourceReference: row?.source_reference ?? null,
  direction: row?.direction ?? "outflow",
  counterparty: row?.counterparty ?? null,
  description: row?.description ?? "",
  amount: toNumber(row?.amount),
  isEstimated: Boolean(row?.is_estimated),
  dueDate: row?.due_date ?? format(new Date(), "yyyy-MM-dd"),
  expectedDate: row?.expected_date ?? format(new Date(), "yyyy-MM-dd"),
  priority: toPriority(row?.priority),
  status: row?.status ?? "planned",
  notes: row?.notes ?? null,
  categoryName: row?.treasury_categories?.nombre ?? row?.category_name,
  bankAccountName: row?.bank_accounts?.nombre ?? row?.bank_account_name,
});

export const normalizeChequeReceivable = (row: any): ChequeReceivable => ({
  id: row?.id ?? "",
  empresaId: row?.empresa_id ?? "",
  bankAccountId: row?.bank_account_id ?? null,
  terceroId: row?.tercero_id ?? null,
  facturaId: row?.factura_id ?? null,
  movimientoBancoId: row?.movimiento_banco_id ?? null,
  numeroCheque: row?.numero_cheque ?? "",
  bancoEmisor: row?.banco_emisor ?? null,
  librador: row?.librador ?? "",
  rutLibrador: row?.rut_librador ?? null,
  moneda: row?.moneda ?? "CLP",
  monto: toNumber(row?.monto),
  montoAplicadoFactura: toNumber(row?.monto_aplicado_factura),
  fechaEmision: row?.fecha_emision ?? null,
  fechaVencimiento: row?.fecha_vencimiento ?? format(new Date(), "yyyy-MM-dd"),
  fechaCobroEsperada: row?.fecha_cobro_esperada ?? format(new Date(), "yyyy-MM-dd"),
  fechaCobroReal: row?.fecha_cobro_real ?? null,
  estado: row?.estado ?? "en_cartera",
  notas: row?.notas ?? null,
  createdAt: row?.created_at ?? null,
  bankAccountName: row?.bank_accounts?.nombre ?? row?.bank_account_name,
  terceroNombre: row?.terceros?.razon_social ?? row?.tercero_nombre,
  facturaNumero: row?.facturas?.numero_documento ?? row?.factura_numero,
});

export const normalizeWebpayReceivable = (row: any): WebpayReceivable => ({
  id: row?.id ?? "",
  empresaId: row?.empresa_id ?? "",
  bankAccountId: row?.bank_account_id ?? null,
  terceroId: row?.tercero_id ?? null,
  facturaId: row?.factura_id ?? null,
  movimientoBancoId: row?.movimiento_banco_id ?? null,
  canal: row?.canal ?? "webpay_plus",
  ordenCompra: row?.orden_compra ?? "",
  codigoAutorizacion: row?.codigo_autorizacion ?? null,
  marcaTarjeta: row?.marca_tarjeta ?? null,
  cuotas: toNumber(row?.cuotas || 1),
  moneda: row?.moneda ?? "CLP",
  montoBruto: toNumber(row?.monto_bruto),
  montoComision: toNumber(row?.monto_comision),
  montoNeto: toNumber(row?.monto_neto),
  montoAplicadoFactura: toNumber(row?.monto_aplicado_factura),
  fechaVenta: row?.fecha_venta ?? format(new Date(), "yyyy-MM-dd"),
  fechaAbonoEsperada: row?.fecha_abono_esperada ?? format(new Date(), "yyyy-MM-dd"),
  fechaAbonoReal: row?.fecha_abono_real ?? null,
  estado: row?.estado ?? "pendiente",
  notas: row?.notas ?? null,
  createdAt: row?.created_at ?? null,
  bankAccountName: row?.bank_accounts?.nombre ?? row?.bank_account_name,
  terceroNombre: row?.terceros?.razon_social ?? row?.tercero_nombre,
  facturaNumero: row?.facturas?.numero_documento ?? row?.factura_numero,
});
