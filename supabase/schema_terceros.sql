-- TABLA DE TERCEROS (CLIENTES Y PROVEEDORES)
-- Esta tabla centraliza a todas las entidades con las que el laboratorio hace negocios.

CREATE TABLE IF NOT EXISTS gestion_laboratorio.terceros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rut TEXT UNIQUE NOT NULL,
    razon_social TEXT NOT NULL,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    tipo TEXT NOT NULL CHECK (tipo IN ('cliente', 'proveedor', 'ambos')),
    estado TEXT DEFAULT 'activo',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Vincular facturas a terceros vía RUT (o ID si se prefiere, usaremos RUT por simplicidad)
ALTER TABLE gestion_laboratorio.facturas 
ADD COLUMN IF NOT EXISTS tercero_id UUID REFERENCES gestion_laboratorio.terceros(id);

-- Tabla de unión Facturas <-> Pagos (Movimientos Banco)
-- Esto permite que un movimiento de banco pague múltiples facturas o una factura sea pagada en múltiples cuotas.
CREATE TABLE IF NOT EXISTS gestion_laboratorio.facturas_pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factura_id UUID REFERENCES gestion_laboratorio.facturas(id) NOT NULL,
    movimiento_banco_id UUID REFERENCES gestion_laboratorio.movimientos_banco(id) NOT NULL,
    monto_aplicado DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(factura_id, movimiento_banco_id)
);
