-- Las notas de crédito asociadas a una factura (factura_referencia_id) rebajan su saldo en las
-- partidas abiertas: cola de pagos, proyección de caja y cuentas por cobrar.
CREATE OR REPLACE VIEW public.v_treasury_open_items AS
 WITH linked_allocations AS (
         SELECT linked.factura_id,
            sum(linked.monto_aplicado)::numeric(14,2) AS allocated_amount
           FROM ( SELECT fp.factura_id,
                    fp.monto_aplicado
                   FROM facturas_pagos fp
                  WHERE fp.factura_id IS NOT NULL AND fp.estado = 'aplicado'::text
                UNION ALL
                 SELECT ch.factura_id,
                    ch.monto_aplicado_factura AS monto_aplicado
                   FROM cheques_cartera ch
                  WHERE ch.factura_id IS NOT NULL AND (ch.estado = ANY (ARRAY['en_cartera'::text, 'depositado'::text, 'cobrado'::text]))
                UNION ALL
                 SELECT wp.factura_id,
                    wp.monto_aplicado_factura AS monto_aplicado
                   FROM webpay_liquidaciones wp
                  WHERE wp.factura_id IS NOT NULL AND (wp.estado = ANY (ARRAY['pendiente'::text, 'conciliado'::text]))
                UNION ALL
                 -- Notas de crédito (de venta o de compra) asociadas a la factura rebajan su saldo.
                 SELECT nc.factura_referencia_id AS factura_id,
                    nc.monto AS monto_aplicado
                   FROM facturas nc
                  WHERE nc.factura_referencia_id IS NOT NULL AND nc.archived_at IS NULL AND (nc.tipo = ANY (ARRAY['nota_credito'::text, 'nota_credito_compra'::text]))) linked
          GROUP BY linked.factura_id
        )
 SELECT 'invoice_receivable'::text AS source_type,
    f.id AS source_id,
    f.empresa_id,
    COALESCE(f.preferred_bank_account_id, ba.id) AS bank_account_id,
    'inflow'::text AS direction,
    COALESCE(f.tercero_nombre, 'Sin cliente'::text) AS counterparty,
    COALESCE(tc.code, 'sales'::text) AS category_code,
    COALESCE(tc.nombre, 'Ventas'::text) AS category_name,
    GREATEST(f.monto - COALESCE(la.allocated_amount, 0::numeric), 0::numeric)::numeric(14,2) AS amount,
    COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) AS due_date,
    COALESCE(f.planned_cash_date, f.promised_payment_date, f.fecha_vencimiento, f.fecha_emision + 30) AS expected_date,
        CASE
            WHEN COALESCE(f.disputed, false) THEN 0
            WHEN f.promised_payment_date IS NOT NULL AND f.promised_payment_date < CURRENT_DATE THEN GREATEST(COALESCE(f.cash_confidence_pct::integer, 60) - 20, 10)
            ELSE COALESCE(f.cash_confidence_pct::integer, 60)
        END::smallint AS confidence_pct,
    COALESCE(f.treasury_priority, 'high'::text) AS priority,
    f.estado AS status,
    GREATEST(CURRENT_DATE - COALESCE(f.fecha_vencimiento, f.fecha_emision + 30), 0) AS aging_days,
    COALESCE(f.blocked_reason,
        CASE
            WHEN COALESCE(f.disputed, false) THEN 'Factura en disputa'::text
            ELSE NULL::text
        END) AS notes
   FROM facturas f
     LEFT JOIN treasury_categories tc ON tc.id = f.treasury_category_id
     LEFT JOIN bank_accounts ba ON ba.empresa_id = f.empresa_id AND ba.es_principal
     LEFT JOIN linked_allocations la ON la.factura_id = f.id
  WHERE f.tipo = 'venta'::text AND (f.estado = ANY (ARRAY['pendiente'::text, 'morosa'::text, 'abonada'::text])) AND GREATEST(f.monto - COALESCE(la.allocated_amount, 0::numeric), 0::numeric) > 0::numeric
UNION ALL
 SELECT 'invoice_payable'::text AS source_type,
    f.id AS source_id,
    f.empresa_id,
    COALESCE(f.preferred_bank_account_id, ba.id) AS bank_account_id,
    'outflow'::text AS direction,
    COALESCE(f.tercero_nombre, 'Sin proveedor'::text) AS counterparty,
    COALESCE(tc.code, 'suppliers'::text) AS category_code,
    COALESCE(tc.nombre, 'Proveedores'::text) AS category_name,
    GREATEST(f.monto - COALESCE(la.allocated_amount, 0::numeric), 0::numeric)::numeric(14,2) AS amount,
    COALESCE(f.fecha_vencimiento, f.fecha_emision + 30) AS due_date,
    COALESCE(f.planned_cash_date, f.fecha_vencimiento, f.fecha_emision + 30) AS expected_date,
    100::smallint AS confidence_pct,
    COALESCE(f.treasury_priority, 'normal'::text) AS priority,
    f.estado AS status,
    GREATEST(CURRENT_DATE - COALESCE(f.fecha_vencimiento, f.fecha_emision + 30), 0) AS aging_days,
    f.blocked_reason AS notes
   FROM facturas f
     LEFT JOIN treasury_categories tc ON tc.id = f.treasury_category_id
     LEFT JOIN bank_accounts ba ON ba.empresa_id = f.empresa_id AND ba.es_principal
     LEFT JOIN linked_allocations la ON la.factura_id = f.id
  WHERE f.tipo = 'compra'::text AND (f.estado = ANY (ARRAY['pendiente'::text, 'morosa'::text, 'abonada'::text])) AND GREATEST(f.monto - COALESCE(la.allocated_amount, 0::numeric), 0::numeric) > 0::numeric
