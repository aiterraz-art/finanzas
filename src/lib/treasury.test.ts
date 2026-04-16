import { describe, expect, it } from "vitest";
import {
  buildObjectsFromWorksheetRows,
  buildBankSourceHash,
  canEditTreasury,
  detectChequeWorksheetFormat,
  detectWorksheetImportFormat,
  normalizeBankImportRow,
  normalizeChequeImportRow,
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

  it("detects bank headers even when metadata rows exist above them", () => {
    const rows = [
      ["Banco Demo", "", ""],
      ["Cuenta Corriente", "", ""],
      ["Fecha", "Descripcion", "Cargo", "Saldo"],
      ["15/04/2026", "Pago proveedor", "125.000", "1.350.000"],
    ];

    const detection = detectWorksheetImportFormat(rows);
    expect(detection.kind).toBe("bank_statement");
    expect(detection.headerRowIndex).toBe(2);

    const objects = buildObjectsFromWorksheetRows(rows, detection.headerRowIndex!);
    const parsed = normalizeBankImportRow(objects[0], "acc-1");
    expect(parsed?.descripcion).toBe("Pago proveedor");
    expect(parsed?.monto).toBe(-125000);
  });

  it("parses the Bci-style movimientos layout with transaccion/contable and ingreso/egreso columns", () => {
    const parsed = normalizeBankImportRow(
      {
        "Fecha Transacción": 46126,
        "Fecha Contable": 46127,
        "Descripción": "Pago recibido de TRANSBANK S.A.",
        "Egreso (-)": "",
        "Ingreso (+)": 1168192,
        Saldo: 27545807,
      },
      "acc-1"
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.fechaMovimiento).toBe("2026-04-14");
    expect(parsed?.postedAt).toBe("2026-04-15");
    expect(parsed?.descripcion).toBe("Pago recibido de TRANSBANK S.A.");
    expect(parsed?.monto).toBe(1168192);
    expect(parsed?.entradaBanco).toBe(1168192);
    expect(parsed?.salidaBanco).toBe(0);
    expect(parsed?.saldo).toBe(27545807);
  });

  it("detects receivables aging reports and avoids importing them as bank statements", () => {
    const rows = [
      ["3DENTAL SPA"],
      ["Cuentas Por Cobrar - Detallado - Documentos Vencidos"],
      ["Codigo Cliente", "Nombre", "Docto", "Serie", "Numero", "Vencimiento", "( > 90 ) $", "(61 - 90) $", "(31 - 60) $", "( 0 - 30) $", "Saldo $"],
      ["10942793-4", "Fernando Ceron", "FVAELECT", "", 7996, 46101, 0, 0, 0, 290001, 290001],
    ];

    const detection = detectWorksheetImportFormat(rows);
    expect(detection.kind).toBe("receivables_aging_report");
    expect(detection.reason).toContain("cuentas por cobrar");
  });

  it("detects cheque portfolio headers and parses cheque rows", () => {
    const rows = [
      ["N° Cheque", "Monto", "Fecha Recepción", "Fecha de Vencimiento", "Concepto", "RUT", "N° Factura", "Fecha Depósito", "Banco", "Razon Social", "Observaciones", "Cbte Contable"],
      [9231873, 778571, 45937, 46142, "Ingresos Clientes", "17750193-k", 6402, "Por cobrar", "CHILE", "NICOLE FERNANDA CABRERA", "DC", ""],
    ];

    const detection = detectChequeWorksheetFormat(rows);
    expect(detection.kind).toBe("cheque_portfolio");

    const objects = buildObjectsFromWorksheetRows(rows, detection.headerRowIndex!);
    const parsed = normalizeChequeImportRow(objects[0]);
    expect(parsed).not.toBeNull();
    expect(parsed?.numeroCheque).toBe("9231873");
    expect(parsed?.monto).toBe(778571);
    expect(parsed?.fechaRecepcion).toBe("2025-10-07");
    expect(parsed?.fechaVencimiento).toBe("2026-04-30");
    expect(parsed?.rut).toBe("17750193-K");
    expect(parsed?.numeroFactura).toBe("6402");
  });

  it("flags viewer as read only", () => {
    expect(canEditTreasury("viewer")).toBe(false);
    expect(canEditTreasury("manager")).toBe(true);
    expect(canEditTreasury("admin")).toBe(true);
  });
});
