export type TaxBreakdownValue = { neto: string; exento: string; iva: string };

export const emptyTaxBreakdown = (): TaxBreakdownValue => ({ neto: "", exento: "", iva: "" });

export const taxBreakdownFromInvoice = (invoice: { monto_neto?: number | null; monto_exento?: number | null; monto_iva?: number | null }): TaxBreakdownValue => ({
  neto: invoice.monto_neto == null ? "" : String(invoice.monto_neto),
  exento: invoice.monto_exento == null ? "" : String(invoice.monto_exento),
  iva: invoice.monto_iva == null ? "" : String(invoice.monto_iva),
});
