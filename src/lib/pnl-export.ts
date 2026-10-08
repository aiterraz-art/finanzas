// Descarga del P/L en Excel (informe + detalle) y PDF ejecutivo, a partir del mismo
// estado de resultados que se muestra en pantalla.
import * as XLSX from "xlsx";
import {
  PNL_EXPENSE_LINES,
  documentSignedPnlAmount,
  hasTaxBreakdown,
  type PnlExpenseLine,
  type PnlResult,
} from "@/lib/pnl";
import type { PnlData } from "@/lib/pnl-data";
import type { PnlStatement } from "@/lib/pnl-report";

export type PnlExportContext = {
  companyName: string;
  companyRut: string | null;
  logoUrl: string | null;
  fromMonth: string;
  toMonth: string;
  statement: PnlStatement;
  pnl: PnlResult;
  data: PnlData;
};

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const monthLabel = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_NAMES[number - 1]} ${year}`;
};
const monthShortLabel = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return `${MONTH_SHORT[number - 1]} ${String(year).slice(2)}`;
};
export const periodLabel = (fromMonth: string, toMonth: string) =>
  fromMonth === toMonth ? monthLabel(fromMonth) : `${monthLabel(fromMonth)} – ${monthLabel(toMonth)}`;

const formatPesos = (value: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(value));
const formatNumber = (value: number) => {
  const rounded = Math.round(value);
  return rounded === 0 ? "–" : rounded.toLocaleString("es-CL");
};
const formatPercent = (value: number | null) => (value == null ? "" : `${(value * 100).toFixed(1).replace(".", ",")}%`);
const formatIsoDate = (value: string | null | undefined) => (value ? value.slice(0, 10).split("-").reverse().join("-") : "");
const todayLabel = () => new Date().toLocaleDateString("es-CL");
const lineLabel = (line: PnlExpenseLine) => PNL_EXPENSE_LINES.find((item) => item.key === line)?.label || line;
const fileBase = (context: PnlExportContext) =>
  `PL_${context.companyName.replace(/[^A-Za-z0-9]+/g, "_")}_${context.fromMonth}${context.fromMonth === context.toMonth ? "" : `_${context.toMonth}`}`;

// Notas que acompañan al informe: base de cálculo y lo que todavía puede mover la cifra.
export const buildPnlNotes = (context: PnlExportContext) => {
  const notes = [
    "Base devengo: documentos por fecha de emisión; remuneraciones, honorarios y gastos sin factura por su mes de devengo.",
    "Montos netos de IVA recuperable. No incluye pagos de IVA/F29, traspasos, capex ni capital de créditos.",
  ];
  const withoutBreakdown = context.data.documents.filter((document) => !hasTaxBreakdown(document));
  if (withoutBreakdown.length > 0) {
    const total = withoutBreakdown.reduce((sum, document) => sum + Number(document.monto || 0), 0);
    notes.push(`${withoutBreakdown.length} documento(s) sin neto/IVA por ${formatPesos(total)} se incluyeron por su total con IVA.`);
  }
  const count = (kind: string) => context.pnl.warnings.filter((warning) => warning.kind === kind).length;
  if (count("possible_duplicate") > 0) notes.push(`${count("possible_duplicate")} posible(s) gasto(s) duplicado(s) con facturas de compra, sin revisar.`);
  if (count("unchecked_rendition") > 0) notes.push(`${count("unchecked_rendition")} rendición(es) sin revisar si incluyen facturas.`);
  if (context.data.unreconciledOutflows.count > 0) {
    notes.push(`${context.data.unreconciledOutflows.count} egreso(s) bancario(s) sin conciliar por ${formatPesos(context.data.unreconciledOutflows.total)} no están en el resultado.`);
  }
  return notes;
};

const NUMBER_FORMAT = '#,##0;-#,##0;"–"';

// Formato de miles para las columnas numéricas de una hoja de detalle (fila 0 = encabezado).
const formatNumericColumns = (sheet: XLSX.WorkSheet) => {
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  for (let row = 1; row <= range.e.r; row += 1) {
    for (let column = 0; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && typeof cell.v === "number") cell.z = "#,##0;-#,##0;0";
    }
  }
};
const PERCENT_FORMAT = "0.0%";

export const exportPnlToExcel = (context: PnlExportContext) => {
  const { statement } = context;
  const columnCount = statement.months.length + 3;
  const header = ["Concepto", ...statement.months.map(monthShortLabel), "Total", "% ingresos"];
  const aoa: (string | number | null)[][] = [
    ["ESTADO DE RESULTADOS"],
    [`${context.companyName}${context.companyRut ? ` · RUT ${context.companyRut}` : ""}`],
    [`Período: ${periodLabel(context.fromMonth, context.toMonth)} · Generado el ${todayLabel()}`],
    [],
    header,
  ];
  const statementStart = aoa.length;
  for (const row of statement.rows) {
    if (row.kind === "section") {
      aoa.push([row.label]);
    } else if (row.kind === "margin") {
      aoa.push([row.label, ...row.values, row.total, null]);
    } else {
      aoa.push([row.kind === "line" ? `   ${row.label}` : row.label, ...row.values, row.total, row.shareOfIncome]);
    }
  }
  aoa.push([], ["Notas"], ...buildPnlNotes(context).map((note) => [`• ${note}`]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  statement.rows.forEach((row, index) => {
    if (row.kind === "section") return;
    const excelRow = statementStart + index;
    for (let column = 1; column < columnCount; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: excelRow, c: column })];
      if (!cell || typeof cell.v !== "number") continue;
      cell.z = row.kind === "margin" || column === columnCount - 1 ? PERCENT_FORMAT : NUMBER_FORMAT;
    }
  });
  sheet["!cols"] = [{ wch: 40 }, ...statement.months.map(() => ({ wch: 14 })), { wch: 15 }, { wch: 10 }];
  sheet["!merges"] = [0, 1, 2].map((row) => ({ s: { r: row, c: 0 }, e: { r: row, c: columnCount - 1 } }));

  const expenseSheet = XLSX.utils.json_to_sheet(
    [...context.pnl.expenseItems]
      .sort((a, b) => a.line.localeCompare(b.line) || (a.date || a.month).localeCompare(b.date || b.month))
      .map((item) => ({
        "Fecha pago": formatIsoDate(item.date),
        "Mes P/L": item.month,
        Línea: lineLabel(item.line),
        Beneficiario: item.counterparty || "",
        Detalle: item.description,
        Pagado: item.paidAmount,
        "Monto P/L": -item.amount,
        Nota: item.note || "",
      }))
  );
  formatNumericColumns(expenseSheet);
  expenseSheet["!cols"] = [{ wch: 12 }, { wch: 9 }, { wch: 34 }, { wch: 24 }, { wch: 48 }, { wch: 13 }, { wch: 13 }, { wch: 40 }];

  const documentSheet = XLSX.utils.json_to_sheet(
    context.data.documents.map((document) => ({
      Fecha: formatIsoDate(document.fecha_emision),
      Tipo: document.tipo === "venta" ? "Venta" : document.tipo === "compra" ? "Compra" : document.tipo === "nota_credito" ? "NC venta" : "NC compra",
      Tercero: document.tercero_nombre || "",
      Folio: document.numero_documento || "",
      Neto: document.monto_neto ?? "",
      Exento: document.monto_exento ?? "",
      IVA: document.monto_iva ?? "",
      Total: Number(document.monto || 0),
      "Monto P/L": documentSignedPnlAmount(document),
      "Con desglose": hasTaxBreakdown(document) ? "Sí" : "No (usa total)",
      Estado: document.estado || "",
    }))
  );
  formatNumericColumns(documentSheet);
  documentSheet["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 34 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 11 }];

  const warningSheet = XLSX.utils.aoa_to_sheet([
    ["Detalle"],
    ...buildPnlNotes(context).slice(2).map((note) => [note]),
    ...context.pnl.warnings.map((warning) => [warning.message]),
  ]);
  warningSheet["!cols"] = [{ wch: 140 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Estado de resultados");
  XLSX.utils.book_append_sheet(workbook, expenseSheet, "Gastos sin factura");
  XLSX.utils.book_append_sheet(workbook, documentSheet, "Documentos");
  XLSX.utils.book_append_sheet(workbook, warningSheet, "Advertencias");
  XLSX.writeFile(workbook, `${fileBase(context)}.xlsx`);
};

const loadImageAsDataUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Logo no disponible (${response.status})`);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error("Logo ilegible"));
    image.src = dataUrl;
  });
  return { dataUrl, ...size, format: blob.type.includes("png") ? "PNG" : "JPEG" };
};

