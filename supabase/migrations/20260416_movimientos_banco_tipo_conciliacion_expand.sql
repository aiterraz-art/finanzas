ALTER TABLE public.movimientos_banco
DROP CONSTRAINT IF EXISTS movimientos_banco_tipo_conciliacion_check;

ALTER TABLE public.movimientos_banco
ADD CONSTRAINT movimientos_banco_tipo_conciliacion_check
CHECK (
  tipo_conciliacion IS NULL
  OR tipo_conciliacion IN (
    'factura',
    'rendicion',
    'cheque',
    'webpay',
    'commitment',
    'remuneraciones',
    'otros_egresos'
  )
);
