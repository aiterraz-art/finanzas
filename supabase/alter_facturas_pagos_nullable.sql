-- Permitir que factura_id sea nulo (para cuando se concilia una rendición)
ALTER TABLE public.facturas_pagos 
ALTER COLUMN factura_id DROP NOT NULL;

-- Asegurar que rendicion_id exista (si no lo hace el script anterior)
-- ALTER TABLE public.facturas_pagos ADD COLUMN IF NOT EXISTS rendicion_id uuid REFERENCES public.rendiciones(id);
