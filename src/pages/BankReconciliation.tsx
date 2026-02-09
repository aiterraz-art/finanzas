import { useState, useEffect, useRef } from "react";
import * as XLSX from 'xlsx';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Check, RefreshCw, Search, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

export default function BankReconciliation() {
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [selectedTxn, setSelectedTxn] = useState<any>(null);
    const [suggestedInvoices, setSuggestedInvoices] = useState<any[]>([]);
    const [manualSearch, setManualSearch] = useState("");
    const [isMatching, setIsMatching] = useState(false);
    const [manualInvoices, setManualInvoices] = useState<any[]>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [otherConceptReason, setOtherConceptReason] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const { data: txns, error: txnsError } = await supabase
                .from('movimientos_banco')
                .select('*')
                .order('fecha_movimiento', { ascending: false });

            if (txnsError) throw txnsError;
            setTransactions(txns || []);
        } catch (error) {
            console.error("Error fetching bank data:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchSuggestions = async (txn: any) => {
        setSelectedTxn(txn);
        setSuggestedInvoices([]);
        setManualInvoices([]);
        setManualSearch("");
        setOtherConceptReason("");
        try {
            const absMonto = Math.abs(txn.monto);

            // 1. Fetch Invoices
            let invData: any[] = [];
            if (txn.monto < 0) {
                // Para CARGOS (egresos): mostrar TODAS las facturas de proveedores pendientes
                const { data, error } = await supabase
                    .from('facturas')
                    .select('*, terceros(razon_social)')
                    .eq('estado', 'pendiente')
                    .eq('tipo', 'compra')
                    .order('fecha_emision', { ascending: false });

                if (error) throw error;
                invData = data || [];
            } else {
                // Para ABONOS (ingresos): mostrar TODAS las facturas de clientes pendientes
                const { data, error } = await supabase
                    .from('facturas')
                    .select('*, terceros(razon_social)')
                    .eq('estado', 'pendiente')
                    .eq('tipo', 'venta')
                    .order('fecha_emision', { ascending: false });

                if (error) throw error;
                invData = data || [];
            }

            // 2. Fetch Rendiciones (Only if it's a charge/egreso)
            let rendData: any[] = [];
            if (txn.monto < 0) {
                const { data, error } = await supabase
                    .from('rendiciones')
                    .select('*, terceros(razon_social)')
                    .eq('estado', 'pendiente')
                    .order('created_at', { ascending: false });
                if (!error) rendData = data?.map(r => ({ ...r, tipo_entidad: 'rendicion', monto: r.monto_total })) || [];
            }

            // Combinar y marcar los calces exactos
            const combined = [
                ...(invData?.map(i => ({
                    ...i,
                    tipo_entidad: 'factura',
                    es_calce_exacto: i.monto === absMonto
                })) || []),
                ...rendData.map(r => ({
                    ...r,
                    es_calce_exacto: r.monto === absMonto
                }))
            ];

            // Ordenar: calces exactos primero
            combined.sort((a, b) => {
                if (a.es_calce_exacto && !b.es_calce_exacto) return -1;
                if (!a.es_calce_exacto && b.es_calce_exacto) return 1;
                return 0;
            });

            setSuggestedInvoices(combined);
        } catch (error) {
            console.error("Error fetching suggestions:", error);
        }
    };

    const handleManualSearch = async () => {
        if (!manualSearch || !selectedTxn) return;

        try {
            const tipoDocs = selectedTxn.monto > 0 ? 'venta' : 'compra';

            // Search Invoices
            const { data: invData, error: invError } = await supabase
                .from('facturas')
                .select('*, terceros(razon_social)')
                .eq('estado', 'pendiente')
                .eq('tipo', tipoDocs)
                .or(`numero_documento.ilike.%${manualSearch}%,tercero_nombre.ilike.%${manualSearch}%`);

            if (invError) throw invError;

            // Search Rendiciones (Only for egresos)
            let rendData: any[] = [];
            if (selectedTxn.monto < 0) {
                const { data, error } = await supabase
                    .from('rendiciones')
                    .select('*, terceros(razon_social)')
                    .eq('estado', 'pendiente')
                    .or(`descripcion.ilike.%${manualSearch}%,tercero_nombre.ilike.%${manualSearch}%`);
                if (!error) rendData = data?.map(r => ({ ...r, tipo_entidad: 'rendicion', monto: r.monto_total })) || [];
            }

            setManualInvoices([
                ...(invData?.map(i => ({ ...i, tipo_entidad: 'factura' })) || []),
                ...rendData
            ]);
        } catch (error) {
            console.error("Error manual search:", error);
        }
    };

    const calculateStats = () => {
        const porConciliar = transactions
            .filter(t => t.estado === 'no_conciliado')
            .reduce((sum, t) => sum + Math.abs(t.monto), 0);

        const conciliadosHoy = transactions
            .filter(t => t.estado === 'conciliado' && t.created_at?.startsWith(new Date().toISOString().split('T')[0]))
            .reduce((sum, t) => sum + Math.abs(t.monto), 0);

        return { porConciliar, conciliadosHoy };
    };

    const stats = calculateStats();

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP',
            minimumFractionDigits: 0
        }).format(amount);
    };

    const handleDeleteMovimiento = async (id: string) => {
        if (!confirm("¿Estás seguro de que deseas eliminar este movimiento?")) return;

        try {
            const { error } = await supabase
                .from('movimientos_banco')
                .delete()
                .eq('id', id);

            if (error) throw error;

            setTransactions(prev => prev.filter(t => t.id !== id));
            if (selectedTxn?.id === id) setSelectedTxn(null);
        } catch (error: any) {
            alert(`Error al eliminar: ${error.message}`);
        }
    };




    const handleOtherConceptReconciliation = async () => {
        if (!selectedTxn || !otherConceptReason.trim()) return;
        setIsMatching(true);
        try {
            await supabase
                .from('movimientos_banco')
                .update({
                    estado: 'conciliado',
                    descripcion: `${selectedTxn.descripcion} [Otros: ${otherConceptReason}]`
                })
                .eq('id', selectedTxn.id);

            alert("Conciliación por otros conceptos exitosa.");
            setSelectedTxn(null);
            setSuggestedInvoices([]);
            setOtherConceptReason("");
            fetchData();
        } catch (error: any) {
            alert(`Error al conciliar: ${error.message}`);
        } finally {
            setIsMatching(false);
        }
    };

    const handleDirectReconciliation = async (_type: string, label: string) => {
        if (!selectedTxn) return;
        setIsMatching(true);
        try {
            await supabase
                .from('movimientos_banco')
                .update({
                    estado: 'conciliado',
                    descripcion: `${selectedTxn.descripcion} [${label}]`
                })
                .eq('id', selectedTxn.id);

            alert("Conciliación manual exitosa.");
            setSelectedTxn(null);
            setSuggestedInvoices([]);
            fetchData();
        } catch (error: any) {
            alert(`Error al conciliar: ${error.message}`);
        } finally {
            setIsMatching(false);
        }
    };

    const handleConfirmMatch = async (item: any) => {
        if (!selectedTxn) return;
        setIsMatching(true);
        try {
            const isRendicion = item.tipo_entidad === 'rendicion';

            // 1. Crear el vínculo en facturas_pagos
            const { error: matchError } = await supabase
                .from('facturas_pagos')
                .insert([{
                    factura_id: isRendicion ? null : item.id,
                    rendicion_id: isRendicion ? item.id : null,
                    movimiento_banco_id: selectedTxn.id,
                    monto_aplicado: item.monto
                }]);

            if (matchError) throw matchError;

            // 2. Marcar documento como pagado
            if (isRendicion) {
                await supabase
                    .from('rendiciones')
                    .update({ estado: 'pagado' })
                    .eq('id', item.id);
            } else {
                await supabase
                    .from('facturas')
                    .update({ estado: 'pagada' })
                    .eq('id', item.id);
            }

            // 3. Marcar el movimiento de banco como conciliado
            await supabase
                .from('movimientos_banco')
                .update({ estado: 'conciliado' })
                .eq('id', selectedTxn.id);

            alert("Conciliación exitosa.");
            setSelectedTxn(null);
            setSuggestedInvoices([]);
            fetchData();
        } catch (error: any) {
            alert(`Error al conciliar: ${error.message}`);
        } finally {
            setIsMatching(false);
        }
    };

    const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Obtenemos los datos como un array de arrays (filas crudas)
                const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

                if (rows.length === 0) {
                    alert("El archivo está vacío.");
                    return;
                }

                // Buscamos la fila que contiene las cabeceras reales
                let headerIndex = -1;
                const keywords = ['fecha', 'monto', 'descripción', 'cargo', 'abono'];

                for (let i = 0; i < Math.min(rows.length, 20); i++) { // Buscamos en las primeras 20 filas
                    const row = rows[i];
                    if (!Array.isArray(row)) continue;

                    const containsKeywords = row.some(cell =>
                        typeof cell === 'string' && keywords.some(k => cell.toLowerCase().includes(k))
                    );
                    if (containsKeywords) {
                        headerIndex = i;
                        break;
                    }
                }

                if (headerIndex === -1) {
                    console.log("No se detectó fila de cabecera clara. Usando primera fila con datos por defecto.");
                    headerIndex = rows.findIndex(r => r.length > 2); // Primera fila con más de 2 columnas
                    if (headerIndex === -1) headerIndex = 0;
                }

                console.log("Fila de cabecera encontrada en índice:", headerIndex);
                console.log("Contenido cabecera:", rows[headerIndex]);

                const headerRow = rows[headerIndex].map(h => String(h || "").trim());
                const dataRows = rows.slice(headerIndex + 1);

                // Mapeo de movimientos
                const movements = dataRows.map((rowArr: any[]) => {
                    // Creamos un objeto para esta fila usando la cabecera encontrada
                    const row: any = {};
                    headerRow.forEach((h, idx) => {
                        if (h) row[h] = rowArr[idx];
                    });

                    // Función auxiliar para buscar nombres de columnas parecidos
                    const getVal = (patterns: string[]) => {
                        // Primero: Intento de coincidencia exacta
                        const exactKey = Object.keys(row).find(k =>
                            patterns.some(p => k.toLowerCase() === p.toLowerCase())
                        );
                        if (exactKey) return row[exactKey];

                        // Segundo: Coincidencia parcial
                        const key = Object.keys(row).find(k =>
                            patterns.some(p => k.toLowerCase().includes(p.toLowerCase()))
                        );
                        return key ? row[key] : undefined;
                    };

                    const fecha = getVal(['fecha', 'date']) || '';
                    const descripcion = getVal(['descripción', 'description', 'detalle', 'concepto']) || '';
                    const sucursal = getVal(['sucursal', 'oficina', 'canal']) || '';
                    const nOperacion = String(getVal(['n° doc', 'nro doc', 'documento', 'operación', 'referencia']) || '');

                    const cargoVal = getVal(['cargos', 'cargo', 'débito', 'salida']);
                    const abonoVal = getVal(['abonos', 'abono', 'crédito', 'depósito', 'entrada']);
                    const montoGeneralVal = getVal(['monto', 'valor', 'importe', 'monto total']);
                    const saldoVal = getVal(['saldo', 'balance', 'remanente']) || 0;

                    const cleanNumber = (val: any) => {
                        if (val === undefined || val === null || val === '') return 0;
                        if (typeof val === 'number') return val;
                        const cleaned = String(val).replace(/[$. \t]/g, '').replace(',', '.');
                        return parseFloat(cleaned) || 0;
                    };

                    let monto = 0;
                    if (montoGeneralVal !== undefined && montoGeneralVal !== 0 && montoGeneralVal !== "") {
                        // Si hay una columna general de monto, confiamos en su signo
                        monto = cleanNumber(montoGeneralVal);
                    } else {
                        // Si hay columnas separadas, restamos el cargo al abono (usando valor absoluto para no duplicar signos negativos)
                        const cargo = Math.abs(cleanNumber(cargoVal));
                        const abono = Math.abs(cleanNumber(abonoVal));
                        monto = abono - cargo;
                    }

                    const saldo = cleanNumber(saldoVal);

                    return {
                        fecha_movimiento: parseDate(fecha),
                        descripcion: String(descripcion || "").trim(),
                        sucursal: String(sucursal || "").trim(),
                        n_operacion: nOperacion,
                        monto,
                        saldo,
                        estado: 'no_conciliado'
                    };
                }).filter(m => m.fecha_movimiento && (m.monto !== 0 || m.n_operacion));

                console.log("Movimientos procesados:", movements.length);
                if (movements.length > 0) {
                    console.log("PRIMER movimiento (Top del Excel):", movements[0]);
                    console.log("ÚLTIMO movimiento (Bottom del Excel):", movements[movements.length - 1]);
                }

                if (movements.length === 0) {
                    alert("No se encontraron movimientos válidos en el archivo después de detectar la cabecera.");
                    return;
                }

                // Detección de duplicados
                const nOperaciones = movements.map(m => m.n_operacion).filter(n => n !== "");

                let existingNOperaciones: string[] = [];
                if (nOperaciones.length > 0) {
                    const { data: existing } = await supabase
                        .from('movimientos_banco')
                        .select('n_operacion')
                        .in('n_operacion', nOperaciones);

                    existingNOperaciones = (existing || []).map(e => e.n_operacion);
                }

                const toInsert = movements.filter(m => !existingNOperaciones.includes(m.n_operacion));
                const duplicatesCount = movements.length - toInsert.length;

                if (toInsert.length > 0) {
                    // Reversamos el orden para que los movimientos de "más arriba" en el Excel 
                    // (que suelen ser los más recientes) se inserten al final y tengan el id_secuencial más alto.
                    const { error: insertError } = await supabase
                        .from('movimientos_banco')
                        .insert([...toInsert].reverse());

                    if (insertError) throw insertError;

                    alert(`Importación exitosa:\n- ${toInsert.length} movimientos nuevos agregados.\n- ${duplicatesCount} movimientos duplicados omitidos.`);
                } else {
                    alert(`No hay movimientos nuevos para importar.\n- ${duplicatesCount} movimientos ya existían en el sistema.`);
                }

                fetchData();
            } catch (error: any) {
                console.error("Error importing file:", error);
                alert(`Error al procesar el archivo: ${error.message}`);
            } finally {
                setIsImporting(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        };

        reader.readAsArrayBuffer(file);
    };

    const parseDate = (dateVal: any) => {
        if (!dateVal) return null;
        // Si es número de Excel
        if (typeof dateVal === 'number') {
            const date = XLSX.utils.format_cell({ v: dateVal, t: 'd' });
            return date;
        }
        // Si es string (DD/MM/YYYY o YYYY-MM-DD)
        const parts = String(dateVal).split(/[-/]/);
        if (parts.length === 3) {
            if (parts[0].length === 4) return `${parts[0]}-${parts[1]}-${parts[2]}`; // YYYY-MM-DD
            return `${parts[2]}-${parts[1]}-${parts[0]}`; // DD/MM/YYYY -> YYYY-MM-DD
        }
        return null;
    };

    const filteredTransactions = transactions.filter(t => {
        if (filter === "unmatched") return t.estado === "no_conciliado";
        if (filter === "matched") return t.estado === "conciliado";
        if (filter === "abonos") return t.monto > 0;
        if (filter === "egresos") return t.monto < 0;
        return true;
    });

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Banco y Conciliación</h1>
                    <p className="text-muted-foreground mt-1">
                        Vincula movimientos bancarios con documentos para saldar deudas.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="gap-2" onClick={fetchData}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Actualizar
                    </Button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleImportFile}
                    />
                    <Button
                        className="gap-2 bg-primary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isImporting}
                    >
                        {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {isImporting ? "Procesando..." : "Importar Cartola"}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-amber-50 border-amber-100">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-medium text-amber-600 uppercase">Por Conciliar</CardTitle>
                        <CardDescription className="text-xl font-bold text-amber-900">{formatCurrency(stats.porConciliar)}</CardDescription>
                    </CardHeader>
                </Card>
                <Card className="bg-green-50 border-green-100">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-medium text-green-600 uppercase">Conciliados Hoy</CardTitle>
                        <CardDescription className="text-xl font-bold text-green-900">{formatCurrency(stats.conciliadosHoy)}</CardDescription>
                    </CardHeader>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-3 space-y-4">
                    <div className="flex gap-2 pb-2 border-b">
                        <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>Todos</Button>
                        <Button variant={filter === "unmatched" ? "default" : "outline"} size="sm" onClick={() => setFilter("unmatched")}>Por Conciliar</Button>
                        <Button variant={filter === "matched" ? "default" : "outline"} size="sm" onClick={() => setFilter("matched")}>Conciliados</Button>
                        <Button variant={filter === "abonos" ? "default" : "outline"} size="sm" onClick={() => setFilter("abonos")}>Abonos</Button>
                        <Button variant={filter === "egresos" ? "default" : "outline"} size="sm" onClick={() => setFilter("egresos")}>Egresos</Button>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {filteredTransactions.map((txn) => (
                                <Popover key={txn.id} onOpenChange={(open) => {
                                    if (open) fetchSuggestions(txn);
                                    else setSelectedTxn(null);
                                }}>
                                    <PopoverTrigger asChild>
                                        <Card
                                            className={cn(
                                                "transition-all cursor-pointer hover:shadow-md",
                                                txn.estado === "conciliado" ? "opacity-60 bg-muted/20" : "bg-card border-l-4",
                                                txn.estado !== "conciliado" && (txn.monto > 0 ? "border-l-green-500" : "border-l-red-500")
                                            )}
                                        >
                                            <CardContent className="p-4 flex items-center gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-semibold text-sm truncate uppercase">{txn.description}</p>
                                                            <Badge variant="outline" className={cn("text-[8px] px-1", txn.monto > 0 ? "text-green-600 border-green-200" : "text-red-600 border-red-200")}>
                                                                {txn.monto > 0 ? "ABONO" : "CARGO"}
                                                            </Badge>
                                                        </div>
                                                        <span className={cn("font-bold text-sm", txn.monto > 0 ? "text-green-600" : "text-slate-900")}>
                                                            {txn.monto < 0 ? "-" : ""}{formatCurrency(Math.abs(txn.monto))}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between items-center mt-1">
                                                        <div>
                                                            <p className="text-xs text-muted-foreground">{txn.fecha_movimiento}</p>
                                                            {txn.n_operacion && (
                                                                <p className="text-[10px] text-muted-foreground font-mono">ID: {txn.n_operacion}</p>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <Badge variant={txn.estado === "conciliado" ? "default" : "secondary"} className="text-[10px] uppercase">
                                                                {txn.estado === "conciliado" ? "Conciliado" : "Pendiente"}
                                                            </Badge>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 text-muted-foreground hover:text-red-600"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDeleteMovimiento(txn.id);
                                                                }}
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </PopoverTrigger>

                                    <PopoverContent className="w-[400px] p-0" align="start">
                                        <div className="p-4 border-b bg-muted/10">
                                            <h4 className="font-bold text-sm">Conciliar Movimiento</h4>
                                            <p className="text-xs text-muted-foreground">Monto: {formatCurrency(Math.abs(txn.monto))}</p>
                                        </div>
                                        <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
                                            {suggestedInvoices.length > 0 && (
                                                <div className="space-y-3">
                                                    <p className="text-[10px] font-bold text-primary uppercase flex items-center gap-2">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                                        Calces Exactos:
                                                    </p>
                                                    {suggestedInvoices.map((doc) => (
                                                        <div key={doc.id} className="border rounded-lg p-3 bg-white shadow-sm border-primary/10 transition-colors hover:bg-slate-50">
                                                            <div className="flex justify-between items-center mb-1">
                                                                <span className="font-bold text-xs">
                                                                    {doc.tipo_entidad === 'rendicion' ? 'Rendición' : `Factura #${doc.numero_documento || '---'}`}
                                                                </span>
                                                                <span className="font-bold text-green-600 text-xs">{formatCurrency(doc.monto)}</span>
                                                            </div>
                                                            <p className="text-[11px] text-slate-900 font-semibold mb-2">{doc.terceros?.razon_social || 'Desconocido'}</p>
                                                            <Button
                                                                size="sm"
                                                                className="w-full bg-green-600 hover:bg-green-700 h-7 text-[10px]"
                                                                onClick={() => handleConfirmMatch(doc)}
                                                                disabled={isMatching}
                                                            >
                                                                {isMatching ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="w-3 h-3 mr-1" /> Vincular Pago</>}
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="space-y-2 mb-4 pt-2 border-t">
                                                <p className="text-[10px] font-bold text-muted-foreground uppercase">Conciliación Directa:</p>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-full text-xs h-8 border-dashed"
                                                            onClick={() => handleDirectReconciliation('remuneracion', 'Remuneración')}
                                                        >
                                                            Remuneraciones
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="space-y-2 mb-4 pt-2 border-t">
                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Otros Conceptos:</p>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            placeholder="Razón del gasto (ej. Taxi, Materiales...)"
                                                            className="h-8 text-xs"
                                                            value={otherConceptReason}
                                                            onChange={(e) => setOtherConceptReason(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && handleOtherConceptReconciliation()}
                                                        />
                                                        <Button
                                                            size="sm"
                                                            className="h-8 bg-blue-600 hover:bg-blue-700"
                                                            onClick={handleOtherConceptReconciliation}
                                                            disabled={!otherConceptReason.trim() || isMatching}
                                                        >
                                                            {isMatching ? <Loader2 className="w-3 h-3 animate-spin" /> : "OK"}
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Búsqueda Manual:</p>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            placeholder="RUT o Razón Social..."
                                                            className="h-8 text-xs"
                                                            value={manualSearch}
                                                            onChange={(e) => setManualSearch(e.target.value)}
                                                            onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                                                        />
                                                        <Button size="sm" className="h-8 w-8 p-0" variant="secondary" onClick={handleManualSearch}>
                                                            <Search className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {manualInvoices.length > 0 && (
                                                    <div className="space-y-3 mt-4">
                                                        {manualInvoices.map((doc) => (
                                                            <div key={doc.id} className="border rounded-lg p-3 bg-white border-slate-200">
                                                                <div className="flex justify-between items-center mb-1">
                                                                    <span className="font-bold text-xs">
                                                                        {doc.tipo_entidad === 'rendicion' ? 'Rendición' : `#${doc.numero_documento}`}
                                                                    </span>
                                                                    <span className="font-bold text-slate-900 text-xs">{formatCurrency(doc.monto)}</span>
                                                                </div>
                                                                <p className="text-[11px] text-muted-foreground truncate mb-2">{doc.terceros?.razon_social}</p>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="w-full h-7 text-[10px]"
                                                                    onClick={() => handleConfirmMatch(doc)}
                                                                    disabled={isMatching}
                                                                >
                                                                    Vincular este documento
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {suggestedInvoices.length === 0 && manualInvoices.length === 0 && (
                                                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-lg">
                                                        <AlertCircle className="h-4 w-4 text-amber-500 mb-2" />
                                                        <p className="text-xs font-semibold text-amber-900">Sin calces</p>
                                                        <p className="text-[10px] text-amber-800">Usa el buscador para encontrar documentos por RUT o nombre.</p>
                                                    </div>
                                                )}
                                            </div>
                                    </PopoverContent>
                                </Popover>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
