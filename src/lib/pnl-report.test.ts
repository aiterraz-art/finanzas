import { describe, expect, it } from "vitest";
import { buildPnl, type PnlCommitment, type PnlDocument } from "@/lib/pnl";
import { buildPnlStatement, monthsBetween } from "@/lib/pnl-report";

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

const payroll = (overrides: Partial<PnlCommitment>): PnlCommitment => ({
  id: overrides.id || "cc",
  categoryCode: "payroll",
  description: "Sueldo",
  counterparty: null,
  amount: 30000,
  pnlAmount: null,
  accrualMonth: "2026-08-01",
  movementDate: "2026-08-05",
  expectedDate: "2026-08-05",
  dueDate: "2026-08-05",
  linkedInvoicesGross: 0,
  movementCoveredByInvoice: false,
  ...overrides,
});

describe("estado de resultados para exportar", () => {
  it("lista los meses del período cruzando años", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("arma meses en columnas, total, % sobre ventas y resultado", () => {
    const pnl = buildPnl({
      fromMonth: "2026-08",
      toMonth: "2026-09",
      documents: [
        doc({ id: "v1" }),
        doc({ id: "v2", fecha_emision: "2026-09-10", monto_neto: 200000 }),
        doc({ id: "c1", tipo: "compra", monto_neto: 40000 }),
      ],
      commitments: [payroll({}), payroll({ id: "cc2", accrualMonth: "2026-09-01" })],
    });
    const statement = buildPnlStatement(pnl, "2026-08", "2026-09");

    expect(statement.months).toEqual(["2026-08", "2026-09"]);
    const byLabel = (label: string) => statement.rows.find((row) => row.label === label)!;
    expect(byLabel("Ingresos netos").values).toEqual([100000, 200000]);
    expect(byLabel("Compras y gastos documentados").values).toEqual([-40000, 0]);
    expect(byLabel("Remuneraciones").total).toBe(-60000);
    expect(byLabel("RESULTADO DEL PERÍODO").values).toEqual([30000, 170000]);
    expect(statement.result).toBe(200000);
    expect(byLabel("Remuneraciones").shareOfIncome).toBeCloseTo(-0.2);
    expect(byLabel("Margen sobre ingresos").values[0]).toBeCloseTo(0.3);
  });

  it("omite líneas de gasto sin movimiento", () => {
    const pnl = buildPnl({ fromMonth: "2026-08", toMonth: "2026-08", documents: [doc({})], commitments: [] });
    const labels = buildPnlStatement(pnl, "2026-08", "2026-08").rows.map((row) => row.label);
    expect(labels).not.toContain("Remuneraciones");
    expect(labels).toContain("Total costos y gastos");
  });
});
