-- Corrección de datos del P/L (LABORATORIO SONRIE DIGITAL).
-- Requiere aplicar antes supabase/migrations/20261008_pnl_accuracy.sql. Ejecutar una sola vez.
\set ON_ERROR_STOP on
BEGIN;

-- Totales de compra mal tipeados: se dejan iguales a neto + IVA del Registro de Compras SII.
UPDATE public.facturas SET monto = 433603 WHERE id = 'c0bca775-0e0f-47dd-aa03-ee1a3a9125f1' AND monto = 433.60;  -- Chilexpress 13348568
UPDATE public.facturas SET monto = 84672  WHERE id = '48c2767d-ac77-4acd-91ed-cd86b4066446' AND monto = 85672;   -- 3DENTAL 9653
UPDATE public.facturas SET monto = 81599  WHERE id = 'a320b8db-618a-4128-88aa-802e8d6477fb' AND monto = 13028;   -- 3DENTAL 9681

-- Gastos pagados por banco cuya factura de compra ya está cargada (mismo RUT o rendición del mismo día y monto).
WITH pairs(cc_id, f_id) AS (VALUES
  ('bed88f39-5d86-4ce1-bff4-1a8258d584a5'::uuid, 'eb47fa7d-c78a-4822-a68f-e9bed0618313'::uuid), -- Siromax 37699, 483.230
  ('a22fae00-1ce1-4ae0-8152-d608ea2e5d80', '9dedd549-4085-4b65-b247-21f1d983c7d1'),             -- Arriendo factura 210, 1.622.705
  ('46dc5190-d3ca-403c-b65b-e0806bd8d3c0', 'e25ef157-b16c-41dc-aa14-c01e2e806574'),             -- Kicks Bikers 171, 54.990
  ('4ee66ca1-ec7d-4619-bc20-ae7aba671657', '9485c599-e4fa-4cff-8099-4e97828c103b'),             -- PC Factory 5628161, 22.990
  ('284cb5dc-24cb-45ea-8db0-c7868187e5b4', 'c0bca775-0e0f-47dd-aa03-ee1a3a9125f1'),             -- Chilexpress 13348568, 433.603
  ('3d968c2e-6ca6-49c2-93dd-4e74abe70c6b', '21057daa-6743-486f-8aa5-d6cf7531f605'),             -- Sodimac 149376757, 5.990
  ('58147031-3105-465d-8a79-2149be85e765', 'a749e7a5-c182-4958-9478-72b55e542c9b')              -- PC Factory 5646449, 30.970
)
INSERT INTO public.pnl_invoice_links (empresa_id, factura_id, cash_commitment_id, factura_estado_previo)
SELECT f.empresa_id, f.id, p.cc_id, f.estado
FROM pairs p
JOIN public.facturas f ON f.id = p.f_id
JOIN public.cash_commitments cc ON cc.id = p.cc_id AND cc.empresa_id = f.empresa_id
ON CONFLICT (factura_id) DO NOTHING;

UPDATE public.facturas SET estado = 'pagada'
WHERE id IN (SELECT factura_id FROM public.pnl_invoice_links);

SELECT (SELECT count(*) FROM public.pnl_invoice_links) AS vinculos,
       (SELECT count(*) FROM public.facturas
          WHERE archived_at IS NULL AND (monto_neto IS NOT NULL OR monto_exento IS NOT NULL)
            AND abs(coalesce(monto_neto,0)+coalesce(monto_exento,0)+coalesce(monto_iva,0)-monto) > 1) AS totales_descuadrados,
       (SELECT count(*) FROM public.cash_commitments
          WHERE status = 'paid' AND direction = 'outflow' AND accrual_month IS NULL) AS pagados_sin_mes;

COMMIT;
