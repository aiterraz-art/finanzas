import { describe, expect, it } from "vitest";
import {
  buildInvoiceDuplicateKey,
  detectIssuedInvoiceWorksheetFormat,
  detectReceivablesWorksheetFormat,
  inferReceivableEmissionDate,
  normalizeIssuedInvoiceImportRow,
  normalizeReceivableInvoiceImportRow,
} from "@/lib/invoice-import";
import { buildObjectsFromWorksheetRows } from "@/lib/treasury";

describe("invoice import helpers", () => {
  it("detects and parses issued invoice rows", () => {
    const rows = [
      ["Cliente", "RUT", "Folio", "Fecha Emisión", "Fecha Vencimiento", "Monto", "Descripción"],
      ["Laboratorio Uno", "76.123.456-7", 1001, 46127, 46157, "1.250.000", "Trabajos abril"],
    ];

    const detection = detectIssuedInvoiceWorksheetFormat(rows);
    expect(detection.kind).toBe("issued");

    const parsed = normalizeIssuedInvoiceImportRow(
      buildObjectsFromWorksheetRows(rows, detection.headerRowIndex!)[0]
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.numeroDocumento).toBe("1001");
    expect(parsed?.terceroNombre).toBe("Laboratorio Uno");
    expect(parsed?.rut).toBe("76123456-7");
    expect(parsed?.fechaEmision).toBe("2026-04-15");
    expect(parsed?.monto).toBe(1250000);
  });

  it("parses the issued invoice format used by FacturasFlujo exports", () => {
    const rows = [
      ["Tipo Doc", "Nombre Doc", "Nmero del Documento", "C󤩧o del Cliente", "Nombre del Cliente", "Nombre del Vendedor", "Fecha", "Total"],
      ["FACTURAE", "33 Factura Electrónica", "15001", "76.123.456-7", "Cliente Flujo", "Vendedor Uno", "10/13/25", "428487"],
    ];

    const detection = detectIssuedInvoiceWorksheetFormat(rows);
    expect(detection.kind).toBe("issued");

    const parsed = normalizeIssuedInvoiceImportRow(
      buildObjectsFromWorksheetRows(rows, detection.headerRowIndex!)[0]
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.numeroDocumento).toBe("15001");
    expect(parsed?.rut).toBe("76123456-7");
    expect(parsed?.terceroNombre).toBe("Cliente Flujo");
    expect(parsed?.tipoDocumento).toBe("FACTURAE");
    expect(parsed?.nombreDocumento).toBe("33 Factura Electrónica");
    expect(parsed?.vendedorAsignado).toBe("Vendedor Uno");
    expect(parsed?.monto).toBe(428487);
  });

  it("detects and parses receivable invoice rows", () => {
    const rows = [
      ["Cliente", "RUT", "Folio", "Fecha Vencimiento", "Saldo", "Días Mora"],
      ["Cliente Dos", "77.987.654-K", 8899, 46120, "890.000", 12],
    ];

    const detection = detectReceivablesWorksheetFormat(rows);
    expect(detection.kind).toBe("receivables");

    const parsed = normalizeReceivableInvoiceImportRow(
      buildObjectsFromWorksheetRows(rows, detection.headerRowIndex!)[0]
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.numeroDocumento).toBe("8899");
    expect(parsed?.saldoAbierto).toBe(890000);
    expect(parsed?.diasMora).toBe(12);
    expect(parsed?.fechaVencimiento).toBe("2026-04-08");
  });

  it("builds duplicate keys using folio first and fallback when missing", () => {
    const keyed = buildInvoiceDuplicateKey({
      numeroDocumento: "F-22",
      rut: "76123456-7",
      terceroNombre: "Cliente",
      fechaEmision: "2026-04-15",
      monto: 150000,
    });
    const fallback = buildInvoiceDuplicateKey({
      numeroDocumento: null,
      rut: "76123456-7",
      terceroNombre: "Cliente",
      fechaEmision: "2026-04-15",
      monto: 150000,
    });

    expect(keyed).toBe("folio:f-22");
    expect(fallback).toContain("fallback");
  });

  it("infers emission date for pending rows when missing", () => {
    const inferred = inferReceivableEmissionDate({
      numeroDocumento: "4455",
      rut: null,
      terceroNombre: "Cliente Tres",
      fechaEmision: null,
      fechaVencimiento: "2026-05-01",
      monto: 500000,
      saldoAbierto: 500000,
      diasMora: null,
      descripcion: null,
    });

    expect(inferred).toBe("2026-04-01");
  });
});
