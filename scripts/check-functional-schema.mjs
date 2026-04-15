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
  { table: "facturas", columns: ["id", "tipo", "monto", "fecha_emision", "fecha_vencimiento", "numero_documento", "estado", "tercero_id", "rut", "tercero_nombre", "archivo_url", "treasury_category_id", "planned_cash_date", "cash_confidence_pct", "treasury_priority", "preferred_bank_account_id", "promised_payment_date", "last_collection_contact_at", "blocked_reason", "disputed"] },
  { table: "movimientos_banco", columns: ["id", "fecha_movimiento", "descripcion", "monto", "estado", "saldo", "id_secuencial", "n_operacion", "sucursal", "bank_account_id", "import_id", "source_hash", "posted_at", "entrada_banco", "salida_banco", "comentario_tesoreria", "tipo_conciliacion", "columnas_extra"] },
  { table: "facturas_pagos", columns: ["id", "factura_id", "rendicion_id", "movimiento_banco_id", "monto_aplicado", "created_at"] },
  { table: "rendiciones", columns: ["id", "fecha", "tercero_id", "tercero_nombre", "monto_total", "estado", "descripcion", "archivos_urls", "treasury_category_id", "planned_cash_date", "treasury_priority", "preferred_bank_account_id"] },
  { table: "rendicion_detalles", columns: ["id", "rendicion_id", "descripcion", "monto"] },
  { table: "profiles", columns: ["id", "email", "role", "created_at"] },
  { table: "gastos_recurrentes", columns: ["id", "descripcion", "monto", "dia_pago", "categoria", "activo"] },
  { table: "presupuestos", columns: ["id", "mes", "categoria", "monto_presupuestado"] },
  { table: "collection_reminders", columns: ["id", "tercero_id", "nombre", "email", "saldo_total", "antiguedad", "status", "error_message", "processed_at"] },
  { table: "bank_accounts", columns: ["id", "empresa_id", "nombre", "banco", "tipo", "moneda", "numero_mascarado", "saldo_inicial", "saldo_inicial_fecha", "activa", "es_principal"] },
  { table: "treasury_policies", columns: ["empresa_id", "moneda_base", "timezone", "forecast_weeks", "week_starts_on", "minimum_cash_buffer", "critical_cash_buffer", "stale_bank_import_days", "missing_followup_days"] },
  { table: "treasury_categories", columns: ["id", "empresa_id", "code", "nombre", "direction_scope", "sort_order", "active", "is_system"] },
  { table: "cash_commitment_templates", columns: ["id", "empresa_id", "category_id", "bank_account_id", "obligation_type", "description", "counterparty", "frequency", "day_of_month", "default_amount", "requires_amount_confirmation", "priority", "active", "next_due_date"] },
  { table: "cash_commitments", columns: ["id", "empresa_id", "template_id", "bank_account_id", "category_id", "source_type", "direction", "counterparty", "description", "amount", "is_estimated", "due_date", "expected_date", "priority", "status"] },
  { table: "collection_events", columns: ["id", "empresa_id", "factura_id", "tercero_id", "channel", "event_type", "happened_at", "promised_date", "promised_amount", "notes", "created_by"] },
  { table: "bank_statement_imports", columns: ["id", "empresa_id", "bank_account_id", "original_filename", "imported_by", "imported_at", "row_count", "period_from", "period_to"] },
  { table: "cheques_cartera", columns: ["id", "empresa_id", "bank_account_id", "tercero_id", "factura_id", "movimiento_banco_id", "numero_cheque", "banco_emisor", "librador", "rut_librador", "monto", "monto_aplicado_factura", "fecha_vencimiento", "fecha_cobro_esperada", "fecha_cobro_real", "estado", "notas"] },
  { table: "webpay_liquidaciones", columns: ["id", "empresa_id", "bank_account_id", "tercero_id", "factura_id", "movimiento_banco_id", "canal", "orden_compra", "codigo_autorizacion", "marca_tarjeta", "cuotas", "monto_bruto", "monto_comision", "monto_neto", "monto_aplicado_factura", "fecha_venta", "fecha_abono_esperada", "fecha_abono_real", "estado", "notas"] },
];

const relationChecks = [
  { table: "facturas", select: "id, terceros(razon_social)" },
  { table: "terceros", select: "id, facturas(id)" },
  { table: "movimientos_banco", select: "id, facturas_pagos(id, factura_id, rendicion_id)" },
  { table: "rendiciones", select: "id, terceros(razon_social), rendicion_detalles(id)" },
  { table: "bank_accounts", select: "id, empresa_id" },
  { table: "treasury_categories", select: "id, empresa_id" },
  { table: "cash_commitment_templates", select: "id, treasury_categories(nombre), bank_accounts(nombre)" },
  { table: "cheques_cartera", select: "id, bank_accounts(nombre), terceros(razon_social), facturas(numero_documento)" },
  { table: "webpay_liquidaciones", select: "id, bank_accounts(nombre), terceros(razon_social), facturas(numero_documento)" },
  { table: "v_bank_account_positions", select: "bank_account_id, current_balance, stale_import" },
  { table: "v_treasury_open_items", select: "source_id, empresa_id, direction, category_code, amount, expected_date" },
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
