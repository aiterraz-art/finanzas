import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const loadEnvFile = () => {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

loadEnvFile();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL/anon key envs.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tableChecks = [
  { table: "terceros", columns: ["id", "rut", "razon_social", "tipo", "estado", "plazo_pago_dias", "es_trabajador", "cargo"] },
  { table: "facturas", columns: ["id", "tipo", "monto", "fecha_emision", "fecha_vencimiento", "numero_documento", "estado", "tercero_id", "rut", "tercero_nombre", "archivo_url"] },
  { table: "movimientos_banco", columns: ["id", "fecha_movimiento", "descripcion", "monto", "estado", "saldo", "id_secuencial", "n_operacion", "sucursal"] },
  { table: "facturas_pagos", columns: ["id", "factura_id", "rendicion_id", "movimiento_banco_id", "monto_aplicado", "created_at"] },
  { table: "rendiciones", columns: ["id", "fecha", "tercero_id", "tercero_nombre", "monto_total", "estado", "descripcion", "archivos_urls"] },
  { table: "rendicion_detalles", columns: ["id", "rendicion_id", "descripcion", "monto"] },
  { table: "profiles", columns: ["id", "email", "role", "created_at"] },
  { table: "gastos_recurrentes", columns: ["id", "descripcion", "monto", "dia_pago", "categoria", "activo"] },
  { table: "presupuestos", columns: ["id", "mes", "categoria", "monto_presupuestado"] },
  { table: "collection_reminders", columns: ["id", "tercero_id", "nombre", "email", "saldo_total", "antiguedad", "status", "error_message", "processed_at"] },
];

const relationChecks = [
  { table: "facturas", select: "id, terceros(razon_social)" },
  { table: "terceros", select: "id, facturas(id)" },
  { table: "movimientos_banco", select: "id, facturas_pagos(id, factura_id, rendicion_id)" },
  { table: "rendiciones", select: "id, terceros(razon_social), rendicion_detalles(id)" },
];

const failures = [];

for (const check of tableChecks) {
  const selectCols = check.columns.join(",");
  const { error } = await supabase.from(check.table).select(selectCols).limit(1);
  if (error) {
    failures.push(`[TABLE] ${check.table}: ${error.message}`);
    continue;
  }
  console.log(`[OK] ${check.table} -> ${selectCols}`);
}

for (const check of relationChecks) {
  const { error } = await supabase.from(check.table).select(check.select).limit(1);
  if (error) {
    failures.push(`[REL] ${check.table}: ${error.message}`);
    continue;
  }
  console.log(`[OK] relation ${check.table} -> ${check.select}`);
}

if (failures.length > 0) {
  if (failures.every((f) => f.includes("404 page not found"))) {
    console.error(`\nSupabase endpoint appears misconfigured or unavailable: ${supabaseUrl}`);
  }
  console.error("\nSchema validation failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}

console.log("\nSchema validation passed.");
