import { createClient } from '@supabase/supabase-js';

// TODO: Replace with environment variables or ensure they are set in .env
const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const resolveSupabaseUrl = (url?: string) => {
    const fallback = 'https://api.atapp.cl';
    if (!url) return fallback;

    // Legacy URL from old deployment route
    if (url.includes('api.gestionlab.100.66.33.103.sslip.io')) {
        return fallback;
    }

    // Common misconfiguration: frontend domain used as Supabase URL
    if (url.includes('lab-finanzas.atapp.cl') || url.includes('lab-finanzas.vercel.app')) {
        return fallback;
    }

    // Avoid mixed-content failures when app runs over https
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && url.startsWith('http://')) {
        try {
            const parsed = new URL(url);
            if (parsed.hostname.endsWith('.sslip.io')) {
                return fallback;
            }
        } catch {
            return fallback;
        }
    }

    return url;
};

const supabaseUrl = resolveSupabaseUrl(rawSupabaseUrl);

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing Supabase environment variables! Check .env file.");
}

export const supabase = createClient(
    supabaseUrl || '',
    supabaseAnonKey || ''
);
