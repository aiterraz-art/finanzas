ALTER TABLE public.facturas
ADD COLUMN IF NOT EXISTS tipo_documento TEXT,
ADD COLUMN IF NOT EXISTS nombre_documento TEXT,
ADD COLUMN IF NOT EXISTS vendedor_asignado TEXT;

