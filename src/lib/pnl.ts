// Cálculo del P/L (estado de resultados) por devengo.
// Se mantiene sin dependencias de React/Supabase para poder testearlo con datos de ejemplo.

export type PnlDocumentType = "venta" | "compra" | "nota_credito" | "nota_credito_compra";

export type PnlDocument = {
  id: string;
  tipo: PnlDocumentType;
  numero_documento: string | null;
  tercero_nombre: string | null;
  fecha_emision: string | null;
  monto: number | null;
  monto_neto: number | null;
  monto_exento: number | null;
  monto_iva?: number | null;
  monto_iva_no_recuperable?: number | null;
  monto_otros_impuestos?: number | null;
  estado: string | null;
};

export type PnlExpenseLine =
  | "payroll"
  | "professional_fees"
  | "reimbursements"
  | "premises"
  | "services"
  | "mobility"
  | "maintenance"
  | "insurance"
  | "bank_fees"
  | "interest"
  | "import_costs"
  | "suppliers_without_invoice"
  | "other";

export const PNL_EXPENSE_LINES: Array<{ key: PnlExpenseLine; label: string }> = [
  { key: "payroll", label: "Remuneraciones" },
  { key: "professional_fees", label: "Honorarios" },
  { key: "reimbursements", label: "Rendiciones sin factura asociada" },
  { key: "premises", label: "Arriendo y gastos comunes" },
  { key: "services", label: "Servicios básicos y suscripciones" },
  { key: "mobility", label: "Combustible, peajes, fletes y viáticos" },
  { key: "maintenance", label: "Mantenciones y reparaciones" },
  { key: "insurance", label: "Seguros" },
  { key: "bank_fees", label: "Comisiones bancarias" },
  { key: "interest", label: "Intereses de créditos" },
  { key: "import_costs", label: "Gastos de importación" },
  { key: "suppliers_without_invoice", label: "Proveedores pagados sin factura" },
  { key: "other", label: "Otros gastos" },
];

// Categorías de tesorería que son gasto del período. Las que no están aquí no afectan resultado:
// taxes (IVA/F29, el IVA no es gasto), internal_transfers, capex (activo) y las de ingreso.
// debt_service solo aporta el interés informado en pnl_amount; el capital no es gasto.
export const PNL_CATEGORY_LINES: Record<string, PnlExpenseLine> = {
  payroll: "payroll",
  professional_fees: "professional_fees",
  reimbursements: "reimbursements",
  rent: "premises",
  common_expenses: "premises",
  utilities: "services",
  services: "services",
  subscriptions: "services",
  fuel: "mobility",
  tolls: "mobility",
  logistics: "mobility",
  travel_expenses: "mobility",
  maintenance: "maintenance",
  insurance: "insurance",
  bank_fees: "bank_fees",
  debt_service: "interest",
  import_costs: "import_costs",
  suppliers: "suppliers_without_invoice",
  petty_cash: "other",
  other_outflow: "other",
};

export const PNL_CATEGORY_CODES = Object.keys(PNL_CATEGORY_LINES);

export type PnlCommitment = {
  id: string;
  categoryCode: string;
  description: string;
  counterparty: string | null;
  amount: number;
  pnlAmount: number | null;
  accrualMonth: string | null;
  movementDate: string | null;
  expectedDate: string | null;
  dueDate: string | null;
  // Total (con IVA) de las facturas de compra vinculadas: esas facturas ya están en compras.
  linkedInvoicesGross: number;
  // El mismo movimiento bancario está aplicado a una factura de compra.
  movementCoveredByInvoice: boolean;
};

export type PnlRendicion = {
  id: string;
  fecha: string;
  montoTotal: number;
  terceroNombre: string | null;
  descripcion: string | null;
  linkedInvoicesGross: number;
};

export type PnlAdvanceReturn = {
  id: string;
  returnedAt: string;
  amount: number;
  workerName: string;
};

export type PnlTotals = {
  sales: number;
  salesCreditNotes: number;
  purchases: number;
  purchaseCreditNotes: number;
  expenses: Record<PnlExpenseLine, number>;
};

export type PnlExpenseItem = {
  id: string;
  source: "commitment" | "rendicion" | "advance_return";
  line: PnlExpenseLine;
  month: string;
  // Fecha del pago bancario (o del documento) para ubicarlo en la cartola.
  date: string | null;
  description: string;
  counterparty: string | null;
  paidAmount: number;
  amount: number;
  note: string | null;
};

