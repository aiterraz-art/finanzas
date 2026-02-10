-- Add payment terms column to terceros table
ALTER TABLE public.terceros 
ADD COLUMN IF NOT EXISTS plazo_pago_dias INTEGER DEFAULT 0;

COMMENT ON COLUMN public.terceros.plazo_pago_dias IS 'Días de plazo para el pago de facturas';
