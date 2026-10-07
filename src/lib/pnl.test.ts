import { describe, expect, it } from "vitest";
import {
  buildPnl,
  commitmentPnlAmount,
  documentPnlAmount,
  effectiveAccrualMonth,
  expenseFromTotals,
  incomeFromTotals,
  parseTaxBreakdown,
  type PnlCommitment,
  type PnlDocument,
} from "@/lib/pnl";

const doc = (overrides: Partial<PnlDocument>): PnlDocument => ({
  id: overrides.id || "doc",
  tipo: "venta",
  numero_documento: "1",
  tercero_nombre: "Cliente",
  fecha_emision: "2026-08-10",
  monto: 119000,
  monto_neto: 100000,
  monto_exento: 0,
  estado: "pendiente",
  ...overrides,
});

const commitment = (overrides: Partial<PnlCommitment>): PnlCommitment => ({
  id: overrides.id || "cc",
  categoryCode: "payroll",
  description: "Pago",
  counterparty: null,
  amount: 100000,
  pnlAmount: null,
  accrualMonth: "2026-08-01",
  movementDate: "2026-08-05",
  expectedDate: "2026-08-05",
  dueDate: "2026-08-05",
  linkedInvoicesGross: 0,
  movementCoveredByInvoice: false,
  ...overrides,
});

const pnl = (params: Partial<Parameters<typeof buildPnl>[0]>) =>
  buildPnl({ fromMonth: "2026-08", toMonth: "2026-08", documents: [], commitments: [], ...params });

describe("documentos", () => {
  it("usa neto + exento y deja el IVA fuera", () => {
    expect(documentPnlAmount(doc({ monto: 129000, monto_neto: 100000, monto_exento: 10000 }))).toBe(110000);
  });

  it("usa el total cuando no hay desglose y lo advierte", () => {
    const result = pnl({ documents: [doc({ monto_neto: null, monto_exento: null })] });
    expect(result.totals.sales).toBe(119000);
    expect(result.warnings.map((warning) => warning.kind)).toContain("missing_breakdown");
  });

  it("suma IVA no recuperable y otros impuestos al costo de compras", () => {
    const purchase = doc({ tipo: "compra", monto: 130000, monto_neto: 100000, monto_exento: 0, monto_iva_no_recuperable: 19000, monto_otros_impuestos: 11000 });
    expect(documentPnlAmount(purchase)).toBe(130000);
  });

  it("no aplica IVA no recuperable a ventas", () => {
    expect(documentPnlAmount(doc({ monto_iva_no_recuperable: 19000 }))).toBe(100000);
  });

  it("resta las notas de crédito aunque estén guardadas con signo negativo", () => {
    const result = pnl({
      documents: [
        doc({ id: "v", monto_neto: 100000 }),
        doc({ id: "nc", tipo: "nota_credito", monto: -11900, monto_neto: -10000 }),
        doc({ id: "c", tipo: "compra", monto_neto: 50000 }),
        doc({ id: "ncc", tipo: "nota_credito_compra", monto_neto: 5000 }),
      ],
    });
    expect(incomeFromTotals(result.totals)).toBe(90000);
    expect(expenseFromTotals(result.totals)).toBe(45000);
  });

  it("una venta negativa (NC cargada como venta) resta ventas y se advierte", () => {
    const result = pnl({ documents: [doc({ id: "v", monto: 119000, monto_neto: null, monto_exento: null }), doc({ id: "n", monto: -11900, monto_neto: null, monto_exento: null })] });
    expect(result.totals.sales).toBe(107100);
    expect(result.warnings.some((warning) => warning.kind === "negative_document" && warning.documentId === "n")).toBe(true);
  });

  it("ignora documentos fuera del rango", () => {
    const result = pnl({ documents: [doc({ fecha_emision: "2026-07-31" }), doc({ id: "b", fecha_emision: "2026-09-01" })] });
    expect(result.totals.sales).toBe(0);
  });
});

