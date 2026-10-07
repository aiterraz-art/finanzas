import { Input } from "@/components/ui/input";
import type { TaxBreakdownValue } from "@/components/invoices/taxBreakdown";

// Neto, exento e IVA del documento: el P/L usa neto + exento, sin el IVA recuperable.
export function TaxBreakdownFields({ total, value, onChange }: { total: string; value: TaxBreakdownValue; onChange: (value: TaxBreakdownValue) => void }) {
  const totalAmount = Number(total);
  const canCalculate = Number.isFinite(totalAmount) && totalAmount > 0;
  const fillAffected = () => {
    const neto = Math.round(totalAmount / 1.19);
    onChange({ neto: String(neto), exento: "0", iva: String(Math.round(totalAmount - neto)) });
  };
  const fillExempt = () => onChange({ neto: "0", exento: String(totalAmount), iva: "0" });

  return (
    <div className="grid gap-2 md:col-span-2 md:grid-cols-3">
      <div className="space-y-2">
        <label className="text-sm font-medium">Neto</label>
        <Input type="number" min="0" step="1" value={value.neto} onChange={(event) => onChange({ ...value, neto: event.target.value })} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Exento</label>
        <Input type="number" min="0" step="1" value={value.exento} onChange={(event) => onChange({ ...value, exento: event.target.value })} />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">IVA</label>
        <Input type="number" min="0" step="1" value={value.iva} onChange={(event) => onChange({ ...value, iva: event.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground md:col-span-3">
        <span>El P/L usa neto + exento; vacío usa el total con IVA.</span>
        <button type="button" className="text-primary underline disabled:opacity-50" disabled={!canCalculate} onClick={fillAffected}>Calcular afecto 19%</button>
        <button type="button" className="text-primary underline disabled:opacity-50" disabled={!canCalculate} onClick={fillExempt}>Todo exento</button>
      </div>
    </div>
  );
}
