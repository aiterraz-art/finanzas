import { supabase } from "@/lib/supabase";

type InviteRole = "user" | "admin";
type CreateUserPayload = {
  email: string;
  role: InviteRole;
  full_name?: string;
  phone?: string;
  job_title?: string;
};

type CollectionReminderPayload = {
  empresa_id: string;
  tercero_id: string;
  nombre: string;
  email: string;
  saldo_total: number;
  antiguedad: number;
};

export const inviteUserInternal = async (email: string, role: InviteRole) => {
  const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
  const { data, error } = await supabase.functions.invoke("invite-user", {
    body: {
      email,
      role,
      app_url: appUrl,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
};

export const createUserInternal = async (payload: CreateUserPayload) => {
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: payload,
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { ok: true; user_id: string; email: string; password: string };
};

export const queueCollectionReminder = async (payload: CollectionReminderPayload) => {
  const { error } = await supabase.from("collection_reminders").insert([
    {
      empresa_id: payload.empresa_id,
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
