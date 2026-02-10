-- Rename archivo_url to old_archivo_url temporarily to migrate data
ALTER TABLE public.rendiciones RENAME COLUMN archivo_url TO old_archivo_url;

-- Add new array column
ALTER TABLE public.rendiciones ADD COLUMN archivos_urls TEXT[] DEFAULT '{}';

-- Migrate existing data: if old_archivo_url is not null, put it in the array
UPDATE public.rendiciones 
SET archivos_urls = ARRAY[old_archivo_url] 
WHERE old_archivo_url IS NOT NULL;

-- Drop the old column
ALTER TABLE public.rendiciones DROP COLUMN old_archivo_url;
