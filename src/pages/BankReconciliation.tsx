import { useState, useEffect, useRef } from "react";
import * as XLSX from 'xlsx';
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Check, RefreshCw, Search, Loader2, AlertCircle, Trash2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useCompany } from "@/contexts/CompanyContext";

export default function BankReconciliation() {
    const { selectedEmpresaId } = useCompany();
    const [transactions, setTransactions] = useState<any[]>([]);
    const [customColumns, setCustomColumns] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [selectedTxn, setSelectedTxn] = useState<any>(null);
    const [suggestedInvoices, setSuggestedInvoices] = useState<any[]>([]);
    const [suggestedRendiciones, setSuggestedRendiciones] = useState<any[]>([]);
    const [manualSearch, setManualSearch] = useState("");
    const [isMatching, setIsMatching] = useState(false);
    const [manualInvoices, setManualInvoices] = useState<any[]>([]);
    const [isImporting, setIsImporting] = useState(false);
    const [otherConceptReason, setOtherConceptReason] = useState("");
    const [newColumnName, setNewColumnName] = useState("");
    const [newColumnKey, setNewColumnKey] = useState("");
    const [newColumnType, setNewColumnType] = useState("texto");
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (selectedEmpresaId) {
            fetchData();
            fetchCustomColumns();
        }
    }, [selectedEmpresaId]);

    const fetchData = async () => {
        if (!selectedEmpresaId) return;
        setLoading(true);
        try {
            const { data: txns, error: txnsError } = await supabase
                .from('movimientos_banco')
                .select(`
                    *,
                    facturas_pagos (
                        facturas (
                            numero_documento,
                            terceros (razon_social)
                        ),
                        rendiciones (
                            id,
                            descripcion,
                            terceros (razon_social)
                        )
                    )
                `)
                .eq('empresa_id', selectedEmpresaId)
                .order('fecha_movimiento', { ascending: false });

            if (txnsError) throw txnsError;
            setTransactions(txns || []);
        } catch (error) {
            console.error("Error fetching bank data:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCustomColumns = async () => {
        if (!selectedEmpresaId) return;
        try {
            const { data, error } = await supabase
                .from('bank_import_column_configs')
                .select('*')
                .eq('empresa_id', selectedEmpresaId)
                .eq('activa', true)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setCustomColumns(data || []);
        } catch (error) {
            console.error("Error fetching custom bank columns:", error);
        }
    };

    const normalizeColumnKey = (input: string) => {
        return input
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
    };

    const handleAddCustomColumn = async () => {
        if (!selectedEmpresaId) return;
        const nombre = newColumnName.trim();
        const clave = normalizeColumnKey(newColumnKey || newColumnName);
        if (!nombre || !clave) {
            alert("Nombre y clave de columna son obligatorios.");
            return;
        }

        try {
            const { error } = await supabase.from('bank_import_column_configs').upsert([{
                empresa_id: selectedEmpresaId,
                nombre,
                clave,
                tipo: newColumnType,
                activa: true,
            }], { onConflict: 'empresa_id,clave' });

            if (error) throw error;
            setNewColumnName("");
            setNewColumnKey("");
            setNewColumnType("texto");
            fetchCustomColumns();
        } catch (error: any) {
            alert(`Error al crear columna: ${error.message}`);
        }
    };

    const handleSaveTreasurerComment = async (txnId: string, comment: string) => {
        if (!selectedEmpresaId) return;
        const { error } = await supabase
            .from('movimientos_banco')
            .update({ comentario_tesoreria: comment })
            .eq('id', txnId)
            .eq('empresa_id', selectedEmpresaId);

        if (error) {
            alert(`No se pudo guardar comentario: ${error.message}`);
            return;
        }

        setTransactions((prev) => prev.map((t) => t.id === txnId ? { ...t, comentario_tesoreria: comment } : t));
    };

    const handleSaveExtraField = async (txn: any, key: string, value: string) => {
        if (!selectedEmpresaId) return;
        const nextExtra = { ...(txn.columnas_extra || {}), [key]: value };

        const { error } = await supabase
            .from('movimientos_banco')
            .update({ columnas_extra: nextExtra })
            .eq('id', txn.id)
            .eq('empresa_id', selectedEmpresaId);

        if (error) {
            alert(`No se pudo guardar columna extra: ${error.message}`);
            return;
        }
        setTransactions((prev) => prev.map((t) => t.id === txn.id ? { ...t, columnas_extra: nextExtra } : t));
    };

    // ... (keep existing helper functions like fetchSuggestions, handleManualSearch, etc. - I will need to be careful not to delete them if I'm not careful with replacement ranges, but here I am creating a large replacement for the render part mainly)

    // WAIT, replacing the whole file or large chunks is risky if I miss functions.
    // I will replace specific parts.

    // Part 1: Update fetchData
    // Part 2: Update Render

    // Actually, I'll do this in multiple steps to be safe.
    // First, update fetchData.

    const fetchSuggestions = async (txn: any) => {
        if (!selectedEmpresaId) return;
        setSelectedTxn(txn);
        setSuggestedInvoices([]);
        setSuggestedRendiciones([]);
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
                    .eq('empresa_id', selectedEmpresaId)
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
                    .eq('empresa_id', selectedEmpresaId)
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
                    .eq('empresa_id', selectedEmpresaId)
                    .eq('estado', 'pendiente')
                    .order('created_at', { ascending: false });
                if (!error) rendData = data?.map(r => ({ ...r, tipo_entidad: 'rendicion', monto: r.monto_total })) || [];
            }

            // 3. Process Invoices
            const invoices = (invData?.map(i => ({
                ...i,
                tipo_entidad: 'factura',
                es_calce_exacto: i.monto === absMonto
            })) || []).sort((a, b) => {
                if (a.es_calce_exacto && !b.es_calce_exacto) return -1;
                if (!a.es_calce_exacto && b.es_calce_exacto) return 1;
                return 0;
            });

            // 4. Process Rendiciones
            const renditions = rendData.map(r => ({
                ...r,
                es_calce_exacto: r.monto === absMonto
            }));

            setSuggestedInvoices(invoices);
            setSuggestedRendiciones(renditions);
        } catch (error) {
            console.error("Error fetching suggestions:", error);
        }
    };

    const handleManualSearch = async () => {
        if (!manualSearch || !selectedTxn || !selectedEmpresaId) return;

        try {
            const tipoDocs = selectedTxn.monto > 0 ? 'venta' : 'compra';

            // Search Invoices
            const { data: invData, error: invError } = await supabase
                .from('facturas')
                .select('*, terceros(razon_social)')
                .eq('empresa_id', selectedEmpresaId)
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
                    .eq('empresa_id', selectedEmpresaId)
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

    const getLibroBancoRows = (rows: any[]) => {
        return rows.map((txn) => {
            const base: Record<string, any> = {
                "N° Movimiento": txn.id_secuencial || "",
                "Fecha": txn.fecha_movimiento || "",
                "Descripción Movimiento": txn.descripcion || "",
                "Salida Banco": Number(txn.salida_banco ?? (txn.monto < 0 ? Math.abs(txn.monto) : 0)),
                "Entrada Banco": Number(txn.entrada_banco ?? (txn.monto > 0 ? txn.monto : 0)),
                "Comentario Tesorería": txn.comentario_tesoreria || "",
                "Estado": txn.estado || "",
                "Tipo Conciliación": txn.tipo_conciliacion || "",
                "Sucursal": txn.sucursal || "",
                "N° Operación": txn.n_operacion || "",
            };

            customColumns.forEach((col) => {
                base[col.nombre] = txn.columnas_extra?.[col.clave] ?? "";
            });

            return base;
        });
    };

    const exportLibroBanco = () => {
        const rows = getLibroBancoRows(filteredTransactions);
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Libro Banco");
        XLSX.writeFile(wb, `Libro_Banco_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const printLibroBanco = () => {
        const rows = getLibroBancoRows(filteredTransactions);
        const headers = Object.keys(rows[0] || {
            "N° Movimiento": "",
            "Fecha": "",
            "Descripción Movimiento": "",
            "Salida Banco": "",
            "Entrada Banco": "",
            "Comentario Tesorería": "",
            "Estado": "",
            "Tipo Conciliación": "",
            "Sucursal": "",
            "N° Operación": "",
        });

        const body = rows.map((row) => (
            `<tr>${headers.map((h) => `<td>${row[h] ?? ""}</td>`).join("")}</tr>`
        )).join("");

        const html = `
            <html>
              <head>
                <title>Libro Banco</title>
                <style>
                  body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
                  h1 { margin: 0 0 4px; font-size: 20px; }
                  p { margin: 0 0 16px; color: #64748b; font-size: 12px; }
                  table { width: 100%; border-collapse: collapse; font-size: 11px; }
                  th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
                  th { background: #f1f5f9; font-weight: 700; }
                </style>
              </head>
              <body>
                <h1>Libro Banco</h1>
                <p>Fecha de impresión: ${new Date().toLocaleString('es-CL')}</p>
                <table>
                  <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
                  <tbody>${body}</tbody>
                </table>
              </body>
            </html>
        `;

        const w = window.open("", "_blank", "width=1200,height=800");
        if (!w) return;
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
    };

    const handleDeleteMovimiento = async (id: string) => {
        if (!selectedEmpresaId) return;
        if (!confirm("¿Estás seguro de que deseas eliminar este movimiento?")) return;

        try {
            const { error } = await supabase
                .from('movimientos_banco')
                .delete()
                .eq('id', id)
                .eq('empresa_id', selectedEmpresaId);

            if (error) throw error;

            setTransactions(prev => prev.filter(t => t.id !== id));
            if (selectedTxn?.id === id) setSelectedTxn(null);
        } catch (error: any) {
            alert(`Error al eliminar: ${error.message}`);
        }
    };




    const handleOtherConceptReconciliation = async () => {
        if (!selectedTxn || !otherConceptReason.trim() || !selectedEmpresaId) return;
        if (selectedTxn.monto > 0) {
            alert("Los ingresos deben conciliarse con pagos de facturas de clientes.");
            return;
        }
        setIsMatching(true);
        try {
            await supabase
                .from('movimientos_banco')
                .update({
                    estado: 'conciliado',
                    tipo_conciliacion: 'otros_egresos',
                    descripcion: `${selectedTxn.descripcion} [Otros: ${otherConceptReason}]`
                })
                .eq('id', selectedTxn.id)
                .eq('empresa_id', selectedEmpresaId);

            alert("Conciliación por otros conceptos exitosa.");
            setSelectedTxn(null);
            setSuggestedInvoices([]);
            setSuggestedRendiciones([]);
            setOtherConceptReason("");
            fetchData();
        } catch (error: any) {
            alert(`Error al conciliar: ${error.message}`);
        } finally {
            setIsMatching(false);
        }
    };

    const handleDirectReconciliation = async (_type: string, label: string) => {
        if (!selectedTxn || !selectedEmpresaId) return;
        if (selectedTxn.monto > 0) {
            alert("Los ingresos deben conciliarse contra facturas de clientes.");
            return;
        }
        setIsMatching(true);
        try {
            await supabase
                .from('movimientos_banco')
                .update({
                    estado: 'conciliado',
                    tipo_conciliacion: _type,
                    descripcion: `${selectedTxn.descripcion} [${label}]`
                })
                .eq('id', selectedTxn.id)
                .eq('empresa_id', selectedEmpresaId);

            alert("Conciliación manual exitosa.");
            setSelectedTxn(null);
            setSuggestedInvoices([]);
            setSuggestedRendiciones([]);
            fetchData();
        } catch (error: any) {
            alert(`Error al conciliar: ${error.message}`);
        } finally {
            setIsMatching(false);
        }
    };

    const handleConfirmMatch = async (item: any) => {
        if (!selectedTxn || !selectedEmpresaId) return;
        setIsMatching(true);
        try {
            const isRendicion = item.tipo_entidad === 'rendicion';

            // 1. Crear el vínculo en facturas_pagos
            const { error: matchError } = await supabase
                .from('facturas_pagos')
                .insert([{
                    empresa_id: selectedEmpresaId,
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
                    .eq('id', item.id)
                    .eq('empresa_id', selectedEmpresaId);
            } else {
                await supabase
                    .from('facturas')
                    .update({ estado: 'pagada' })
                    .eq('id', item.id)
                    .eq('empresa_id', selectedEmpresaId);
            }

            // 3. Marcar el movimiento de banco como conciliado
            await supabase
                .from('movimientos_banco')
                .update({ estado: 'conciliado', tipo_conciliacion: isRendicion ? 'rendicion' : 'factura' })
                .eq('id', selectedTxn.id)
                .eq('empresa_id', selectedEmpresaId);

            alert("Conciliación exitosa.");
            setSelectedTxn(null);
            setSuggestedInvoices([]);
            setSuggestedRendiciones([]);
            fetchData();
        } catch (error: any) {
            alert(`Error al conciliar: ${error.message}`);
        } finally {
            setIsMatching(false);
        }
    };

    const handleUndoReconciliation = async (txn: any) => {
        if (!selectedEmpresaId) return;
        if (!confirm("¿Deseas deshacer esta conciliación?")) return;
        setIsMatching(true);
        try {
            const { data: links, error: linkError } = await supabase
                .from('facturas_pagos')
                .select('id, factura_id, rendicion_id')
                .eq('movimiento_banco_id', txn.id)
                .eq('empresa_id', selectedEmpresaId);

            if (linkError) throw linkError;

            const facturaIds = (links || []).map(l => l.factura_id).filter(Boolean);
            const rendicionIds = (links || []).map(l => l.rendicion_id).filter(Boolean);

            if (facturaIds.length > 0) {
                const { error } = await supabase
                    .from('facturas')
                    .update({ estado: 'pendiente' })
                    .eq('empresa_id', selectedEmpresaId)
                    .in('id', facturaIds);
                if (error) throw error;
            }

            if (rendicionIds.length > 0) {
                const { error } = await supabase
                    .from('rendiciones')
                    .update({ estado: 'pendiente' })
                    .eq('empresa_id', selectedEmpresaId)
                    .in('id', rendicionIds);
                if (error) throw error;
            }

            if ((links || []).length > 0) {
                const { error } = await supabase
                    .from('facturas_pagos')
                    .delete()
                    .eq('movimiento_banco_id', txn.id)
                    .eq('empresa_id', selectedEmpresaId);
                if (error) throw error;
            }

            const { error: updateTxnError } = await supabase
                .from('movimientos_banco')
                .update({ estado: 'no_conciliado', tipo_conciliacion: null })
                .eq('id', txn.id)
                .eq('empresa_id', selectedEmpresaId);
            if (updateTxnError) throw updateTxnError;

            alert("Conciliación deshecha correctamente.");
            fetchData();
        } catch (error: any) {
            alert(`Error al deshacer conciliación: ${error.message}`);
        } finally {
            setIsMatching(false);
        }
    };

    const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!selectedEmpresaId) return;
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

                    const entradaBanco = Math.abs(cleanNumber(abonoVal));
                    const salidaBanco = Math.abs(cleanNumber(cargoVal));
                    let monto = 0;
                    if (montoGeneralVal !== undefined && montoGeneralVal !== 0 && montoGeneralVal !== "") {
                        // Si hay una columna general de monto, confiamos en su signo
                        monto = cleanNumber(montoGeneralVal);
                    } else {
                        // Si hay columnas separadas, restamos el cargo al abono (usando valor absoluto para no duplicar signos negativos)
                        monto = entradaBanco - salidaBanco;
                    }

                    const saldo = cleanNumber(saldoVal);
                    const extraCols: Record<string, any> = {};
                    Object.entries(row).forEach(([k, v]) => {
                        const keyLower = k.toLowerCase();
                        const isStandard =
                            keyLower.includes('fecha') ||
                            keyLower.includes('monto') ||
                            keyLower.includes('valor') ||
                            keyLower.includes('importe') ||
                            keyLower.includes('cargos') ||
                            keyLower.includes('cargo') ||
                            keyLower.includes('abonos') ||
                            keyLower.includes('abono') ||
                            keyLower.includes('débito') ||
                            keyLower.includes('debito') ||
                            keyLower.includes('crédito') ||
                            keyLower.includes('credito') ||
                            keyLower.includes('saldo') ||
                            keyLower.includes('descripción') ||
                            keyLower.includes('description') ||
                            keyLower.includes('detalle') ||
                            keyLower.includes('concepto') ||
                            keyLower.includes('sucursal') ||
                            keyLower.includes('oficina') ||
                            keyLower.includes('canal') ||
                            keyLower.includes('operación') ||
                            keyLower.includes('operacion') ||
                            keyLower.includes('referencia') ||
                            keyLower.includes('doc');

                        if (!isStandard && v !== undefined && v !== null && String(v).trim() !== '') {
                            extraCols[k] = v;
                        }
                    });

                    return {
                        fecha_movimiento: parseDate(fecha),
                        descripcion: String(descripcion || "").trim(),
                        sucursal: String(sucursal || "").trim(),
                        n_operacion: nOperacion,
                        monto,
                        entrada_banco: entradaBanco,
                        salida_banco: salidaBanco,
                        comentario_tesoreria: null,
                        columnas_extra: extraCols,
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
                        .eq('empresa_id', selectedEmpresaId)
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
                        .insert([...toInsert].reverse().map((m) => ({ ...m, empresa_id: selectedEmpresaId })));

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
                    <h1 className="text-3xl font-bold tracking-tight">Banco y Conciliación (Listado)</h1>
                    <p className="text-muted-foreground mt-1">
                        Vincula movimientos bancarios con documentos para saldar deudas.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="gap-2" onClick={fetchData}>
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Actualizar
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={exportLibroBanco}>
                        Exportar Libro Banco
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={printLibroBanco}>
                        Imprimir Libro Banco
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

            <div className="space-y-4">
                <div className="flex flex-wrap gap-2 pb-2 border-b">
                    <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>Todos</Button>
                    <Button variant={filter === "unmatched" ? "default" : "outline"} size="sm" onClick={() => setFilter("unmatched")}>Por Conciliar</Button>
                    <Button variant={filter === "matched" ? "default" : "outline"} size="sm" onClick={() => setFilter("matched")}>Conciliados</Button>
                    <Button variant={filter === "abonos" ? "default" : "outline"} size="sm" onClick={() => setFilter("abonos")}>Abonos</Button>
                    <Button variant={filter === "egresos" ? "default" : "outline"} size="sm" onClick={() => setFilter("egresos")}>Egresos</Button>
                </div>

                <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Columnas adicionales por empresa</p>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <Input
                            placeholder="Nombre columna (ej: Centro Costo)"
                            value={newColumnName}
                            onChange={(e) => setNewColumnName(e.target.value)}
                        />
                        <Input
                            placeholder="Clave opcional (ej: centro_costo)"
                            value={newColumnKey}
                            onChange={(e) => setNewColumnKey(e.target.value)}
                        />
                        <select
                            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                            value={newColumnType}
                            onChange={(e) => setNewColumnType(e.target.value)}
                        >
                            <option value="texto">Texto</option>
                            <option value="numero">Número</option>
                            <option value="fecha">Fecha</option>
                            <option value="booleano">Booleano</option>
                        </select>
                        <Button onClick={handleAddCustomColumn}>Agregar Columna</Button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : (
                    <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 border-b">
                                <tr>
                                    <th className="text-left p-3 font-semibold w-20">N° Mov.</th>
                                    <th className="text-left p-3 font-semibold w-24">Fecha</th>
                                    <th className="text-left p-3 font-semibold min-w-[260px]">Descripción Movimiento</th>
                                    <th className="text-right p-3 font-semibold w-32">Salida Banco</th>
                                    <th className="text-right p-3 font-semibold w-32">Entrada Banco</th>
                                    <th className="text-left p-3 font-semibold min-w-[220px]">Comentario Tesorería</th>
                                    {customColumns.map((col) => (
                                        <th key={col.id} className="text-left p-3 font-semibold min-w-[180px]">{col.nombre}</th>
                                    ))}
                                    <th className="text-left p-3 font-semibold w-64">Estado / Conciliación</th>
                                    <th className="p-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTransactions.map((txn) => {
                                    // Extract match info
                                    const match = txn.facturas_pagos?.[0];
                                    const matchedFactura = match?.facturas;
                                    const matchedRendicion = match?.rendiciones;

                                    return (
                                        <tr
                                            key={txn.id}
                                            className={cn(
                                                "border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer",
                                                selectedTxn?.id === txn.id && "bg-blue-50 hover:bg-blue-50"
                                            )}
                                        >
                                            <Popover open={selectedTxn?.id === txn.id} onOpenChange={(open) => {
                                                if (open) fetchSuggestions(txn);
                                                else setSelectedTxn(null);
                                            }}>
                                                <PopoverTrigger asChild>
                                                    <td className="p-3 align-top" onClick={() => fetchSuggestions(txn)}>
                                                        <div className="font-bold text-xs">#{txn.id_secuencial || "-"}</div>
                                                    </td>
                                                </PopoverTrigger>

                                                <td className="p-3 align-top" onClick={() => fetchSuggestions(txn)}>
                                                        <div className="font-mono text-xs text-muted-foreground">{txn.fecha_movimiento}</div>
                                                        {txn.n_operacion && <div className="text-[10px] text-muted-foreground">OP: {txn.n_operacion}</div>}
                                                    </td>

                                                <td className="p-3 align-top" onClick={() => fetchSuggestions(txn)}>
                                                    <div className="font-medium text-slate-700">{txn.descripcion}</div>
                                                    <div className="text-xs text-muted-foreground">{txn.sucursal}</div>
                                                </td>

                                                <td className="p-3 align-top text-right" onClick={() => fetchSuggestions(txn)}>
                                                    <div className="font-bold text-red-600">
                                                        {formatCurrency(txn.salida_banco ?? (txn.monto < 0 ? Math.abs(txn.monto) : 0))}
                                                    </div>
                                                </td>

                                                <td className="p-3 align-top text-right" onClick={() => fetchSuggestions(txn)}>
                                                    <div className="font-bold text-green-600">
                                                        {formatCurrency(txn.entrada_banco ?? (txn.monto > 0 ? txn.monto : 0))}
                                                    </div>
                                                </td>

                                                <td className="p-3 align-top">
                                                    <Input
                                                        defaultValue={txn.comentario_tesoreria || ""}
                                                        placeholder="Comentario manual..."
                                                        className="h-8 text-xs"
                                                        onBlur={(e) => handleSaveTreasurerComment(txn.id, e.target.value)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </td>

                                                {customColumns.map((col) => (
                                                    <td key={`${txn.id}_${col.id}`} className="p-3 align-top">
                                                        <Input
                                                            defaultValue={txn.columnas_extra?.[col.clave] ?? ""}
                                                            placeholder={col.clave}
                                                            className="h-8 text-xs"
                                                            onBlur={(e) => handleSaveExtraField(txn, col.clave, e.target.value)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    </td>
                                                ))}

                                                <td className="p-3 align-top" onClick={() => fetchSuggestions(txn)}>
                                                    <div className="text-[10px] uppercase text-muted-foreground mb-1">
                                                        Tipo: {txn.tipo_conciliacion || "pendiente"}
                                                    </div>

                                                    {txn.estado === 'conciliado' ? (
                                                        <div className="space-y-1">
                                                            <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-200 border-green-200 shadow-none">
                                                                <Check className="w-3 h-3 mr-1" /> CONCILIADO
                                                            </Badge>

                                                            {matchedFactura && (
                                                                <div className="text-xs flex items-center gap-1 text-slate-600">
                                                                    <span className="font-bold">Factura #{matchedFactura.numero_documento}</span>
                                                                    <span className="text-muted-foreground">({matchedFactura.terceros?.razon_social})</span>
                                                                </div>
                                                            )}

                                                            {matchedRendicion && (
                                                                <div className="text-xs flex items-center gap-1 text-slate-600">
                                                                    <span className="font-bold">Rendición</span>
                                                                    <span className="text-muted-foreground">({matchedRendicion.terceros?.razon_social})</span>
                                                                </div>
                                                            )}

                                                            {/* Manual description fallback if no relational match but text was updated */}
                                                            {!matchedFactura && !matchedRendicion && txn.descripcion.includes('[') && (
                                                                <div className="text-xs text-muted-foreground italic">
                                                                    {txn.descripcion.match(/\[(.*?)\]/)?.[1] || 'Conciliación Manual'}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <Badge variant="secondary" className="animate-pulse bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200">
                                                            PENDIENTE
                                                        </Badge>
                                                    )}
                                                </td>

                                                <td className="p-3 align-top text-right">
                                                    <div className="flex justify-end gap-1">
                                                        {txn.estado === 'conciliado' && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                                title="Deshacer Conciliación"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleUndoReconciliation(txn);
                                                                }}
                                                            >
                                                                <RotateCcw className="w-4 h-4" />
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteMovimiento(txn.id);
                                                            }}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </td>

                                                {/* Popover Content embedded here but shown absolutely positioned by Radix */}
                                                <PopoverContent className="w-[450px] p-0" align="end" side="left">
                                                    <div className="p-4 border-b bg-muted/10">
                                                        <h4 className="font-bold text-sm">Conciliar Movimiento</h4>
                                                        <p className="text-xs text-muted-foreground">Monto: {formatCurrency(Math.abs(txn.monto))}</p>
                                                        <p className="text-xs text-slate-700 mt-1 font-medium">{txn.descripcion}</p>
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

                                                        {txn.monto < 0 && (
                                                            <>
                                                                <div className="space-y-2 mb-4 pt-2 border-t">
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Rendiciones Disponibles:</p>
                                                                    {suggestedRendiciones.length > 0 ? (
                                                                        <div className="space-y-2">
                                                                            {suggestedRendiciones.map((doc) => (
                                                                                <div key={doc.id} className="border rounded-lg p-3 bg-white shadow-sm border-orange-100 transition-colors hover:bg-orange-50">
                                                                                    <div className="flex justify-between items-center mb-1">
                                                                                        <span className="font-bold text-xs">Rendición</span>
                                                                                        <span className="font-bold text-orange-600 text-xs">{formatCurrency(doc.monto)}</span>
                                                                                    </div>
                                                                                    <p className="text-[11px] text-slate-900 font-semibold mb-2">{doc.terceros?.razon_social || 'Desconocido'}</p>
                                                                                    <Button
                                                                                        size="sm"
                                                                                        className="w-full bg-orange-600 hover:bg-orange-700 h-7 text-[10px]"
                                                                                        onClick={() => handleConfirmMatch(doc)}
                                                                                        disabled={isMatching}
                                                                                    >
                                                                                        {isMatching ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="w-3 h-3 mr-1" /> Vincular Rendición</>}
                                                                                    </Button>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="p-3 bg-slate-50 border border-dashed rounded-lg text-center">
                                                                            <p className="text-[10px] text-muted-foreground italic">No hay rendiciones pendientes para este monto.</p>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                <div className="space-y-2 mb-4 pt-2 border-t">
                                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Conciliación Directa:</p>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <Button
                                                                            variant="outline"
                                                                            size="sm"
                                                                            className="w-full text-xs h-8 border-dashed"
                                                                            onClick={() => handleDirectReconciliation('remuneraciones', 'Remuneraciones')}
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
                                                            </>
                                                        )}

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
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            {/* End of content replacement */}
        </div>
    );
}