describe("gastos pagados", () => {
  it("usa el mes de devengo y, si falta, el del pago bancario", () => {
    expect(effectiveAccrualMonth(commitment({ accrualMonth: "2026-07-01", movementDate: "2026-08-05" }))).toBe("2026-07");
    expect(effectiveAccrualMonth(commitment({ accrualMonth: null, movementDate: "2026-08-05" }))).toBe("2026-08");
    expect(effectiveAccrualMonth(commitment({ accrualMonth: null, movementDate: null, expectedDate: "2026-06-30" }))).toBe("2026-06");
  });

  it("incluye remuneraciones conciliadas sin mes de devengo", () => {
    const result = pnl({ commitments: [commitment({ accrualMonth: null })] });
    expect(result.totals.expenses.payroll).toBe(100000);
  });

  it("incluye gastos sin factura de otras categorías", () => {
    const result = pnl({
      commitments: [
        commitment({ id: "a", categoryCode: "rent", accrualMonth: null, amount: 1588644 }),
        commitment({ id: "b", categoryCode: "fuel", accrualMonth: null, amount: 10000 }),
        commitment({ id: "c", categoryCode: "bank_fees", accrualMonth: null, amount: 5000 }),
      ],
    });
    expect(result.totals.expenses.premises).toBe(1588644);
    expect(result.totals.expenses.mobility).toBe(10000);
    expect(result.totals.expenses.bank_fees).toBe(5000);
  });

  it("excluye IVA/impuestos, traspasos y capex", () => {
    const result = pnl({
      commitments: ["taxes", "internal_transfers", "capex"].map((code) => commitment({ id: code, categoryCode: code })),
    });
    expect(expenseFromTotals(result.totals)).toBe(0);
  });

  it("de una cuota de crédito solo cuenta el interés informado", () => {
    expect(commitmentPnlAmount(commitment({ categoryCode: "debt_service", amount: 500000 }))).toBe(0);
    expect(commitmentPnlAmount(commitment({ categoryCode: "debt_service", amount: 500000, pnlAmount: 42000 }))).toBe(42000);
  });

  it("usa el bruto de la boleta de honorarios cuando se informa", () => {
    expect(commitmentPnlAmount(commitment({ categoryCode: "professional_fees", amount: 847500, pnlAmount: 1000000 }))).toBe(1000000);
  });

  it("descuenta las facturas vinculadas para no duplicar el gasto", () => {
    const result = pnl({
      documents: [doc({ id: "f", tipo: "compra", monto: 54990, monto_neto: 46210 })],
      commitments: [commitment({ categoryCode: "reimbursements", amount: 60000, linkedInvoicesGross: 54990 })],
    });
    expect(result.totals.purchases).toBe(46210);
    expect(result.totals.expenses.reimbursements).toBe(5010);
  });

  it("excluye el gasto cuando el movimiento ya pagó una factura", () => {
    expect(commitmentPnlAmount(commitment({ movementCoveredByInvoice: true }))).toBe(0);
  });

  it("advierte un posible duplicado con una compra del mismo monto", () => {
    const result = pnl({
      commitments: [commitment({ id: "rent", categoryCode: "rent", amount: 1622705, movementDate: "2026-08-06" })],
      purchaseCandidates: [doc({ id: "f210", tipo: "compra", monto: 1622705, fecha_emision: "2026-08-06" })],
    });
    const duplicate = result.warnings.find((warning) => warning.kind === "possible_duplicate");
    expect(duplicate).toMatchObject({ commitmentId: "rent", documentId: "f210" });
  });

  it("reconoce el duplicado aunque el total de la factura esté mal tipeado", () => {
    const result = pnl({
      commitments: [commitment({ id: "flete", categoryCode: "logistics", amount: 433603, movementDate: "2026-08-24" })],
      purchaseCandidates: [doc({ id: "chx", tipo: "compra", monto: 433.6, monto_neto: 364372, monto_exento: 0, monto_iva: 69231, fecha_emision: "2026-08-03" })],
    });
    expect(result.warnings.find((warning) => warning.kind === "possible_duplicate")).toMatchObject({ commitmentId: "flete", documentId: "chx" });
  });

  it("no usa la misma factura para advertir dos gastos", () => {
    const result = pnl({
      commitments: [commitment({ id: "a", amount: 20000 }), commitment({ id: "b", amount: 20000 })],
      purchaseCandidates: [doc({ id: "f", tipo: "compra", monto: 20000 })],
    });
    expect(result.warnings.filter((warning) => warning.kind === "possible_duplicate")).toHaveLength(1);
  });
});

describe("rendiciones", () => {
  it("incluye rendiciones del módulo y resta devoluciones de anticipos", () => {
    const result = pnl({
      rendiciones: [{ id: "r", fecha: "2026-08-12", montoTotal: 30000, terceroNombre: "Ana", descripcion: null, linkedInvoicesGross: 10000 }],
      advanceReturns: [{ id: "d", returnedAt: "2026-08-20", amount: 2047, workerName: "Juan" }],
    });
    expect(result.totals.expenses.reimbursements).toBe(20000 - 2047);
  });

  it("arma el desglose mensual", () => {
    const result = buildPnl({
      fromMonth: "2026-07",
      toMonth: "2026-08",
      documents: [doc({ fecha_emision: "2026-07-10" }), doc({ id: "b", fecha_emision: "2026-08-10" })],
      commitments: [commitment({ accrualMonth: "2026-07-01" })],
    });
    expect(result.monthly.get("2026-07")?.sales).toBe(100000);
    expect(result.monthly.get("2026-07")?.expenses.payroll).toBe(100000);
    expect(result.monthly.get("2026-08")?.sales).toBe(100000);
  });
});

describe("desglose manual", () => {
  it("acepta un desglose que cuadra con el total", () => {
    expect(parseTaxBreakdown({ total: 119000, neto: "100000", exento: "", iva: "19000" })).toEqual({ monto_neto: 100000, monto_exento: 0, monto_iva: 19000 });
  });

  it("rechaza un desglose que no cuadra", () => {
    expect(parseTaxBreakdown({ total: 150000, neto: "100000", exento: "", iva: "19000" })).toHaveProperty("error");
  });

  it("permite dejar el documento sin desglose", () => {
    expect(parseTaxBreakdown({ total: 150000, neto: "", exento: "", iva: "" })).toEqual({ monto_neto: null, monto_exento: null, monto_iva: null });
  });
});