export const exportPnlToPdf = async (context: PnlExportContext) => {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { statement } = context;
  const landscape = statement.months.length > 3;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let textLeft = margin;

  if (context.logoUrl) {
    try {
      const logo = await loadImageAsDataUrl(context.logoUrl);
      const height = 40;
      const width = Math.min(120, (logo.width / logo.height) * height);
      doc.addImage(logo.dataUrl, logo.format, margin, 32, width, height);
      textLeft = margin + width + 14;
    } catch (error) {
      console.warn("No se pudo incluir el logo en el PDF:", error);
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(context.companyName, textLeft, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  if (context.companyRut) doc.text(`RUT ${context.companyRut}`, textLeft, 60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text("Estado de Resultados", pageWidth - margin, 46, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(periodLabel(context.fromMonth, context.toMonth), pageWidth - margin, 60, { align: "right" });

  // Indicadores del período.
  const kpis = [
    { label: "Ingresos netos", value: formatPesos(statement.income) },
    { label: "Costos y gastos", value: formatPesos(statement.expenses) },
    { label: "Resultado", value: formatPesos(statement.result) },
    { label: "Margen", value: formatPercent(statement.margin) || "—" },
  ];
  const kpiTop = 86;
  const gap = 10;
  const kpiWidth = (pageWidth - margin * 2 - gap * (kpis.length - 1)) / kpis.length;
  kpis.forEach((kpi, index) => {
    const x = margin + index * (kpiWidth + gap);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, kpiTop, kpiWidth, 46, 4, 4, "FD");
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(kpi.label, x + 10, kpiTop + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const isResult = kpi.label === "Resultado" || kpi.label === "Margen";
    if (isResult && statement.result < 0) doc.setTextColor(185, 28, 28);
    else doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, x + 10, kpiTop + 35);
    doc.setFont("helvetica", "normal");
  });

  const showTotal = statement.months.length > 1;
  const head = [["Concepto", ...statement.months.map(monthShortLabel), ...(showTotal ? ["Total"] : []), "% ingresos"]];
  const body = statement.rows.map((row) => {
    if (row.kind === "section") return [row.label];
    const values = row.kind === "margin" ? row.values.map(formatPercent) : row.values.map(formatNumber);
    const total = row.kind === "margin" ? formatPercent(row.total) : formatNumber(row.total);
    return [row.kind === "line" ? `   ${row.label}` : row.label, ...values, ...(showTotal ? [total] : []), row.kind === "margin" ? "" : formatPercent(row.shareOfIncome)];
  });
  const amountColumns = head[0].length - 1;

  autoTable(doc, {
    startY: kpiTop + 62,
    head,
    body,
    theme: "plain",
    styles: { fontSize: statement.months.length > 6 ? 7 : 8.5, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }, textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: Object.fromEntries(Array.from({ length: amountColumns }, (_, index) => [index + 1, { halign: "right" }])),
    margin: { left: margin, right: margin },
    didParseCell: (hook) => {
      if (hook.section === "head" && hook.column.index > 0) hook.cell.styles.halign = "right";
      if (hook.section !== "body") return;
      const row = statement.rows[hook.row.index];
      if (row.kind === "section") {
        hook.cell.colSpan = head[0].length;
        hook.cell.styles.fontStyle = "bold";
        hook.cell.styles.fillColor = [241, 245, 249];
        hook.cell.styles.textColor = [71, 85, 105];
      } else if (row.kind === "subtotal") {
        hook.cell.styles.fontStyle = "bold";
        hook.cell.styles.lineWidth = { top: 0.5 };
        hook.cell.styles.lineColor = [203, 213, 225];
      } else if (row.kind === "result") {
        hook.cell.styles.fontStyle = "bold";
        hook.cell.styles.fillColor = [226, 232, 240];
        if (hook.column.index > 0 && String(hook.cell.raw).startsWith("-")) hook.cell.styles.textColor = [185, 28, 28];
      } else if (row.kind === "margin") {
        hook.cell.styles.fontStyle = "italic";
        hook.cell.styles.textColor = [100, 116, 139];
      }
    },
  });

  const notes = buildPnlNotes(context);
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  if (y > pageHeight - 90) {
    doc.addPage();
    y = 50;
  }
  doc.text("Notas", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  y += 14;
  for (const note of notes) {
    const lines = doc.splitTextToSize(`• ${note}`, pageWidth - margin * 2);
    if (y + lines.length * 11 > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }
    doc.text(lines, margin, y);
    y += lines.length * 11 + 2;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generado el ${todayLabel()}`, margin, pageHeight - 20);
    doc.text(`Página ${page} de ${pageCount}`, pageWidth - margin, pageHeight - 20, { align: "right" });
  }

  doc.save(`${fileBase(context)}.pdf`);
};
