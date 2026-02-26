-- Internal automation queue for collection reminders (replaces external n8n webhook)
CREATE TABLE IF NOT EXISTS public.collection_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    tercero_id UUID REFERENCES public.terceros(id) ON DELETE SET NULL,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL,
    saldo_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    antiguedad INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'failed')),
    error_message TEXT,
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_collection_reminders_status ON public.collection_reminders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_collection_reminders_tercero ON public.collection_reminders(tercero_id);

ALTER TABLE public.collection_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can insert collection reminders" ON public.collection_reminders;
CREATE POLICY "Authenticated can insert collection reminders"
ON public.collection_reminders
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can read collection reminders" ON public.collection_reminders;
CREATE POLICY "Authenticated can read collection reminders"
ON public.collection_reminders
FOR SELECT
TO authenticated
USING (true);
