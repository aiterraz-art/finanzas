-- ESQUEMA CONSOLIDADO (ESQUEMA PUBLIC)
-- Ejecuta este script para asegurar que todas las tablas existan en 'public'
-- Esto soluciona problemas de visibilidad y errores de esquema.

-- 1. Asegurar que las tablas existan en PUBLIC
-- Si están en gestion_laboratorio, moverlas. Si no existen, crearlas.

DO $$ 
BEGIN 
    -- Tabla Terceros
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'gestion_laboratorio' AND table_name = 'terceros') THEN
        ALTER TABLE gestion_laboratorio.terceros SET SCHEMA public;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'terceros') THEN
        CREATE TABLE public.terceros (
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
    END IF;

    -- Tabla Facturas
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'gestion_laboratorio' AND table_name = 'facturas') THEN
        ALTER TABLE gestion_laboratorio.facturas SET SCHEMA public;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'facturas') THEN
        CREATE TABLE public.facturas (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ DEFAULT now(),
            tipo TEXT CHECK (tipo IN ('venta', 'compra', 'nota_credito')) NOT NULL,
            monto DECIMAL(12,2) NOT NULL,
            fecha_emision DATE DEFAULT CURRENT_DATE,
            numero_documento TEXT,
            descripcion TEXT,
            estado TEXT DEFAULT 'pendiente',
            tercero_id UUID REFERENCES public.terceros(id),
            archivo_url TEXT,
            tercero_nombre TEXT,
            rut TEXT
        );
    END IF;

    -- Tabla Movimientos Banco
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'gestion_laboratorio' AND table_name = 'movimientos_banco') THEN
        ALTER TABLE gestion_laboratorio.movimientos_banco SET SCHEMA public;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'movimientos_banco') THEN
        CREATE TABLE public.movimientos_banco (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            created_at TIMESTAMPTZ DEFAULT now(),
            fecha_movimiento DATE NOT NULL,
            descripcion TEXT,
            monto DECIMAL(12,2) NOT NULL,
            tipo TEXT,
            estado TEXT DEFAULT 'no_conciliado',
            numero_documento TEXT,
            saldo DECIMAL(12,2),
            id_secuencial SERIAL
        );
    END IF;

    -- Tabla Facturas Pagos (Relación N:N)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'gestion_laboratorio' AND table_name = 'facturas_pagos') THEN
        ALTER TABLE gestion_laboratorio.facturas_pagos SET SCHEMA public;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'facturas_pagos') THEN
        CREATE TABLE public.facturas_pagos (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            factura_id UUID REFERENCES public.facturas(id),
            movimiento_banco_id UUID REFERENCES public.movimientos_banco(id),
            monto_aplicado DECIMAL(12,2) NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE(factura_id, movimiento_banco_id)
        );
    END IF;

END $$;

-- 2. Asegurar que las columnas nuevas existan (por si acaso ya existían las tablas en public)
ALTER TABLE public.facturas ADD COLUMN IF NOT EXISTS numero_documento TEXT;
ALTER TABLE public.movimientos_banco ADD COLUMN IF NOT EXISTS id_secuencial SERIAL;
ALTER TABLE public.movimientos_banco ADD COLUMN IF NOT EXISTS saldo DECIMAL(12,2);

-- 3. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_facturas_tercero_id ON public.facturas(tercero_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_id_secuencial ON public.movimientos_banco(id_secuencial);
