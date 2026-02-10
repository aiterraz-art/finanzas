-- Crear el bucket de storage para las facturas/rendiciones si no existe
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', true)
ON CONFLICT (id) DO NOTHING;

-- Configurar políticas de RLS para el bucket invoices
-- Permitir lectura pública de archivos
CREATE POLICY "Public Access Invoices" ON storage.objects FOR SELECT USING (bucket_id = 'invoices');

-- Permitir subida pública de archivos (para autenticados)
CREATE POLICY "Public Upload Invoices" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'invoices');

-- Permitir borrar archivos
CREATE POLICY "Public Delete Invoices" ON storage.objects FOR DELETE USING (bucket_id = 'invoices');
