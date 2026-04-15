import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  normalizeBankAccount,
  normalizeBankAccountPosition,
  normalizeCashCommitmentTemplate,
  normalizeCashCommitment,
  normalizeChequeReceivable,
  normalizeCollectionPipelineItem,
  normalizePaymentQueueItem,
  normalizeTreasuryCategory,
  normalizeTreasuryKpis,
  normalizeTreasuryOpenItem,
  normalizeTreasuryPolicy,
  normalizeTreasuryWeek,
  normalizeWebpayReceivable,
} from "@/lib/treasury";
import type {
  BankAccount,
  BankAccountPosition,
  CashCommitment,
  CashCommitmentTemplate,
  ChequeReceivable,
  CollectionPipelineItem,
  PaymentQueueItem,
  TreasuryCategory,
  TreasuryKpis,
  TreasuryOpenItem,
  TreasuryPolicy,
  TreasuryWeek,
  WebpayReceivable,
} from "@/lib/treasury";

type TreasuryQueryState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const readMaybeArray = <T,>(data: any, mapper: (row: any) => T): T[] => {
  if (!Array.isArray(data)) return [];
  return data.map(mapper);
};

const readSingleRow = <T,>(data: any, mapper: (row: any) => T, fallback: T): T => {
  if (Array.isArray(data)) {
    return data[0] ? mapper(data[0]) : fallback;
  }
  return data ? mapper(data) : fallback;
};

const useTreasuryLoader = <T,>(
  empresaId: string | null,
  initialData: T,
  deps: unknown[],
  loader: (empresaId: string) => Promise<T>
): TreasuryQueryState<T> => {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(Boolean(empresaId));
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!empresaId) {
      setData(initialData);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextData = await loader(empresaId);
      setData(nextData);
    } catch (err: any) {
      console.error("Treasury query error:", err);
      setError(err?.message || "No se pudo cargar el modulo de tesoreria.");
      setData(initialData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, ...deps]);

  return { data, loading, error, refresh };
};

export const useTreasuryKpis = (empresaId: string | null, asOfDate: string) =>
  useTreasuryLoader<TreasuryKpis>(
    empresaId,
    normalizeTreasuryKpis(null),
    [asOfDate],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase.rpc("get_treasury_kpis", {
        p_empresa_id: resolvedEmpresaId,
        p_as_of: asOfDate,
      });
      if (error) throw error;
      return readSingleRow(data, normalizeTreasuryKpis, normalizeTreasuryKpis(null));
    }
  );

export const useTreasuryForecast = (empresaId: string | null, asOfDate: string, weeks: number) =>
  useTreasuryLoader<TreasuryWeek[]>(
    empresaId,
    [],
    [asOfDate, weeks],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase.rpc("get_treasury_forecast", {
        p_empresa_id: resolvedEmpresaId,
        p_as_of: asOfDate,
        p_weeks: weeks,
      });
      if (error) throw error;
      return readMaybeArray(data, normalizeTreasuryWeek);
    }
  );

export const usePaymentQueue = (empresaId: string | null, asOfDate: string) =>
  useTreasuryLoader<PaymentQueueItem[]>(
    empresaId,
    [],
    [asOfDate],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase.rpc("get_payment_queue", {
        p_empresa_id: resolvedEmpresaId,
        p_as_of: asOfDate,
      });
      if (error) throw error;
      return readMaybeArray(data, normalizePaymentQueueItem);
    }
  );

export const useCollectionPipeline = (empresaId: string | null, asOfDate: string) =>
  useTreasuryLoader<CollectionPipelineItem[]>(
    empresaId,
    [],
    [asOfDate],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase.rpc("get_collection_pipeline", {
        p_empresa_id: resolvedEmpresaId,
        p_as_of: asOfDate,
      });
      if (error) throw error;
      return readMaybeArray(data, normalizeCollectionPipelineItem);
    }
  );

export const useBankAccountPositions = (empresaId: string | null) =>
  useTreasuryLoader<BankAccountPosition[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("v_bank_account_positions")
        .select("*")
        .eq("empresa_id", resolvedEmpresaId)
        .order("account_name", { ascending: true });
      if (error) throw error;
      return readMaybeArray(data, normalizeBankAccountPosition);
    }
  );

export const useTreasuryOpenItems = (empresaId: string | null) =>
  useTreasuryLoader<TreasuryOpenItem[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("v_treasury_open_items")
        .select("*")
        .eq("empresa_id", resolvedEmpresaId)
        .order("expected_date", { ascending: true });
      if (error) throw error;
      return readMaybeArray(data, normalizeTreasuryOpenItem);
    }
  );

export const useTreasuryPolicy = (empresaId: string | null) =>
  useTreasuryLoader<TreasuryPolicy>(
    empresaId,
    normalizeTreasuryPolicy(null),
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("treasury_policies")
        .select("*")
        .eq("empresa_id", resolvedEmpresaId)
        .single();
      if (error) throw error;
      return normalizeTreasuryPolicy(data);
    }
  );

export const useBankAccounts = (empresaId: string | null) =>
  useTreasuryLoader<BankAccount[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("empresa_id", resolvedEmpresaId)
        .order("es_principal", { ascending: false })
        .order("nombre", { ascending: true });
      if (error) throw error;
      return readMaybeArray(data, normalizeBankAccount);
    }
  );

export const useTreasuryCategories = (empresaId: string | null) =>
  useTreasuryLoader<TreasuryCategory[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("treasury_categories")
        .select("*")
        .eq("empresa_id", resolvedEmpresaId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return readMaybeArray(data, normalizeTreasuryCategory);
    }
  );

export const useCashCommitmentTemplates = (empresaId: string | null) =>
  useTreasuryLoader<CashCommitmentTemplate[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("cash_commitment_templates")
        .select(`
          *,
          treasury_categories(nombre),
          bank_accounts(nombre)
        `)
        .eq("empresa_id", resolvedEmpresaId)
        .order("next_due_date", { ascending: true });
      if (error) throw error;
      return readMaybeArray(data, normalizeCashCommitmentTemplate);
    }
  );

export const useCashCommitments = (empresaId: string | null) =>
  useTreasuryLoader<CashCommitment[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("cash_commitments")
        .select(`
          *,
          treasury_categories(nombre),
          bank_accounts(nombre)
        `)
        .eq("empresa_id", resolvedEmpresaId)
        .eq("direction", "outflow")
        .order("expected_date", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return readMaybeArray(data, normalizeCashCommitment);
    }
  );

export const useChequeReceivables = (empresaId: string | null) =>
  useTreasuryLoader<ChequeReceivable[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("cheques_cartera")
        .select(`
          *,
          bank_accounts(nombre),
          terceros(razon_social),
          facturas(numero_documento)
        `)
        .eq("empresa_id", resolvedEmpresaId)
        .order("fecha_cobro_esperada", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return readMaybeArray(data, normalizeChequeReceivable);
    }
  );

export const useWebpayReceivables = (empresaId: string | null) =>
  useTreasuryLoader<WebpayReceivable[]>(
    empresaId,
    [],
    [],
    async (resolvedEmpresaId) => {
      const { data, error } = await supabase
        .from("webpay_liquidaciones")
        .select(`
          *,
          bank_accounts(nombre),
          terceros(razon_social),
          facturas(numero_documento)
        `)
        .eq("empresa_id", resolvedEmpresaId)
        .order("fecha_abono_esperada", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return readMaybeArray(data, normalizeWebpayReceivable);
    }
  );
