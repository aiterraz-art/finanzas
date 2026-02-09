-- Tabla Rendiciones
CREATE TABLE IF NOT EXISTS public.rendiciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    fecha DATE DEFAULT CURRENT_DATE,
    tercero_id UUID REFERENCES public.terceros(id),
    tercero_nombre TEXT,
    monto_total DECIMAL(12,2) NOT NULL DEFAULT 0,
    estado TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado')),
    archivo_url TEXT,
    descripcion TEXT
);

-- Tabla Detalles de Rendición
CREATE TABLE IF NOT EXISTS public.rendicion_detalles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rendicion_id UUID REFERENCES public.rendiciones(id) ON DELETE CASCADE,
    descripcion TEXT NOT NULL,
    monto DECIMAL(12,2) NOT NULL
);

-- Habilitar RLS (opcional, pero buena práctica si ya se usa)
ALTER TABLE public.rendiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rendicion_detalles ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes si existen (para permitir re-ejecución del script)
DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados" ON public.rendiciones;
DROP POLICY IF EXISTS "Permitir todo a usuarios autenticados detalles" ON public.rendicion_detalles;

-- Crear políticas  
CREATE POLICY "Permitir todo a usuarios autenticados" ON public.rendiciones FOR ALL TO authenticated USING (true);
CREATE POLICY "Permitir todo a usuarios autenticados detalles" ON public.rendicion_detalles FOR ALL TO authenticated USING (true);

-- Índices
CREATE INDEX IF NOT EXISTS idx_rendiciones_tercero_id ON public.rendiciones(tercero_id);
CREATE INDEX IF NOT EXISTS idx_rendicion_detalles_rendicion_id ON public.rendicion_detalles(rendicion_id);

-- Actualizar facturas_pagos para soportar rendiciones
ALTER TABLE public.facturas_pagos ADD COLUMN IF NOT EXISTS rendicion_id UUID REFERENCES public.rendiciones(id);

-- Agregar campos para gestión de empleados en terceros
ALTER TABLE public.terceros ADD COLUMN IF NOT EXISTS es_trabajador BOOLEAN DEFAULT false;
ALTER TABLE public.terceros ADD COLUMN IF NOT EXISTS cargo TEXT;
