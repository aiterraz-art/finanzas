import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PnlDocument } from "@/lib/pnl";
import { formatTreasuryCurrency, formatTreasuryDate } from "@/lib/treasury";

type InvoiceCheck = "" | "no_invoices" | "linked";

const matchText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Paso obligatorio al conciliar una rendición: si el trabajador pagó facturas a nombre de la
// empresa, esas facturas llegan también por el Registro de Compras del SII y el gasto se duplica.
export function RenditionInvoiceCheck({
  amount,
  invoices,
  loading,
  search,
  onSearchChange,
  check,
  selectedIds,
  onChange,
}: {
  amount: number;
  invoices: PnlDocument[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  check: InvoiceCheck;
  selectedIds: string[];
  onChange: (check: InvoiceCheck, selectedIds: string[]) => void;
}) {
  const query = matchText(search.trim());
  const visibleInvoices = invoices.filter((invoice) =>
    !query ||
    selectedIds.includes(invoice.id) ||
    matchText(`${invoice.tercero_nombre || ""} ${invoice.numero_documento || ""} ${invoice.monto || ""}`).includes(query)
  );
  const selectedTotal = invoices
    .filter((invoice) => selectedIds.includes(invoice.id))
    .reduce((sum, invoice) => sum + Number(invoice.monto || 0), 0);
  const toggle = (id: string) =>
    onChange("linked", selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);

  return (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50/50 p-3 md:col-span-2">
      <div>
        <Label>¿La rendición incluye facturas a nombre de la empresa?</Label>
        <p className="text-xs text-muted-foreground">Obligatorio. Las facturas a nombre de la empresa ya entran al P/L por el Registro de Compras; vincúlalas para no contar el gasto dos veces.</p>
      </div>
      <div className="flex flex-col gap-2 text-sm md:flex-row md:gap-6">
        <label className="flex items-center gap-2">
          <input type="radio" name="rendition-invoice-check" checked={check === "linked"} onChange={() => onChange("linked", selectedIds)} />
          Sí, vincular sus facturas
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="rendition-invoice-check" checked={check === "no_invoices"} onChange={() => onChange("no_invoices", [])} />
          No, solo boletas u otros comprobantes
        </label>
      </div>
      {check === "linked" && (
        <div className="space-y-2">
          <Input placeholder="Buscar por proveedor, folio o monto" value={search} onChange={(event) => onSearchChange(event.target.value)} />
          <div className="max-h-56 overflow-y-auto rounded-md border bg-background">
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : visibleInvoices.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No hay facturas de compra pendientes cercanas a la fecha. Si la factura aún no se importa desde el SII, impórtala primero.</p>
            ) : visibleInvoices.map((invoice) => (
              <label key={invoice.id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-xs last:border-0 hover:bg-muted/50">
                <input type="checkbox" checked={selectedIds.includes(invoice.id)} onChange={() => toggle(invoice.id)} />
                <span className="w-20 shrink-0">{formatTreasuryDate(invoice.fecha_emision)}</span>
                <span className="flex-1 truncate">{invoice.tercero_nombre || "Sin proveedor"} · N° {invoice.numero_documento || "s/f"}</span>
                <span className="font-medium">{formatTreasuryCurrency(Number(invoice.monto || 0))}</span>
              </label>
            ))}
          </div>
          <p className="text-xs">
            Facturas seleccionadas: <strong>{formatTreasuryCurrency(selectedTotal)}</strong> de {formatTreasuryCurrency(amount)}.
            {selectedIds.length > 0 && ` Quedan ${formatTreasuryCurrency(Math.max(0, amount - selectedTotal))} como gasto sin factura.`}
          </p>
        </div>
      )}
    </div>
  );
}
