import { addDays, endOfMonth, format } from "date-fns";
import { supabase } from "@/lib/supabase";
import {
  PNL_CATEGORY_CODES,
  type PnlAdvanceReturn,
  type PnlCommitment,
  type PnlDocument,
  type PnlRendicion,
} from "@/lib/pnl";

const PAGE_SIZE = 1000;
const IN_CHUNK_SIZE = 150;

// PostgREST corta en 1000 filas: sin paginar, un rango largo perdía los últimos meses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fetchAllRows = async <T>(buildQuery: () => any): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
};

// Evita URLs demasiado largas en filtros .in() con muchos ids.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchByIds = async <T>(ids: string[], buildQuery: (chunk: string[]) => any): Promise<T[]> => {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const rows: T[] = [];
  for (let index = 0; index < unique.length; index += IN_CHUNK_SIZE) {
    rows.push(...(await fetchAllRows<T>(() => buildQuery(unique.slice(index, index + IN_CHUNK_SIZE)))));
  }
  return rows;
};

const DOCUMENT_COLUMNS =
  "id, tipo, numero_documento, tercero_nombre, fecha_emision, monto, monto_neto, monto_exento, monto_iva, monto_iva_no_recuperable, monto_otros_impuestos, estado";

export type PnlInvoiceLink = {
  id: string;
  facturaId: string;
  cashCommitmentId: string | null;
  rendicionId: string | null;
  facturaEstadoPrevio: string | null;
  numeroDocumento: string | null;
  terceroNombre: string | null;
  monto: number;
};

export type PnlData = {
  documents: PnlDocument[];
  commitments: PnlCommitment[];
  rendiciones: PnlRendicion[];
  advanceReturns: PnlAdvanceReturn[];
  purchaseCandidates: PnlDocument[];
  links: PnlInvoiceLink[];
};

const monthRange = (fromMonth: string, toMonth: string) => {
  const fromDate = `${fromMonth}-01`;
  const toDate = format(endOfMonth(new Date(`${toMonth}-01T12:00:00`)), "yyyy-MM-dd");
  return { fromDate, toDate };
};

type CommitmentRow = {
  id: string;
  movimiento_banco_id: string | null;
  description: string | null;
  counterparty: string | null;
  amount: number | string | null;
  pnl_amount: number | string | null;
  accrual_month: string | null;
  expected_date: string | null;
  due_date: string | null;
  treasury_categories: { code: string } | Array<{ code: string }> | null;
  movimientos_banco: { fecha_movimiento: string } | Array<{ fecha_movimiento: string }> | null;
};

type LinkRow = {
  id: string;
  factura_id: string;
  cash_commitment_id: string | null;
  rendicion_id: string | null;
  factura_estado_previo: string | null;
  facturas: LinkedInvoice | LinkedInvoice[] | null;
};
type LinkedInvoice = { numero_documento: string | null; tercero_nombre: string | null; monto: number | string | null };
type RendicionRow = { id: string; fecha: string; monto_total: number | string | null; tercero_nombre: string | null; descripcion: string | null };
type AdvanceRow = { id: string; worker_name: string; amount: number | string | null; returned_at: string };

