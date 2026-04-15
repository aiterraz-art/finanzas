import { describe, expect, it } from "vitest";
import {
  buildBankSourceHash,
  canEditTreasury,
  normalizeBankImportRow,
  normalizeDateInput,
  normalizeMoneyInput,
} from "@/lib/treasury";

describe("treasury helpers", () => {
  it("normalizes money values from Chilean formatted strings", () => {
    expect(normalizeMoneyInput("1.250.000")).toBe(1250000);
    expect(normalizeMoneyInput("45,7")).toBe(45.7);
    expect(normalizeMoneyInput("")).toBe(0);
  });

  it("normalizes dates from strings and Excel serial numbers", () => {
    expect(normalizeDateInput("15/04/2026")).toBe("2026-04-15");
    expect(normalizeDateInput("2026-04-15")).toBe("2026-04-15");
    expect(normalizeDateInput(46023)).toBe("2026-01-01");
  });

  it("builds deterministic bank source hashes", () => {
    const hashA = buildBankSourceHash({
      bankAccountId: "acc-1",
      fechaMovimiento: "2026-04-15",
      descripcion: "Transferencia Cliente",
      monto: 150000,
      saldo: 300000,
      numeroOperacion: "OP-99",
    });
    const hashB = buildBankSourceHash({
      bankAccountId: "acc-1",
      fechaMovimiento: "2026-04-15",
      descripcion: "Transferencia Cliente",
      monto: 150000,
      saldo: 300000,
      numeroOperacion: "OP-99",
    });

    expect(hashA).toBe(hashB);
  });

  it("parses bank import rows into treasury movements", () => {
    const parsed = normalizeBankImportRow(
      {
        Fecha: "15/04/2026",
        Descripcion: "Pago proveedor",
        Cargo: "125.000",
        Saldo: "1.350.000",
        Referencia: "REF-1",
        CentroCosto: "Clínica Norte",
      },
      "acc-1"
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.fechaMovimiento).toBe("2026-04-15");
    expect(parsed?.monto).toBe(-125000);
    expect(parsed?.salidaBanco).toBe(125000);
    expect(parsed?.columnasExtra.CentroCosto).toBe("Clínica Norte");
  });

  it("flags viewer as read only", () => {
    expect(canEditTreasury("viewer")).toBe(false);
    expect(canEditTreasury("manager")).toBe(true);
    expect(canEditTreasury("admin")).toBe(true);
  });
});
