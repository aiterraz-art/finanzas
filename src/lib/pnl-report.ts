// Estado de resultados como tabla (meses en columnas + total + % sobre ventas), común para la
// exportación a Excel y a PDF. Los ingresos van en positivo y los costos en negativo.
import {
  PNL_EXPENSE_LINES,
  emptyPnlTotals,
  expenseFromTotals,
  incomeFromTotals,
  type PnlResult,
  type PnlTotals,
} from "@/lib/pnl";

export type PnlStatementRowKind = "section" | "line" | "subtotal" | "result" | "margin";

export type PnlStatementRow = {
  kind: PnlStatementRowKind;
  label: string;
  // Un valor por mes, en el mismo orden que `months`. En "margin" son fracciones (0.25 = 25%).
  values: number[];
  total: number;
  // Fracción sobre los ingresos netos del período; null cuando no aplica.
  shareOfIncome: number | null;
};

export type PnlStatement = {
  months: string[];
  rows: PnlStatementRow[];
  income: number;
  expenses: number;
  result: number;
  margin: number | null;
};

export const monthsBetween = (fromMonth: string, toMonth: string) => {
  const months: string[] = [];
  let [year, month] = fromMonth.split("-").map(Number);
  const [toYear, toMonthNumber] = toMonth.split("-").map(Number);
  while (year < toYear || (year === toYear && month <= toMonthNumber)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
};

export const buildPnlStatement = (pnl: PnlResult, fromMonth: string, toMonth: string): PnlStatement => {
  const months = monthsBetween(fromMonth, toMonth);
  const monthTotals = months.map((month) => pnl.monthly.get(month) || emptyPnlTotals());
  const income = incomeFromTotals(pnl.totals);
  const share = (value: number) => (income !== 0 ? value / income : null);
  // Evita "-0" en costos sin movimiento.
  const clean = (value: number) => (value === 0 ? 0 : value);
  const row = (kind: PnlStatementRowKind, label: string, pick: (totals: PnlTotals) => number): PnlStatementRow => {
    const total = clean(pick(pnl.totals));
    return { kind, label, values: monthTotals.map((totals) => clean(pick(totals))), total, shareOfIncome: share(total) };
  };
  const section = (label: string): PnlStatementRow => ({ kind: "section", label, values: months.map(() => 0), total: 0, shareOfIncome: null });

  const rows: PnlStatementRow[] = [
    section("INGRESOS"),
    row("line", "Ventas", (totals) => totals.sales),
    row("line", "Notas de crédito de venta", (totals) => -totals.salesCreditNotes),
    row("subtotal", "Ingresos netos", incomeFromTotals),
    section("COSTOS Y GASTOS"),
    row("line", "Compras y gastos documentados", (totals) => -totals.purchases),
    row("line", "Notas de crédito de compra", (totals) => totals.purchaseCreditNotes),
  ];

  // Solo las líneas de gasto con movimiento en el período, para un informe limpio.
  for (const line of PNL_EXPENSE_LINES) {
    const hasValues = pnl.totals.expenses[line.key] !== 0 || monthTotals.some((totals) => totals.expenses[line.key] !== 0);
    if (hasValues) rows.push(row("line", line.label, (totals) => -totals.expenses[line.key]));
  }

  rows.push(row("subtotal", "Total costos y gastos", (totals) => -expenseFromTotals(totals)));
  rows.push(row("result", "RESULTADO DEL PERÍODO", (totals) => incomeFromTotals(totals) - expenseFromTotals(totals)));

  const marginOf = (totals: PnlTotals) => {
    const monthIncome = incomeFromTotals(totals);
    return monthIncome !== 0 ? (monthIncome - expenseFromTotals(totals)) / monthIncome : 0;
  };
  const expenses = expenseFromTotals(pnl.totals);
  const result = income - expenses;
  const margin = income !== 0 ? result / income : null;
  rows.push({ kind: "margin", label: "Margen sobre ingresos", values: monthTotals.map(marginOf), total: margin ?? 0, shareOfIncome: null });

  return { months, rows, income, expenses, result, margin };
};
