import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { addDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useCompany } from "@/contexts/CompanyContext";

// Schema matching Sprint 1 requirements (simplified for manual entry without lookups yet)
const formSchema = z.object({
    fecha: z.date(),
    fecha_vencimiento: z.date(),
    monto: z.coerce.number().min(0.01, "El monto debe ser mayor a 0."),
    tipo: z.enum(["venta", "compra"]),
    tercero_id: z.string().optional(),
    tercero_nombre: z.string().min(1, "El Cliente/Proveedor es requerido."),
    descripcion: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ManualInvoiceEntryProps {
    embedded?: boolean;
}

export default function ManualInvoiceEntry({ embedded = false }: ManualInvoiceEntryProps) {
    const { selectedEmpresaId } = useCompany();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [terceros, setTerceros] = useState<any[]>([]);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            monto: 0,
            tercero_nombre: "",
            descripcion: "",
            fecha: new Date(),
            fecha_vencimiento: addDays(new Date(), 30),
            tipo: "venta",
        },
    });

    useEffect(() => {
        if (!selectedEmpresaId) return;
        const fetchTerceros = async () => {
            try {
                const { data, error } = await supabase
                    .from('terceros')
                    .select('id, razon_social, plazo_pago_dias, tipo')
                    .eq('empresa_id', selectedEmpresaId)
                    .eq('estado', 'activo')
                    .or('es_trabajador.is.null,es_trabajador.eq.false');
                if (error) {
                    if (error.code === 'PGRST204' || error.message.includes('plazo_pago_dias')) {
                        const { data: data2 } = await supabase
                            .from('terceros')
                            .select('id, razon_social, tipo')
                            .eq('empresa_id', selectedEmpresaId)
                            .eq('estado', 'activo')
                            .or('es_trabajador.is.null,es_trabajador.eq.false');
                        setTerceros(data2 || []);
                    } else throw error;
                } else {
                    setTerceros(data || []);
                }
            } catch (e) {
                console.error("Error fetching terceros:", e);
            }
        };
        fetchTerceros();
    }, [selectedEmpresaId]);

    const watchFecha = form.watch("fecha");
    const watchTerceroId = form.watch("tercero_id");

    useEffect(() => {
        if (watchTerceroId && watchFecha) {
            const tercero = terceros.find(t => t.id === watchTerceroId);
            if (tercero) {
                const days = tercero.plazo_pago_dias ?? 30;
                form.setValue("fecha_vencimiento", addDays(watchFecha, days));
            }
        }
    }, [watchTerceroId, watchFecha, terceros]);

    async function onSubmit(values: FormValues) {
        if (!selectedEmpresaId) {
            setMessage("Debes seleccionar una empresa.");
            return;
        }
        setIsSubmitting(true);
        setMessage(null);

        try {
            // Mapping to Sprint 1 Schema:
            // tipo, monto, fecha_emision (date), descripcion, tercero_nombre
            const { error } = await supabase
                .from("facturas")
                .insert({
                    empresa_id: selectedEmpresaId,
                    created_at: new Date().toISOString(),
                    fecha_emision: format(values.fecha, 'yyyy-MM-dd'),
                    fecha_vencimiento: format(values.fecha_vencimiento, 'yyyy-MM-dd'),
                    tipo: values.tipo,
                    monto: values.monto,
                    estado: "pendiente",
                    descripcion: values.descripcion || null,
                    tercero_nombre: values.tercero_nombre,
                    tercero_id: values.tercero_id || null
                });

            if (error) {
                throw error;
            }

            setMessage("Factura guardada correctamente.");
            form.reset();
        } catch (error: any) {
            console.error("Error saving invoice:", error);
            setMessage(`Error: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
    }

    const FormContent = (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-6">
                <div className="space-y-4">
                    {/* Client Name & Date Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField<FormValues, "tercero_id">
                            control={form.control as any}
                            name="tercero_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Client / Supplier</FormLabel>
                                    <Select
                                        onValueChange={(val) => {
                                            field.onChange(val);
                                            const t = terceros.find(x => x.id === val);
                                            if (t) {
                                                form.setValue("tercero_nombre", t.razon_social);
                                                form.setValue("tipo", t.tipo === 'proveedor' ? 'compra' : 'venta');
                                                form.setValue("fecha_vencimiento", addDays(form.getValues("fecha"), t.plazo_pago_dias ?? 30));
                                            }
                                        }}
                                        defaultValue={field.value}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select from database" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {terceros.map(t => (
                                                <SelectItem key={t.id} value={t.id}>{t.razon_social} ({t.tipo})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField<FormValues, "fecha">
                            control={form.control as any}
                            name="fecha"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Invoice Date (Emisión)</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "pl-3 text-left font-normal",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                >
                                                    {field.value ? (
                                                        format(addDays(new Date(field.value.toISOString().split('T')[0] + 'T12:00:00'), 0), "PPP")
                                                    ) : (
                                                        <span>mm/dd/yyyy</span>
                                                    )}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={(date) => {
                                                    field.onChange(date);
                                                    const tid = form.getValues("tercero_id");
                                                    if (date && tid) {
                                                        const t = terceros.find(x => x.id === tid);
                                                        const days = t?.plazo_pago_dias ?? 30;
                                                        form.setValue("fecha_vencimiento", addDays(date, days));
                                                    }
                                                }}
                                                disabled={(date) =>
                                                    date > new Date() || date < new Date("1900-01-01")
                                                }
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField<FormValues, "fecha_vencimiento">
                            control={form.control as any}
                            name="fecha_vencimiento"
                            render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Due Date (Vencimiento)</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "pl-3 text-left font-normal border-primary/30",
                                                        !field.value && "text-muted-foreground"
                                                    )}
                                                >
                                                    {field.value ? (
                                                        format(addDays(new Date(field.value.toISOString().split('T')[0] + 'T12:00:00'), 0), "PPP")
                                                    ) : (
                                                        <span>mm/dd/yyyy</span>
                                                    )}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={field.onChange}
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    {/* Service & Amount Row */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                        <FormField<FormValues, "tipo">
                            control={form.control as any}
                            name="tipo"
                            render={({ field }) => (
                                <FormItem className="md:col-span-4">
                                    <FormLabel>Service Type</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select type" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="venta">Crowns & Bridges (Venta)</SelectItem>
                                            <SelectItem value="compra">Material Supply (Compra)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField<FormValues, "monto">
                            control={form.control as any}
                            name="monto"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Monto Total</FormLabel>
                                    <FormControl>
                                        <Input type="number" step="0.01" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField<FormValues, "descripcion">
                        control={form.control as any}
                        name="descripcion"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Descripción / Notas (Opcional)</FormLabel>
                                <FormControl>
                                    <Textarea placeholder="Detalle de la factura..." {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                </div>

                {message && (
                    <div className={cn("p-3 rounded text-sm", message.startsWith("Error") ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800")}>
                        {message}
                    </div>
                )}

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar Documento
                </Button>
            </form>
        </Form>
    );

    if (embedded) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Detalles del Documento</CardTitle>
                    <CardDescription>Ingrese los datos manualmente.</CardDescription>
                </CardHeader>
                <CardContent>
                    {FormContent}
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="flex justify-center items-center min-h-screen bg-gray-50 p-4">
            <Card className="w-full max-w-lg">
                <CardHeader>
                    <CardTitle>Ingreso Manual de Facturas</CardTitle>
                </CardHeader>
                <CardContent>
                    {FormContent}
                </CardContent>
            </Card>
        </div>
    );
}