const firstOf = <T>(value: T | T[] | null | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export const loadPnlData = async (empresaId: string, fromMonth: string, toMonth: string): Promise<PnlData> => {
  const { fromDate, toDate } = monthRange(fromMonth, toMonth);

  const [documents, commitmentRows, linkRows, renditionPayments, advanceRows] = await Promise.all([
    fetchAllRows<PnlDocument>(() =>
      supabase
        .from("facturas")
        .select(DOCUMENT_COLUMNS)
        .eq("empresa_id", empresaId)
        .in("tipo", ["venta", "compra", "nota_credito", "nota_credito_compra"])
        .gte("fecha_emision", fromDate)
        .lte("fecha_emision", toDate)
        .is("archived_at", null)
        .order("fecha_emision", { ascending: true })
        .order("id", { ascending: true })
    ),
    // Se traen todos los gastos pagados: el mes de devengo puede faltar y entonces se usa la fecha
    // del pago bancario, que no se puede filtrar en la misma consulta.
    fetchAllRows<CommitmentRow>(() =>
      supabase
        .from("cash_commitments")
        .select("id, movimiento_banco_id, description, counterparty, amount, pnl_amount, accrual_month, expected_date, due_date, treasury_categories!inner(code), movimientos_banco(fecha_movimiento)")
        .eq("empresa_id", empresaId)
        .eq("status", "paid")
        .eq("direction", "outflow")
        .in("treasury_categories.code", PNL_CATEGORY_CODES)
        .is("archived_at", null)
        .order("id", { ascending: true })
    ),
    fetchAllRows<LinkRow>(() =>
      supabase
        .from("pnl_invoice_links")
        .select("id, factura_id, cash_commitment_id, rendicion_id, factura_estado_previo, facturas(numero_documento, tercero_nombre, monto)")
        .eq("empresa_id", empresaId)
        .order("id", { ascending: true })
    ),
    fetchAllRows<{ rendicion_id: string }>(() =>
      supabase
        .from("facturas_pagos")
        .select("rendicion_id")
        .eq("empresa_id", empresaId)
        .eq("estado", "aplicado")
        .not("rendicion_id", "is", null)
        .order("id", { ascending: true })
    ),
    fetchAllRows<AdvanceRow>(() =>
      supabase
        .from("rendition_advances")
        .select("id, worker_name, amount, returned_at, status, return_movement_id")
        .eq("empresa_id", empresaId)
        .eq("status", "settled")
        .not("return_movement_id", "is", null)
        .gte("returned_at", fromDate)
        .lte("returned_at", toDate)
        .order("id", { ascending: true })
    ),
  ]);

  const links: PnlInvoiceLink[] = linkRows.map((row) => {
    const factura = firstOf(row.facturas);
    return {
      id: row.id,
      facturaId: row.factura_id,
      cashCommitmentId: row.cash_commitment_id,
      rendicionId: row.rendicion_id,
      facturaEstadoPrevio: row.factura_estado_previo,
      numeroDocumento: factura?.numero_documento ?? null,
      terceroNombre: factura?.tercero_nombre ?? null,
      monto: Number(factura?.monto || 0),
    };
  });
  const linkedGrossByCommitment = new Map<string, number>();
  const linkedGrossByRendicion = new Map<string, number>();
  for (const link of links) {
    if (link.cashCommitmentId) linkedGrossByCommitment.set(link.cashCommitmentId, (linkedGrossByCommitment.get(link.cashCommitmentId) || 0) + link.monto);
    if (link.rendicionId) linkedGrossByRendicion.set(link.rendicionId, (linkedGrossByRendicion.get(link.rendicionId) || 0) + link.monto);
  }

  const movementIds = commitmentRows.map((row) => row.movimiento_banco_id).filter((id): id is string => Boolean(id));
  const invoicePayments = await fetchByIds<{ id: string; movimiento_banco_id: string }>(movementIds, (chunk) =>
    supabase
      .from("facturas_pagos")
      .select("id, movimiento_banco_id")
      .eq("empresa_id", empresaId)
      .eq("estado", "aplicado")
      .not("factura_id", "is", null)
      .in("movimiento_banco_id", chunk)
      .order("id", { ascending: true })
  );
  const movementsCoveredByInvoice = new Set(invoicePayments.map((payment) => payment.movimiento_banco_id));

  const commitments: PnlCommitment[] = commitmentRows.map((row) => {
    const category = firstOf(row.treasury_categories);
    const movement = firstOf(row.movimientos_banco);
    return {
      id: row.id,
      categoryCode: category?.code || "",
      description: row.description || "Sin descripción",
      counterparty: row.counterparty || null,
      amount: Number(row.amount || 0),
      pnlAmount: row.pnl_amount == null ? null : Number(row.pnl_amount),
      accrualMonth: row.accrual_month || null,
      movementDate: movement?.fecha_movimiento || null,
      expectedDate: row.expected_date || null,
      dueDate: row.due_date || null,
      linkedInvoicesGross: linkedGrossByCommitment.get(row.id) || 0,
      movementCoveredByInvoice: Boolean(row.movimiento_banco_id && movementsCoveredByInvoice.has(row.movimiento_banco_id)),
    };
  });

  const paidRendicionIds = renditionPayments.map((row) => row.rendicion_id);
  const rendicionRows = await fetchByIds<RendicionRow>(paidRendicionIds, (chunk) =>
    supabase
      .from("rendiciones")
      .select("id, fecha, monto_total, tercero_nombre, descripcion")
      .eq("empresa_id", empresaId)
      .is("archived_at", null)
      .gte("fecha", fromDate)
      .lte("fecha", toDate)
      .in("id", chunk)
      .order("id", { ascending: true })
  );
  const rendiciones: PnlRendicion[] = rendicionRows.map((row) => ({
    id: row.id,
    fecha: row.fecha,
    montoTotal: Number(row.monto_total || 0),
    terceroNombre: row.tercero_nombre || null,
    descripcion: row.descripcion || null,
    linkedInvoicesGross: linkedGrossByRendicion.get(row.id) || 0,
  }));

  const advanceReturns: PnlAdvanceReturn[] = advanceRows.map((row) => ({
    id: row.id,
    returnedAt: row.returned_at,
    amount: Number(row.amount || 0),
    workerName: row.worker_name,
  }));

  // Compras aún no pagadas ni vinculadas, cercanas al período, para advertir gastos ya facturados.
  const linkedFacturaIds = new Set(links.map((link) => link.facturaId));
  const purchaseCandidates = (
    await fetchAllRows<PnlDocument>(() =>
      supabase
        .from("facturas")
        .select(DOCUMENT_COLUMNS)
        .eq("empresa_id", empresaId)
        .eq("tipo", "compra")
        .is("archived_at", null)
        .neq("estado", "pagada")
        .gte("fecha_emision", format(addDays(new Date(`${fromDate}T12:00:00`), -60), "yyyy-MM-dd"))
        .lte("fecha_emision", format(addDays(new Date(`${toDate}T12:00:00`), 30), "yyyy-MM-dd"))
        .order("fecha_emision", { ascending: true })
        .order("id", { ascending: true })
    )
  ).filter((document) => !linkedFacturaIds.has(document.id));

  return { documents, commitments, rendiciones, advanceReturns, purchaseCandidates, links };
};

// Vincula una factura de compra a un gasto pagado: la factura queda en compras (sin IVA) y el gasto
// descuenta su total. La factura queda pagada porque se pagó con ese movimiento.
export const linkInvoiceToCommitment = async (params: {
  empresaId: string;
  facturaId: string;
  cashCommitmentId: string;
  userId: string | null;
}) => {
  const { data: factura, error: facturaError } = await supabase
    .from("facturas")
    .select("estado")
    .eq("id", params.facturaId)
    .eq("empresa_id", params.empresaId)
    .single();
  if (facturaError) throw facturaError;

  const { error: linkError } = await supabase.from("pnl_invoice_links").insert({
    empresa_id: params.empresaId,
    factura_id: params.facturaId,
    cash_commitment_id: params.cashCommitmentId,
    factura_estado_previo: factura?.estado ?? null,
    created_by: params.userId,
  });
  if (linkError) throw linkError;

  const { error: updateError } = await supabase
    .from("facturas")
    .update({ estado: "pagada" })
    .eq("id", params.facturaId)
    .eq("empresa_id", params.empresaId);
  if (updateError) throw updateError;
};

export const unlinkInvoice = async (params: { empresaId: string; link: PnlInvoiceLink }) => {
  const { error: deleteError } = await supabase
    .from("pnl_invoice_links")
    .delete()
    .eq("id", params.link.id)
    .eq("empresa_id", params.empresaId);
  if (deleteError) throw deleteError;

  const { error: updateError } = await supabase
    .from("facturas")
    .update({ estado: params.link.facturaEstadoPrevio || "pendiente" })
    .eq("id", params.link.facturaId)
    .eq("empresa_id", params.empresaId);
  if (updateError) throw updateError;
};

// Al deshacer la conciliación de un gasto, sus facturas vinculadas vuelven a su estado anterior.
export const unlinkInvoicesForCommitment = async (empresaId: string, cashCommitmentId: string) => {
  const { data, error } = await supabase
    .from("pnl_invoice_links")
    .select("id, factura_id, cash_commitment_id, rendicion_id, factura_estado_previo")
    .eq("empresa_id", empresaId)
    .eq("cash_commitment_id", cashCommitmentId);
  if (error) throw error;
  for (const row of data || []) {
    await unlinkInvoice({
      empresaId,
      link: {
        id: row.id,
        facturaId: row.factura_id,
        cashCommitmentId: row.cash_commitment_id,
        rendicionId: row.rendicion_id,
        facturaEstadoPrevio: row.factura_estado_previo,
        numeroDocumento: null,
        terceroNombre: null,
        monto: 0,
      },
    });
  }
};

export const updateCommitmentPnlAmount = async (empresaId: string, cashCommitmentId: string, pnlAmount: number | null) => {
  const { error } = await supabase
    .from("cash_commitments")
    .update({ pnl_amount: pnlAmount })
    .eq("id", cashCommitmentId)
    .eq("empresa_id", empresaId);
  if (error) throw error;
};
