const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  file_name?: string;
  default_type?: "venta" | "compra";
};

const formatDate = (raw?: string) => {
  if (!raw) return undefined;
  const normalized = raw.replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const match = normalized.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return undefined;
  return `${match[3]}-${match[2]}-${match[1]}`;
};

const parseAmount = (raw: string) => {
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : undefined;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as Payload;
    const fileName = payload.file_name || "documento";
    const base = fileName.replace(/\.[^.]+$/, "");

    const montoMatches = base.match(/\d[\d.,]{3,}/g) || [];
    const monto = montoMatches
      .map(parseAmount)
      .filter((n): n is number => typeof n === "number")
      .sort((a, b) => b - a)[0];

    const docMatch = base.match(/(?:folio|factura|doc|n|#)?\D*(\d{3,})/i);
    const dateMatch = base.match(/\b(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})\b/);
    const rutMatch = base.match(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/);

    return new Response(
      JSON.stringify({
        tipo_documento: payload.default_type === "compra" ? "factura" : "factura",
        numero_documento: docMatch?.[1] || "",
        monto: monto ?? 0,
        fecha_emision: formatDate(dateMatch?.[1]) || new Date().toISOString().slice(0, 10),
        rut: rutMatch?.[0] || "",
        descripcion: `Documento: ${fileName}`,
        warning:
          "OCR interno en modo básico: se extrajo metadata del nombre del archivo. Configura un proveedor OCR para extracción avanzada.",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
