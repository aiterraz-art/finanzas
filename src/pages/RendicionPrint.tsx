import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { es } from "date-fns/locale";

export default function RendicionPrint() {
    const { id } = useParams();
    const [rendicion, setRendicion] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (id) {
            fetchRendicion();
        }
    }, [id]);

    const fetchRendicion = async () => {
        try {
            const { data, error } = await supabase
                .from('rendiciones')
                .select(`
                    *,
                    terceros (
                        razon_social,
                        rut,
                        email
                    ),
                    rendicion_detalles (*)
                `)
                .eq('id', id)
                .single();

            if (error) throw error;
            setRendicion(data);

            // Auto-print when data is loaded
            setTimeout(() => {
                window.print();
            }, 1000);
        } catch (error) {
            console.error("Error fetching rendicion:", error);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
        );
    }

    if (!rendicion) {
        return <div className="p-10 text-center">Rendición no encontrada.</div>;
    }

    return (
        <div className="max-w-[800px] mx-auto p-10 bg-white text-black print:p-0">
            {/* Header */}
            <div className="flex justify-between items-start mb-8 border-b pb-6">
                <div>
                    <h1 className="text-2xl font-bold uppercase tracking-wider mb-2">Rendición de Gastos</h1>
                    <p className="text-sm text-gray-500">Folio Interno: #{rendicion.id.slice(0, 8)}</p>
                    <div className="mt-4 text-sm">
                        <p className="font-bold">Laboratorio Dental 3D</p>
                        <p>Los Militares 5620, Las Condes</p>
                        <p>Santiago, Chile</p>
                    </div>
                </div>
                <div className="text-right">
                    <div className="bg-gray-100 p-4 rounded-lg">
                        <p className="text-xs text-gray-500 uppercase mb-1">Fecha de Solicitud</p>
                        <p className="font-bold text-lg">{format(new Date(rendicion.fecha), "dd 'de' MMMM, yyyy", { locale: es })}</p>
                    </div>
                    <div className="mt-4">
                        <p className="text-xs text-gray-500 uppercase mb-1">Estado</p>
                        <span className={`inline-block px-3 py-1 text-sm font-bold border rounded ${rendicion.estado === 'pagado' ? 'border-green-600 text-green-600' : 'border-gray-400 text-gray-600'}`}>
                            {rendicion.estado === 'pagado' ? 'PAGADO' : 'PENDIENTE'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Requester Info */}
            <div className="mb-8">
                <h3 className="text-sm font-bold uppercase text-gray-500 mb-3 border-b border-gray-100 pb-1">Solicitante</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                        <p className="text-gray-500 text-xs">Nombre / Razón Social</p>
                        <p className="font-bold">{rendicion.terceros?.razon_social}</p>
                    </div>
                    <div>
                        <p className="text-gray-500 text-xs">RUT</p>
                        <p className="font-bold">{rendicion.terceros?.rut || '---'}</p>
                    </div>
                    <div className="col-span-2">
                        <p className="text-gray-500 text-xs">Descripción General</p>
                        <p className="italic">{rendicion.descripcion || 'Sin descripción general'}</p>
                    </div>
                </div>
            </div>

            {/* Items Table */}
            <div className="mb-8">
                <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Detalle de Gastos</h3>
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-y border-gray-200">
                            <th className="text-left py-3 px-2 font-semibold">Descripción del Item</th>
                            <th className="text-right py-3 px-2 font-semibold w-32">Monto</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rendicion.rendicion_detalles?.map((item: any) => (
                            <tr key={item.id} className="border-b border-gray-100">
                                <td className="py-3 px-2 text-gray-700">{item.descripcion}</td>
                                <td className="py-3 px-2 text-right font-medium">{formatCurrency(item.monto)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td className="pt-4 px-2 text-right font-bold text-gray-600">Total a Reembolsar:</td>
                            <td className="pt-4 px-2 text-right font-bold text-xl">{formatCurrency(rendicion.monto_total)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Signatures */}
            <div className="mt-20 grid grid-cols-2 gap-20">
                <div className="text-center">
                    <div className="border-t border-gray-300 w-full pt-2"></div>
                    <p className="text-xs font-bold uppercase">Firma Solicitante</p>
                    <p className="text-xs text-gray-500">{rendicion.terceros?.razon_social}</p>
                </div>
                <div className="text-center">
                    <div className="border-t border-gray-300 w-full pt-2"></div>
                    <p className="text-xs font-bold uppercase">Firma Aprobación</p>
                    <p className="text-xs text-gray-500">Administración</p>
                </div>
            </div>

            <div className="mt-20 text-center text-xs text-gray-300 print:hidden">
                <p>Presiona Ctrl+P (Cmd+P) para imprimir o guardar como PDF.</p>
            </div>
        </div>
    );
}