UNION ALL
 SELECT 'rendicion'::text AS source_type,
    r.id AS source_id,
    r.empresa_id,
    COALESCE(r.preferred_bank_account_id, ba.id) AS bank_account_id,
    'outflow'::text AS direction,
    COALESCE(r.tercero_nombre, 'Sin responsable'::text) AS counterparty,
    COALESCE(tc.code, 'other_outflow'::text) AS category_code,
    COALESCE(tc.nombre, 'Otros Egresos'::text) AS category_name,
    r.monto_total::numeric(14,2) AS amount,
    COALESCE(r.fecha, (r.created_at AT TIME ZONE 'UTC'::text)::date + 7) AS due_date,
    COALESCE(r.planned_cash_date, r.fecha, (r.created_at AT TIME ZONE 'UTC'::text)::date + 7) AS expected_date,
    100::smallint AS confidence_pct,
    COALESCE(r.treasury_priority, 'high'::text) AS priority,
    r.estado AS status,
    GREATEST(CURRENT_DATE - COALESCE(r.fecha, (r.created_at AT TIME ZONE 'UTC'::text)::date + 7), 0) AS aging_days,
    NULL::text AS notes
   FROM rendiciones r
     LEFT JOIN treasury_categories tc ON tc.id = r.treasury_category_id
     LEFT JOIN bank_accounts ba ON ba.empresa_id = r.empresa_id AND ba.es_principal
  WHERE r.estado = 'pendiente'::text
UNION ALL
 SELECT 'commitment'::text AS source_type,
    cc.id AS source_id,
    cc.empresa_id,
    cc.bank_account_id,
    cc.direction,
    COALESCE(cc.counterparty, cc.description) AS counterparty,
    tc.code AS category_code,
    tc.nombre AS category_name,
    cc.amount,
    cc.due_date,
    cc.expected_date,
        CASE
            WHEN cc.direction = 'inflow'::text THEN 70
            ELSE 100
        END::smallint AS confidence_pct,
    cc.priority,
    cc.status,
    GREATEST(CURRENT_DATE - cc.due_date, 0) AS aging_days,
    cc.notes
   FROM cash_commitments cc
     JOIN treasury_categories tc ON tc.id = cc.category_id
  WHERE (cc.status = ANY (ARRAY['planned'::text, 'confirmed'::text, 'deferred'::text])) AND cc.archived_at IS NULL
UNION ALL
 SELECT 'cheque_receivable'::text AS source_type,
    ch.id AS source_id,
    ch.empresa_id,
    COALESCE(ch.bank_account_id, ba.id) AS bank_account_id,
    'inflow'::text AS direction,
    COALESCE(ch.librador, 'Cheque recibido'::text) AS counterparty,
    COALESCE(tc.code, 'checks_in_transit'::text) AS category_code,
    COALESCE(tc.nombre, 'Cheques en cartera'::text) AS category_name,
    ch.monto AS amount,
    ch.fecha_vencimiento AS due_date,
    ch.fecha_cobro_esperada AS expected_date,
    100::smallint AS confidence_pct,
        CASE
            WHEN ch.fecha_vencimiento < CURRENT_DATE THEN 'critical'::text
            ELSE 'high'::text
        END AS priority,
    ch.estado AS status,
    GREATEST(CURRENT_DATE - ch.fecha_vencimiento, 0) AS aging_days,
    ch.notas AS notes
   FROM cheques_cartera ch
     LEFT JOIN treasury_categories tc ON tc.empresa_id = ch.empresa_id AND tc.code = 'checks_in_transit'::text
     LEFT JOIN bank_accounts ba ON ba.empresa_id = ch.empresa_id AND ba.es_principal
  WHERE ch.estado = ANY (ARRAY['en_cartera'::text, 'depositado'::text])
UNION ALL
 SELECT 'webpay_receivable'::text AS source_type,
    wp.id AS source_id,
    wp.empresa_id,
    COALESCE(wp.bank_account_id, ba.id) AS bank_account_id,
    'inflow'::text AS direction,
    COALESCE(t.razon_social, f.tercero_nombre, 'WebPay pendiente'::text) AS counterparty,
    COALESCE(tc.code, 'webpay_settlements'::text) AS category_code,
    COALESCE(tc.nombre, 'Abonos WebPay'::text) AS category_name,
    wp.monto_neto AS amount,
    wp.fecha_abono_esperada AS due_date,
    wp.fecha_abono_esperada AS expected_date,
    95::smallint AS confidence_pct,
    'high'::text AS priority,
    wp.estado AS status,
    GREATEST(CURRENT_DATE - wp.fecha_abono_esperada, 0) AS aging_days,
    wp.notas AS notes
   FROM webpay_liquidaciones wp
     LEFT JOIN facturas f ON f.id = wp.factura_id
     LEFT JOIN terceros t ON t.id = wp.tercero_id
     LEFT JOIN treasury_categories tc ON tc.empresa_id = wp.empresa_id AND tc.code = 'webpay_settlements'::text
     LEFT JOIN bank_accounts ba ON ba.empresa_id = wp.empresa_id AND ba.es_principal
  WHERE wp.estado = 'pendiente'::text;

-- El importador del Registro de Compras guardaba el folio del propio documento como
-- "Documento asociado" cuando el archivo no traía columna de referencia.
UPDATE public.facturas
SET descripcion = NULLIF(regexp_replace(descripcion, '\s*\|?\s*Documento asociado: ' || numero_documento || '$', ''), '')
WHERE origen_importacion = 'sii_compras'
  AND numero_documento ~ '^[0-9A-Za-z-]+$'
  AND descripcion LIKE '%Documento asociado: ' || numero_documento;
