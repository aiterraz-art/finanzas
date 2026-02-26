import { supabase } from "@/lib/supabase";

type InviteRole = "user" | "admin";

type CollectionReminderPayload = {
  tercero_id: string;
  nombre: string;
  email: string;
  saldo_total: number;
  antiguedad: number;
};

type InternalExtraction = {
  tipo_documento?: "nota_credito" | "factura";
  numero_documento?: string;
  monto?: number;
  fecha_emision?: string;
  tercero_nombre?: string;
  rut?: string;
  descripcion?: string;
  warning?: string;
};

const formatDate = (input?: string) => {
  if (!input) return undefined;
  const normalized = input.replace(/\//g, "-");
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

const extractFromFilename = (fileName: string): InternalExtraction => {
  const base = fileName.replace(/\.[^.]+$/, "");
  const montoMatches = base.match(/\d[\d.,]{3,}/g) || [];
  const bestMonto = montoMatches
    .map(parseAmount)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => b - a)[0];

  const docMatch = base.match(/(?:folio|factura|doc|n|#)?\D*(\d{3,})/i);
  const dateMatch = base.match(/\b(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})\b/);
  const rutMatch = base.match(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/);

  return {
    numero_documento: docMatch?.[1],
    monto: bestMonto,
    fecha_emision: formatDate(dateMatch?.[1]),
    rut: rutMatch?.[0],
    descripcion: `Documento: ${fileName}`,
    warning:
      "OCR interno no configurado. Se precargaron datos básicos desde el nombre del archivo; valida antes de guardar.",
  };
};

const fileToBase64 = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export const inviteUserInternal = async (email: string, role: InviteRole) => {
  const { data, error } = await supabase.functions.invoke("invite-user", {
    body: {
      email,
      role,
      app_url: window.location.origin,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
};

export const queueCollectionReminder = async (payload: CollectionReminderPayload) => {
  const { error } = await supabase.from("collection_reminders").insert([
    {
      tercero_id: payload.tercero_id,
      nombre: payload.nombre,
      email: payload.email,
      saldo_total: payload.saldo_total,
      antiguedad: payload.antiguedad,
      status: "queued",
    },
  ]);
  if (error) throw error;
};

export const processInvoiceDocument = async (
  file: File,
  defaultType: "venta" | "compra"
): Promise<InternalExtraction> => {
  try {
    const base64 = await fileToBase64(file);
    const { data, error } = await supabase.functions.invoke("invoice-ocr", {
      body: {
        file_name: file.name,
        content_type: file.type,
        file_base64: base64,
        default_type: defaultType,
      },
    });

    if (error || !data) {
      return extractFromFilename(file.name);
    }

    return {
      tipo_documento: data.tipo_documento,
      numero_documento: data.numero_documento,
      monto: data.monto,
      fecha_emision: formatDate(data.fecha_emision),
      tercero_nombre: data.tercero_nombre,
      rut: data.rut,
      descripcion: data.descripcion || `Documento: ${file.name}`,
      warning: data.warning,
    };
  } catch {
    return extractFromFilename(file.name);
  }
};