export type PnlWarning = {
  kind: "missing_breakdown" | "negative_document" | "possible_duplicate";
  message: string;
  documentId?: string;
  commitmentId?: string;
};

export type PnlResult = {
  totals: PnlTotals;
  monthly: Map<string, PnlTotals>;
  expenseItems: PnlExpenseItem[];
  warnings: PnlWarning[];
};

export const emptyPnlTotals = (): PnlTotals => ({
  sales: 0,
  salesCreditNotes: 0,
  purchases: 0,
  purchaseCreditNotes: 0,
  expenses: Object.fromEntries(PNL_EXPENSE_LINES.map((line) => [line.key, 0])) as Record<PnlExpenseLine, number>,
});

const toNumber = (value: unknown) => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundPesos = (value: number) => Math.round(value * 100) / 100;

export const hasTaxBreakdown = (document: PnlDocument) =>
  toNumber(document.monto_neto) !== null || toNumber(document.monto_exento) !== null;

// Monto del documento sin IVA recuperable. Compras suman el IVA no recuperable y otros impuestos
// sin derecho a crédito porque son costo. Sin desglose se usa el total (incluye IVA).
export const documentBaseAmount = (document: PnlDocument) => {
  if (!hasTaxBreakdown(document)) return toNumber(document.monto) ?? 0;
  const base = (toNumber(document.monto_neto) ?? 0) + (toNumber(document.monto_exento) ?? 0);
  const isPurchase = document.tipo === "compra" || document.tipo === "nota_credito_compra";
  if (!isPurchase) return base;
  return base + (toNumber(document.monto_iva_no_recuperable) ?? 0) + (toNumber(document.monto_otros_impuestos) ?? 0);
};

// Efecto del documento en el resultado: positivo aumenta ingresos o gastos según su tipo, las notas
// de crédito restan. Una nota de crédito guardada con signo negativo no debe restar dos veces, y una
// venta o compra negativa (nota de crédito cargada como venta) se mantiene restando.
export const documentPnlAmount = (document: PnlDocument) => {
  const base = documentBaseAmount(document);
  return document.tipo === "nota_credito" || document.tipo === "nota_credito_compra" ? Math.abs(base) : base;
};

// Monto con signo como se ve en el detalle: notas de crédito en negativo.
export const documentSignedPnlAmount = (document: PnlDocument) =>
  document.tipo === "nota_credito" || document.tipo === "nota_credito_compra"
    ? -documentPnlAmount(document)
    : documentPnlAmount(document);

// Totales posibles de un documento: el guardado y el que resulta de su desglose. Si el total se
// tipeó mal, el desglose del SII sigue permitiendo reconocer el pago.
export const documentGrossCandidates = (document: PnlDocument) => {
  const values = [toNumber(document.monto) ?? 0];
  if (hasTaxBreakdown(document)) {
    values.push(
      (toNumber(document.monto_neto) ?? 0) +
        (toNumber(document.monto_exento) ?? 0) +
        (toNumber(document.monto_iva) ?? 0) +
        (toNumber(document.monto_iva_no_recuperable) ?? 0) +
        (toNumber(document.monto_otros_impuestos) ?? 0)
    );
  }
  return values;
};

export const addDocumentToTotals = (totals: PnlTotals, document: PnlDocument) => {
  const amount = documentPnlAmount(document);
  if (document.tipo === "venta") totals.sales += amount;
  if (document.tipo === "nota_credito") totals.salesCreditNotes += amount;
  if (document.tipo === "compra") totals.purchases += amount;
  if (document.tipo === "nota_credito_compra") totals.purchaseCreditNotes += amount;
};

export const incomeFromTotals = (totals: PnlTotals) => totals.sales - totals.salesCreditNotes;
export const operatingExpensesFromTotals = (totals: PnlTotals) =>
  PNL_EXPENSE_LINES.reduce((sum, line) => sum + totals.expenses[line.key], 0);
export const expenseFromTotals = (totals: PnlTotals) =>
  totals.purchases - totals.purchaseCreditNotes + operatingExpensesFromTotals(totals);

