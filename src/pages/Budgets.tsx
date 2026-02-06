import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { format, startOfMonth, endOfMonth } from "date-fns";

import { Target, Save, Loader2 } from "lucide-react";

const CATEGORIAS = ["Insumos", "Marketing", "Sueldos", "Servicios", "Inversión"];

export default function Budgets() {
    const [loading, setLoading] = useState(true);
    const [budgets, setBudgets] = useState<any[]>([]);
    const [actualExpenses, setActualExpenses] = useState<Record<string, number>>({});
    const [editMode, setEditMode] = useState(false);
    const [formValues, setFormValues] = useState<Record<string, string>>({});

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const start = startOfMonth(new Date());

            // 1. Fetch Budgets
            const { data: budgetData } = await supabase
                .from('presupuestos')
                .select('*')
                .eq('mes', format(start, 'yyyy-MM-01'));
            setBudgets(budgetData || []);

            // Initial form values
            const iv: Record<string, string> = {};
            budgetData?.forEach(b => iv[b.categoria] = b.monto_presupuestado.toString());
            setFormValues(iv);

            // 2. Fetch Actual Expenses (Facturas de compra pagadas este mes)
            const { data: invoices } = await supabase
                .from('facturas')
                .select('monto, descripcion')
                .eq('tipo', 'compra')
                .eq('estado', 'pagada')
                .gte('created_at', start.toISOString())
                .lte('created_at', endOfMonth(start).toISOString());

            // Simple categorization based on description (Mock logic or can be improved with a category field in facturas)
            const actuals: Record<string, number> = {};
            CATEGORIAS.forEach(cat => actuals[cat] = 0);

            invoices?.forEach(inv => {
                // Simplified classification logic
                const desc = inv.descripcion?.toLowerCase() || "";
                if (desc.includes('insumo') || desc.includes('material')) actuals["Insumos"] += Number(inv.monto);
                else if (desc.includes('marketing') || desc.includes('publicidad')) actuals["Marketing"] += Number(inv.monto);
                else if (desc.includes('sueldo') || desc.includes('nomina')) actuals["Sueldos"] += Number(inv.monto);
                else if (desc.includes('luz') || desc.includes('agua') || desc.includes('servicios')) actuals["Servicios"] += Number(inv.monto);
                else actuals["Inversión"] += Number(inv.monto);
            });
            setActualExpenses(actuals);

        } catch (error) {
            console.error("Error fetching budget data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            const start = format(startOfMonth(new Date()), 'yyyy-MM-01');
            const upserts = CATEGORIAS.map(cat => ({
                mes: start,
                categoria: cat,
                monto_presupuestado: Number(formValues[cat] || 0)
            }));

            const { error } = await supabase.from('presupuestos').upsert(upserts, { onConflict: 'mes,categoria' });
            if (error) throw error;
            setEditMode(false);
            fetchData();
        } catch (error) {
            console.error("Error saving budgets:", error);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="container mx-auto py-6 space-y-8">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Presupuesto vs. Real</h2>
                    <p className="text-muted-foreground">Control de gastos mensuales por categoría.</p>
                </div>
                <Button variant={editMode ? "default" : "outline"} onClick={() => editMode ? handleSave() : setEditMode(true)} className="gap-2">
                    {editMode ? <Save className="w-4 h-4" /> : <Target className="w-4 h-4" />}
                    {editMode ? "Guardar Presupuesto" : "Definir Metas"}
                </Button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {CATEGORIAS.map(cat => {
                    const budget = budgets.find(b => b.categoria === cat)?.monto_presupuestado || 0;
                    const val = actualExpenses[cat] || 0;
                    const percent = budget > 0 ? (val / budget) * 100 : 0;
                    const isOver = percent > 100;

                    return (
                        <Card key={cat} className={isOver ? "border-red-200" : ""}>
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-center">
                                    <CardTitle className="text-lg">{cat}</CardTitle>
                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${isOver ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                                        {percent.toFixed(0)}% Utilizado
                                    </span>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex justify-between text-sm">
                                    <div className="space-y-1">
                                        <p className="text-muted-foreground">Consumido</p>
                                        <p className="font-bold text-lg">{formatCurrency(val)}</p>
                                    </div>
                                    <div className="space-y-1 text-right">
                                        <p className="text-muted-foreground">Presupuesto</p>
                                        {editMode ? (
                                            <Input
                                                className="h-8 w-32 text-right font-bold"
                                                type="number"
                                                value={formValues[cat] || ""}
                                                onChange={e => setFormValues({ ...formValues, [cat]: e.target.value })}
                                            />
                                        ) : (
                                            <p className="font-bold text-lg">{formatCurrency(budget)}</p>
                                        )}
                                    </div>
                                </div>
                                <Progress value={percent} className={isOver ? "bg-red-100 text-red-500" : ""} />
                                {isOver && (
                                    <p className="text-[10px] text-red-600 font-medium flex items-center gap-1">
                                        ⚠️ Excedido por {formatCurrency(val - budget)}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}

// Minimalistic Progress component if UI doesn't have it
function Progress({ value, className }: { value: number, className?: string }) {
    return (
        <div className={`h-2 w-full bg-secondary rounded-full overflow-hidden ${className}`}>
            <div
                className={`h-full bg-primary transition-all duration-500 ${value > 100 ? 'bg-red-500' : ''}`}
                style={{ width: `${Math.min(100, value)}%` }}
            />
        </div>
    );
}
