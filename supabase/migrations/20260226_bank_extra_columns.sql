ALTER TABLE public.movimientos_banco
ADD COLUMN IF NOT EXISTS columnas_extra JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.bank_import_column_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    clave TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto', 'numero', 'fecha', 'booleano')),
    activa BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (empresa_id, clave)
);

CREATE INDEX IF NOT EXISTS idx_movimientos_banco_columnas_extra_gin
ON public.movimientos_banco USING GIN (columnas_extra);

CREATE INDEX IF NOT EXISTS idx_bank_import_configs_empresa
ON public.bank_import_column_configs (empresa_id, activa, created_at);

ALTER TABLE public.bank_import_column_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_import_configs_authenticated_select" ON public.bank_import_column_configs;
CREATE POLICY "bank_import_configs_authenticated_select"
ON public.bank_import_column_configs
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "bank_import_configs_authenticated_write" ON public.bank_import_column_configs;
CREATE POLICY "bank_import_configs_authenticated_write"
ON public.bank_import_column_configs
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);