// Mes de devengo: el indicado al conciliar; si falta, el del pago bancario.
export const effectiveAccrualMonth = (commitment: Pick<PnlCommitment, "accrualMonth" | "movementDate" | "expectedDate" | "dueDate">) => {
  const value = commitment.accrualMonth || commitment.movementDate || commitment.expectedDate || commitment.dueDate;
  return value ? value.slice(0, 7) : null;
};

// Gasto del compromiso: monto de devengo (p. ej. bruto de la boleta de honorarios o interés de
// la cuota) o el pagado, menos lo cubierto por facturas de compra vinculadas.
export const commitmentPnlAmount = (commitment: PnlCommitment) => {
  if (commitment.movementCoveredByInvoice) return 0;
  const line = PNL_CATEGORY_LINES[commitment.categoryCode];
  if (!line) return 0;
  const accrued = commitment.pnlAmount ?? (line === "interest" ? 0 : commitment.amount);
  return Math.max(0, roundPesos(accrued - commitment.linkedInvoicesGross));
};

const monthOf = (value: string | null | undefined) => (value ? value.slice(0, 7) : null);

const isMonthInRange = (month: string, fromMonth: string, toMonth: string) => month >= fromMonth && month <= toMonth;

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${a.slice(0, 10)}T12:00:00`).getTime() - new Date(`${b.slice(0, 10)}T12:00:00`).getTime()) / 86400000);

export const buildPnl = (params: {
  fromMonth: string;
  toMonth: string;
  documents: PnlDocument[];
  commitments: PnlCommitment[];
  rendiciones?: PnlRendicion[];
  advanceReturns?: PnlAdvanceReturn[];
  // Compras pendientes (incluso fuera del período) para detectar gastos ya facturados.
  purchaseCandidates?: PnlDocument[];
}): PnlResult => {
  const { fromMonth, toMonth } = params;
  const totals = emptyPnlTotals();
  const monthly = new Map<string, PnlTotals>();
  const expenseItems: PnlExpenseItem[] = [];
  const warnings: PnlWarning[] = [];

  const monthTotals = (month: string) => {
    const current = monthly.get(month) || emptyPnlTotals();
    monthly.set(month, current);
    return current;
  };

  for (const document of params.documents) {
    const month = monthOf(document.fecha_emision);
    if (!month || !isMonthInRange(month, fromMonth, toMonth)) continue;
    addDocumentToTotals(totals, document);
    addDocumentToTotals(monthTotals(month), document);
    if (!hasTaxBreakdown(document)) {
      warnings.push({
        kind: "missing_breakdown",
        documentId: document.id,
        message: `Documento ${document.numero_documento || "sin folio"} (${document.tercero_nombre || "sin tercero"}) sin neto/exento: se usó el total con IVA.`,
      });
    }
    if ((toNumber(document.monto) ?? 0) < 0 && (document.tipo === "venta" || document.tipo === "compra")) {
      warnings.push({
        kind: "negative_document",
        documentId: document.id,
        message: `Documento ${document.numero_documento || "sin folio"} (${document.tercero_nombre || "sin tercero"}) tiene monto negativo: probablemente es una nota de crédito cargada como ${document.tipo}.`,
      });
    }
  }

  // Los pagos cubiertos por facturas quedan en el detalle con monto 0 para poder revisarlos.
  const addExpense = (item: PnlExpenseItem) => {
    totals.expenses[item.line] += item.amount;
    monthTotals(item.month).expenses[item.line] += item.amount;
    expenseItems.push(item);
  };

  const usedCandidateIds = new Set<string>();
  for (const commitment of params.commitments) {
    const line = PNL_CATEGORY_LINES[commitment.categoryCode];
    const month = effectiveAccrualMonth(commitment);
    if (!line || !month || !isMonthInRange(month, fromMonth, toMonth)) continue;
    const amount = commitmentPnlAmount(commitment);
    const notes: string[] = [];
    if (commitment.movementCoveredByInvoice) notes.push("El pago está aplicado a una factura: el gasto ya está en compras");
    if (commitment.linkedInvoicesGross > 0) notes.push(`Descuenta facturas vinculadas por ${commitment.linkedInvoicesGross}`);
    if (commitment.pnlAmount != null && commitment.pnlAmount !== commitment.amount) notes.push("Monto devengado distinto al pagado");
    addExpense({
      id: commitment.id,
      source: "commitment",
      line,
      month,
      date: commitment.movementDate || commitment.expectedDate || commitment.dueDate,
      description: commitment.description,
      counterparty: commitment.counterparty,
      paidAmount: commitment.amount,
      amount,
      note: notes.join(" · ") || null,
    });

    if (amount > 0 && commitment.linkedInvoicesGross === 0 && params.purchaseCandidates?.length) {
      const paymentDate = commitment.movementDate || commitment.expectedDate || commitment.dueDate;
      const match = paymentDate
        ? params.purchaseCandidates.find(
            (candidate) =>
              !usedCandidateIds.has(candidate.id) &&
              candidate.tipo === "compra" &&
              candidate.fecha_emision &&
              documentGrossCandidates(candidate).some((gross) => Math.abs(gross - commitment.amount) <= 1) &&
              daysBetween(paymentDate, candidate.fecha_emision) >= -30 &&
              daysBetween(paymentDate, candidate.fecha_emision) <= 60
          )
        : undefined;
      if (match) {
        usedCandidateIds.add(match.id);
        warnings.push({
          kind: "possible_duplicate",
          commitmentId: commitment.id,
          documentId: match.id,
          message: `Gasto "${commitment.description}" por ${commitment.amount} coincide con la factura de compra ${match.numero_documento || "sin folio"} de ${match.tercero_nombre || "sin proveedor"}: si es la misma, vincúlala para no contarla dos veces.`,
        });
      }
    }
  }

  for (const rendicion of params.rendiciones || []) {
    const month = monthOf(rendicion.fecha);
    if (!month || !isMonthInRange(month, fromMonth, toMonth)) continue;
    addExpense({
      id: rendicion.id,
      source: "rendicion",
      line: "reimbursements",
      month,
      date: rendicion.fecha,
      description: rendicion.descripcion || "Rendición",
      counterparty: rendicion.terceroNombre,
      paidAmount: rendicion.montoTotal,
      amount: Math.max(0, roundPesos(rendicion.montoTotal - rendicion.linkedInvoicesGross)),
      note: rendicion.linkedInvoicesGross > 0 ? `Descuenta facturas vinculadas por ${rendicion.linkedInvoicesGross}` : null,
    });
  }

  // El anticipo entregado se registró como rendición por el total; lo devuelto no fue gasto.
  for (const advance of params.advanceReturns || []) {
    const month = monthOf(advance.returnedAt);
    if (!month || !isMonthInRange(month, fromMonth, toMonth)) continue;
    addExpense({
      id: advance.id,
      source: "advance_return",
      line: "reimbursements",
      month,
      date: advance.returnedAt,
      description: "Devolución de saldo de anticipo",
      counterparty: advance.workerName,
      paidAmount: -advance.amount,
      amount: -advance.amount,
      note: null,
    });
  }

  return { totals, monthly, expenseItems, warnings };
};

// Valida y arma el desglose tributario de un documento editado a mano. Campos vacíos = sin desglose.
// Devuelve un error si neto + exento + IVA (+ impuestos de costo ya registrados) no cuadra con el total.
export const parseTaxBreakdown = (params: {
  total: number;
  neto: string;
  exento: string;
  iva: string;
  otherTaxes?: number;
}): { monto_neto: number | null; monto_exento: number | null; monto_iva: number | null } | { error: string } => {
  const parse = (value: string) => (value.trim() === "" ? null : Number(value));
  const neto = parse(params.neto);
  const exento = parse(params.exento);
  const iva = parse(params.iva);
  if ([neto, exento, iva].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
    return { error: "Neto, exento e IVA deben ser montos válidos (o quedar vacíos)." };
  }
  if (neto === null && exento === null) {
    if (iva !== null) return { error: "Si indicas IVA, indica también el neto o el exento." };
    return { monto_neto: null, monto_exento: null, monto_iva: null };
  }
  const sum = (neto ?? 0) + (exento ?? 0) + (iva ?? 0) + (params.otherTaxes ?? 0);
  if (Math.abs(sum - params.total) > 2) {
    return { error: `Neto + exento + IVA suman ${sum} y el total es ${params.total}. Corrige el desglose para que el P/L sea exacto.` };
  }
  return { monto_neto: neto ?? 0, monto_exento: exento ?? 0, monto_iva: iva ?? 0 };
};
