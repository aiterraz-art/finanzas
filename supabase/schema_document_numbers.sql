-- ACTUALIZACIÓN SCHEMA: IDENTIFICACIÓN DE DOCUMENTOS
-- Ejecutar en Supabase SQL Editor

-- 1. Agregar columna para el folio/número de documento
ALTER TABLE gestion_laboratorio.facturas
ADD COLUMN IF NOT EXISTS numero_documento TEXT;

-- 2. Asegurarse de que el tipo de factura soporte anulaciones (Notas de Crédito)
-- Nota: La columna 'tipo' ya existe, pero ahora validaremos que envíe 'venta', 'gasto' o 'nota_credito'.
