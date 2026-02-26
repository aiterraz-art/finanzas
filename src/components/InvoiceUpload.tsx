import { useState, useRef, useEffect } from "react";
import { format, addDays } from "date-fns";
import { UploadCloud, FileText, CheckCircle2, Loader2, AlertCircle, Trash2, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { processInvoiceDocument } from "@/lib/internalAutomation";

interface FileItem {
    id: string;
    file: File;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    extractedData: any | null;
    terceroEncontrado: any | null;
    isDuplicate: boolean;
    errorMessage?: string;
}

const OWN_LAB_RUT = "781022489";

interface InvoiceUploadProps {
    targetType?: 'cliente' | 'proveedor';
    fixedTercero?: any;
    onSuccess?: () => void;
}

const formatRut = (rut: string): string => {
    let value = rut.replace(/[^\dkK]/g, "");
    if (value.length <= 1) return value;
    const body = value.slice(0, -1);
    const dv = value.slice(-1).toUpperCase();
    let formatted = "";
    for (let i = body.length - 1, j = 1; i >= 0; i--, j++) {
        formatted = body.charAt(i) + formatted;
        if (j % 3 === 0 && i !== 0) formatted = "." + formatted;
    }
    return formatted + "-" + dv;
};

export default function InvoiceUpload({ targetType, fixedTercero, onSuccess }: InvoiceUploadProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [uploadQueue, setUploadQueue] = useState<FileItem[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [clients, setClients] = useState<any[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessingQueue, setIsProcessingQueue] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const queueRef = useRef<FileItem[]>(uploadQueue);

    useEffect(() => {
        if (targetType === 'proveedor') {
            fetchProviders();
        } else if (targetType === 'cliente') {
            fetchClients();
        }
    }, [targetType]);

    const fetchProviders = async () => {
        const { data, error } = await supabase
            .from('terceros')
            .select('*')
            .eq('tipo', 'proveedor')
            .order('razon_social', { ascending: true });
        if (!error && data) {
            setProviders(data);
        }
    };

    const fetchClients = async () => {
        const { data, error } = await supabase
            .from('terceros')
            .select('*')
            .eq('tipo', 'cliente')
            .order('razon_social', { ascending: true });
        if (!error && data) {
            setClients(data);
        }
    };

    // Mantener queueRef sincronizado para el procesador de fondo
    useEffect(() => {
        queueRef.current = uploadQueue;
    }, [uploadQueue]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            addFilesToQueue(Array.from(e.target.files));
        }
    };

    const addFilesToQueue = (newFiles: File[]) => {
        const newItems: FileItem[] = newFiles.map(file => ({
            id: Math.random().toString(36).substr(2, 9),
            file,
            status: 'pending',
            progress: 0,
            extractedData: null,
            terceroEncontrado: null,
            isDuplicate: false
        }));
        setUploadQueue(prev => [...prev, ...newItems]);
        if (selectedIndex === null) setSelectedIndex(uploadQueue.length);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) {
            addFilesToQueue(Array.from(e.dataTransfer.files));
        }
    };

    const removeFile = (id: string, index: number) => {
        setUploadQueue(prev => prev.filter(item => item.id !== id));
        if (selectedIndex === index) {
            setSelectedIndex(null);
        } else if (selectedIndex !== null && selectedIndex > index) {
            setSelectedIndex(selectedIndex - 1);
        }
    };

    const checkTercero = async (rut: string, id: string) => {
        if (!rut) return null;
        const cleanRut = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase();
        console.log("Buscando tercero con RUT limpio:", cleanRut, "Original:", rut);

        try {
            const { data, error } = await supabase
                .from('terceros')
                .select('*')
                .eq('rut', cleanRut)
                .maybeSingle();

            if (error) {
                console.error("Error de Supabase al buscar tercero:", error);
                throw error;
            }

            setUploadQueue(prev => prev.map(item =>
                item.id === id ? { ...item, terceroEncontrado: data } : item
            ));
            return data;
        } catch (error: any) {
            console.error("Excepción al buscar tercero:", error);
            return null;
        }
    };

    const checkInvoiceDuplicate = async (numero: string, terceroId: string, id: string) => {
        if (!numero || !terceroId) return false;

        try {
            const { count, error } = await supabase
                .from('facturas')
                .select('*', { count: 'exact', head: true })
                .eq('numero_documento', numero)
                .eq('tercero_id', terceroId);

            if (error) throw error;

            const isDup = (count || 0) > 0;

            setUploadQueue(prev => prev.map(item =>
                item.id === id ? { ...item, isDuplicate: isDup } : item
            ));

            return isDup;
        } catch (error) {
            console.error("Error al verificar duplicado:", error);
            return false;
        }
    };

    const handleSaveToDatabase = async (id: string) => {
        const item = uploadQueue.find(i => i.id === id);
        if (!item || !item.extractedData) return;

        if (!item.terceroEncontrado && !fixedTercero) {
            alert("Debes crear o seleccionar el tercero antes de guardar la factura.");
            return;
        }

        setIsSaving(true);
        try {
            // 1. Subir archivo al storage si no se ha subido ya
            let archivoUrl = "";
            const fileExt = item.file.name.split('.').pop();
            const terceroRut = fixedTercero?.rut || item.terceroEncontrado?.rut;
            if (!terceroRut) {
                throw new Error("No se encontró RUT del tercero para guardar el archivo.");
            }
            const fileName = `${terceroRut}/${item.extractedData.numero_documento}_${Date.now()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('facturas')
                .upload(filePath, item.file);

            if (uploadError) {
                console.error("Error al subir archivo:", uploadError);
                throw new Error(`Error al subir archivo: ${uploadError.message}`);
            }

            if (uploadData) {
                const { data: { publicUrl } } = supabase.storage
                    .from('facturas')
                    .getPublicUrl(filePath);
                archivoUrl = publicUrl;
            }

            // 2. Calcular fecha de vencimiento según los plazos del tercero o 30 días por defecto
            const emisionStr = item.extractedData.fecha_emision.split('T')[0];
            const emision = new Date(emisionStr + 'T12:00:00');
            const plazos = item.terceroEncontrado?.plazo_pago_dias ?? 30;
            const vencimiento = addDays(emision, plazos);

            const facturaData = {
                tipo: item.extractedData.tipo === 'gasto' ? 'compra' : item.extractedData.tipo,
                numero_documento: item.extractedData.numero_documento,
                monto: parseFloat(item.extractedData.monto),
                fecha_emision: item.extractedData.fecha_emision,
                fecha_vencimiento: format(vencimiento, 'yyyy-MM-dd'),
                rut: fixedTercero?.rut || item.terceroEncontrado.rut,
                tercero_id: fixedTercero?.id || item.terceroEncontrado.id,
                descripcion: item.extractedData.descripcion,
                estado: 'pendiente',
                archivo_url: archivoUrl // Guardamos la URL del archivo
            };

            const { error } = await supabase
                .from('facturas')
                .insert([facturaData]);

            if (error) {
                console.error("Error de Supabase al guardar factura:", error);
                const msg = error.message || error.details || (typeof error === 'object' ? JSON.stringify(error) : String(error));
                throw new Error(`${msg} (Código: ${error.code || 'N/A'})`);
            }

            // Trigger refresh callback if provided
            if (onSuccess) {
                onSuccess();
            }

            alert(`Documento ${item.file.name} guardado correctamente.`);
            setUploadQueue(prev => {
                const newQueue = prev.filter(i => i.id !== id);
                return newQueue;
            });
            setSelectedIndex(null);
        } catch (error: any) {
            console.error("Error saving invoice:", error);
            alert(`Error al guardar: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleProcessQueue = async () => {
        if (isProcessingQueue) return;
        setIsProcessingQueue(true);

        try {
            // Procesamos usando un loop while para consultar siempre el estado más reciente via queueRef
            while (true) {
                const nextItem = queueRef.current.find(i => i.status === 'pending' || i.status === 'failed');
                if (!nextItem) break;

                console.log(`Procesando automáticamente: ${nextItem.file.name}`);
                await handleProcessSingleOCR(nextItem.id);

                // Si falla uno, continuamos con el siguiente igual, a menos que el error sea crítico de red
                // handleProcessSingleOCR ya maneja los errores marcando el item como failed.
            }
        } finally {
            setIsProcessingQueue(false);
        }
    };

    const handleProcessSingleOCR = async (id: string): Promise<boolean> => {
        const item = queueRef.current.find(i => i.id === id);
        if (!item) return false;

        console.log("Iniciando procesamiento OCR para:", item.file.name);

        updateItemStatus(id, 'processing', 10);

        try {
            const defaultType = targetType === 'proveedor' ? 'compra' : 'venta';
            const data = await processInvoiceDocument(item.file, defaultType);

            if (!data || Object.keys(data).length === 0) {
                throw new Error("Respuesta IA vacía.");
            }

            // Validar si el RUT extraído es el del propio Laboratorio (Emisor)
            const cleanedExtractedRut = (data.rut || "").replace(/\./g, '').replace(/-/g, '').toUpperCase();
            const isOwnRut = cleanedExtractedRut === OWN_LAB_RUT;

            const today = new Date().toISOString().split('T')[0];
            const detectedDate = data.fecha_emision || today;
            const isToday = detectedDate === today;

            const finalExtracted = {
                tipo: data.tipo_documento === 'nota_credito' ? 'nota_credito' : (targetType === 'proveedor' ? 'compra' : 'venta'),
                numero_documento: data.numero_documento || "",
                monto: data.monto?.toString() || '0',
                fecha_emision: detectedDate,
                tercero_nombre: fixedTercero?.razon_social || (isOwnRut ? "" : (data.tercero_nombre || "Empresa no identificada")),
                rut: fixedTercero?.rut || (isOwnRut ? "" : (data.rut || "")),
                email: fixedTercero?.email || "",
                telefono: fixedTercero?.telefono || "",
                descripcion: data.descripcion || `Documento: ${item.file.name}`,
                estado: 'pendiente'
            };

            let customError = undefined;
            if (isOwnRut && targetType !== 'proveedor') {
                console.warn("OCR detectó el RUT del laboratorio en lugar del cliente.");
                customError = "Se detectó el RUT del Laboratorio (Emisor) en lugar del Cliente. Por favor, ingresa los datos del cliente manualmente.";
            } else if (isToday) {
                // Warning suave, no bloqueante
                console.log("Fecha de hoy detectada como emisión.");
            }
            if (data.warning) {
                customError = customError ? `${customError} ${data.warning}` : data.warning;
            }

            updateItemStatus(id, 'completed', 100, finalExtracted, customError);

            if (finalExtracted.rut && !isOwnRut) {
                const terc = await checkTercero(finalExtracted.rut, id);
                if (terc && finalExtracted.numero_documento) {
                    await checkInvoiceDuplicate(finalExtracted.numero_documento, terc.id, id);
                }
            }
            return true;
        } catch (error: any) {
            console.error("Error OCR:", error);
            updateItemStatus(id, 'failed', 0, undefined, error.message || "Error de red");
            return false;
        }
    };

    const updateItemStatus = (id: string, status: FileItem['status'], progress: number, extractedData?: any, errorMessage?: string) => {
        setUploadQueue(prev => prev.map(item =>
            item.id === id ? {
                ...item,
                status,
                progress,
                extractedData: extractedData !== undefined ? extractedData : item.extractedData,
                errorMessage
            } : item
        ));
    };

    const [objectUrl, setObjectUrl] = useState<string | null>(null);

    // Limpiar objeto URL al cambiar de archivo o desmontar
    useEffect(() => {
        const item = selectedIndex !== null ? uploadQueue[selectedIndex] : null;
        if (item) {
            const url = URL.createObjectURL(item.file);
            setObjectUrl(url);
            return () => URL.revokeObjectURL(url);
        } else {
            setObjectUrl(null);
        }
    }, [selectedIndex, uploadQueue]);

    const currentItem = selectedIndex !== null ? uploadQueue[selectedIndex] : null;

    return (
        <div className="w-full space-y-6">
            {/* Zona de Drop para múltiples archivos siempre visible arriba si hay cola */}
            <div
                className={cn(
                    "border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer text-center",
                    isDragging ? "border-primary bg-primary/10" : "border-slate-200 hover:border-primary/50",
                    uploadQueue.length > 0 ? "h-24" : "min-h-[250px] p-10"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleFileChange}
                />
                <div className={cn("flex flex-col items-center", uploadQueue.length > 0 && "flex-row justify-center gap-4 h-full")}>
                    <div className="bg-primary/5 p-3 rounded-full">
                        <UploadCloud className={cn("text-primary", uploadQueue.length > 0 ? "h-6 w-6" : "h-10 w-10")} />
                    </div>
                    <div>
                        <h3 className={cn("font-semibold", uploadQueue.length > 0 ? "text-sm" : "text-lg")}>
                            {uploadQueue.length > 0 ? "Agregar más archivos" : "Cargar Facturas (OCR Masivo)"}
                        </h3>
                        {uploadQueue.length === 0 && (
                            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                                Suelta múltiples archivos aquí o busca en tu carpeta.
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {uploadQueue.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Lista de Archivos (Queue) */}
                    <div className="lg:col-span-4 space-y-3 max-h-[600px] overflow-y-auto pr-2">
                        {uploadQueue.map((item, idx) => (
                            <Card
                                key={item.id}
                                className={cn(
                                    "cursor-pointer transition-all border-l-4",
                                    selectedIndex === idx ? "border-l-primary ring-1 ring-primary/20 shadow-md" : "border-l-transparent hover:bg-slate-50",
                                    item.status === 'completed' ? "border-l-green-500" : item.status === 'failed' ? "border-l-red-500" : ""
                                )}
                                onClick={() => setSelectedIndex(idx)}
                            >
                                <CardContent className="p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3 truncate">
                                            <div className="p-2 bg-white rounded-md shadow-sm">
                                                {item.status === 'processing' ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <FileText className="h-4 w-4 text-slate-500" />}
                                            </div>
                                            <div className="truncate">
                                                <p className="text-xs font-medium truncate">{item.file.name}</p>
                                                <p className="text-[10px] text-muted-foreground">{(item.file.size / 1024).toFixed(0)} KB</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {item.status === 'pending' && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleProcessSingleOCR(item.id); }}><Edit3 className="h-3 w-3" /></Button>}
                                            {item.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                                            <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); removeFile(item.id, idx); }}><Trash2 className="h-3 w-3" /></Button>
                                        </div>
                                    </div>
                                    {item.status === 'processing' && (
                                        <div className="mt-2 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-primary animate-pulse" style={{ width: `${item.progress}%` }} />
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                        {uploadQueue.some(i => i.status === 'pending' || i.status === 'failed') && (
                            <Button
                                variant="outline"
                                className={cn("w-full py-6 text-xs font-bold", isProcessingQueue ? "bg-primary/5 text-primary border-primary animate-pulse" : "")}
                                onClick={handleProcessQueue}
                                disabled={isProcessingQueue}
                            >
                                {isProcessingQueue ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Procesando Cola...
                                    </>
                                ) : (
                                    "Procesar Pendientes en Lote"
                                )}
                            </Button>
                        )}
                    </div>

                    {/* Panel de Revisión del Archivo Seleccionado */}
                    <div className="lg:col-span-8">
                        {currentItem ? (
                            <Card className="border-primary/20 ring-1 ring-primary/5">
                                <CardContent className="p-6">
                                    {currentItem.status === 'pending' ? (
                                        <div className="text-center py-20">
                                            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
                                            <h4 className="font-semibold text-lg">Listo para procesar</h4>
                                            <p className="text-sm text-muted-foreground mb-6">Haz clic para iniciar el análisis OCR en este archivo.</p>
                                            <Button onClick={() => handleProcessSingleOCR(currentItem.id)}>Procesar Ahora</Button>
                                        </div>
                                    ) : currentItem.status === 'processing' ? (
                                        <div className="text-center py-20">
                                            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                                            <h4 className="font-semibold">Estamos leyendo los datos...</h4>
                                            <p className="text-xs text-muted-foreground">Analizando RUT, Montos y Fecha con IA.</p>
                                        </div>
                                    ) : currentItem.status === 'completed' && currentItem.extractedData ? (
                                        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                                            {/* Formulario de Revisión (Izquierda) */}
                                            <div className="xl:col-span-4 space-y-6 order-2 xl:order-1">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="font-bold text-lg text-primary">Revisión: {currentItem.file.name}</h4>
                                                    {(!fixedTercero && targetType !== 'proveedor') && (
                                                        currentItem.terceroEncontrado ? (
                                                            <Badge className="bg-green-100 text-green-700 hover:bg-green-200 border-none">Tercero Identificado</Badge>
                                                        ) : (
                                                            <Badge variant="destructive" className="animate-pulse">RUT Desconocido</Badge>
                                                        )
                                                    )}
                                                    {targetType === 'proveedor' && currentItem.terceroEncontrado && (
                                                        <Badge className="bg-blue-100 text-blue-700 border-none">Proveedor Seleccionado</Badge>
                                                    )}
                                                </div>

                                                {currentItem.errorMessage && (
                                                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-4 mb-4">
                                                        <AlertCircle className="h-5 w-5 text-amber-600 mt-1" />
                                                        <div className="flex-1">
                                                            <p className="text-sm font-bold text-amber-900">Advertencia de Extracción</p>
                                                            <p className="text-xs text-amber-800">{currentItem.errorMessage}</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {currentItem.isDuplicate && (
                                                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-4 mb-4">
                                                        <AlertCircle className="h-5 w-5 text-red-600 mt-1" />
                                                        <div className="flex-1">
                                                            <p className="text-sm font-bold text-red-900">FACTURA DUPLICADA</p>
                                                            <p className="text-xs text-red-800">Ya existe el folio {currentItem.extractedData.numero_documento} para {currentItem.terceroEncontrado?.razon_social || fixedTercero?.razon_social}. No puedes subirla de nuevo.</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {targetType === 'proveedor' && !fixedTercero && !currentItem.terceroEncontrado && (
                                                    <div className="p-4 bg-primary/5 border border-primary/10 rounded-lg flex items-start gap-4 shadow-sm">
                                                        <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                                                        <div className="flex-1">
                                                            <p className="text-sm font-bold text-slate-900 leading-tight">Acción Requerida</p>
                                                            <p className="text-xs text-slate-600 mt-1">Por favor, selecciona abajo el proveedor que emitió esta factura.</p>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Campos del Formulario */}
                                                <div className="grid grid-cols-2 gap-4">
                                                    {/* Solo mostrar Tipo de Documento si NO es proveedor */}
                                                    {targetType !== 'proveedor' && (
                                                        <div className="col-span-2 space-y-1">
                                                            <Label className="text-[10px] uppercase font-bold text-slate-500">Tipo Documento</Label>
                                                            <select
                                                                className="w-full h-10 px-3 rounded-md border border-slate-200 focus:ring-1 focus:ring-primary outline-none text-sm"
                                                                value={currentItem.extractedData.tipo}
                                                                onChange={(e) => {
                                                                    const newQueue = uploadQueue.map(i =>
                                                                        i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, tipo: e.target.value } } : i
                                                                    );
                                                                    setUploadQueue(newQueue);
                                                                }}
                                                            >
                                                                {targetType === 'cliente' ? (
                                                                    <>
                                                                        <option value="venta">Factura Venta (Cliente)</option>
                                                                        <option value="nota_credito">Nota de Crédito</option>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <option value="venta">Factura Venta (Cliente)</option>
                                                                        <option value="compra">Factura Compra/Gasto (Proveedor)</option>
                                                                        <option value="nota_credito">Nota de Crédito</option>
                                                                    </>
                                                                )}
                                                            </select>
                                                        </div>
                                                    )}

                                                    <div className="col-span-2 space-y-1">
                                                        <Label className="text-[10px] uppercase font-bold text-slate-500">N° Folio</Label>
                                                        <Input
                                                            value={currentItem.extractedData.numero_documento}
                                                            onChange={(e) => {
                                                                const newQueue = uploadQueue.map(i =>
                                                                    i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, numero_documento: e.target.value } } : i
                                                                );
                                                                setUploadQueue(newQueue);
                                                            }}
                                                            className="h-10 text-sm font-bold"
                                                        />
                                                    </div>

                                                    <div className="col-span-2 space-y-1">
                                                        <Label className="text-[10px] uppercase font-bold text-slate-500">{targetType === 'cliente' ? 'Razón Social' : 'Proveedor'}</Label>
                                                        {targetType === 'proveedor' && !fixedTercero ? (
                                                            <select
                                                                className="w-full h-11 px-3 rounded-md border-2 border-primary/20 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm font-semibold bg-white shadow-sm ring-1 ring-primary/5"
                                                                value={currentItem.terceroEncontrado?.id || ""}
                                                                onChange={async (e) => {
                                                                    const provId = e.target.value;
                                                                    const selectedProv = providers.find(p => p.id === provId);
                                                                    if (selectedProv) {
                                                                        const newQueue = uploadQueue.map(i =>
                                                                            i.id === currentItem.id ? {
                                                                                ...i,
                                                                                terceroEncontrado: selectedProv,
                                                                                extractedData: {
                                                                                    ...i.extractedData,
                                                                                    tercero_nombre: selectedProv.razon_social,
                                                                                    rut: formatRut(selectedProv.rut)
                                                                                }
                                                                            } : i
                                                                        );
                                                                        setUploadQueue(newQueue);
                                                                        checkInvoiceDuplicate(currentItem.extractedData.numero_documento, selectedProv.id, currentItem.id);
                                                                    }
                                                                }}
                                                            >
                                                                <option value="">-- Seleccionar Proveedor --</option>
                                                                {providers.map(p => (
                                                                    <option key={p.id} value={p.id}>{p.razon_social} ({formatRut(p.rut)})</option>
                                                                ))}
                                                            </select>
                                                        ) : targetType === 'cliente' ? (
                                                            <select
                                                                className="w-full h-11 px-3 rounded-md border-2 border-primary/20 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm font-semibold bg-white shadow-sm ring-1 ring-primary/5"
                                                                value={currentItem.terceroEncontrado?.id || ""}
                                                                onChange={async (e) => {
                                                                    const clientId = e.target.value;
                                                                    const selectedClient = clients.find(c => c.id === clientId);
                                                                    if (selectedClient) {
                                                                        const newQueue = uploadQueue.map(i =>
                                                                            i.id === currentItem.id ? {
                                                                                ...i,
                                                                                terceroEncontrado: selectedClient,
                                                                                extractedData: {
                                                                                    ...i.extractedData,
                                                                                    tercero_nombre: selectedClient.razon_social,
                                                                                    rut: formatRut(selectedClient.rut),
                                                                                    email: selectedClient.email || i.extractedData.email,
                                                                                    telefono: selectedClient.telefono || i.extractedData.telefono
                                                                                }
                                                                            } : i
                                                                        );
                                                                        setUploadQueue(newQueue);
                                                                        checkInvoiceDuplicate(currentItem.extractedData.numero_documento, selectedClient.id, currentItem.id);
                                                                    }
                                                                }}
                                                            >
                                                                <option value="">-- Seleccionar Cliente --</option>
                                                                {clients.map(c => (
                                                                    <option key={c.id} value={c.id}>{c.razon_social} ({formatRut(c.rut)})</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <Input
                                                                disabled={targetType === 'proveedor'}
                                                                value={targetType === 'proveedor' ? (fixedTercero?.razon_social || currentItem.extractedData.tercero_nombre) : currentItem.extractedData.tercero_nombre}
                                                                onChange={(e) => {
                                                                    const newQueue = uploadQueue.map(i =>
                                                                        i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, tercero_nombre: e.target.value } } : i
                                                                    );
                                                                    setUploadQueue(newQueue);
                                                                }}
                                                                className={cn("h-10 text-sm", targetType === 'proveedor' && "bg-slate-50")}
                                                            />
                                                        )}
                                                    </div>

                                                    {/* Mostrar RUT solo para Clientes */}
                                                    {targetType !== 'proveedor' && (
                                                        <div className="col-span-2 space-y-1">
                                                            <Label className="text-[10px] uppercase font-bold text-slate-500">RUT</Label>
                                                            <Input
                                                                className="h-10 text-sm font-mono"
                                                                value={currentItem.extractedData.rut}
                                                                onChange={(e) => {
                                                                    const val = formatRut(e.target.value);
                                                                    const newQueue = uploadQueue.map(i =>
                                                                        i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, rut: val } } : i
                                                                    );
                                                                    setUploadQueue(newQueue);
                                                                }}
                                                            />
                                                        </div>
                                                    )}

                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] uppercase font-bold text-slate-500">Correo</Label>
                                                        <Input
                                                            type="email"
                                                            value={currentItem.extractedData.email}
                                                            onChange={(e) => {
                                                                const newQueue = uploadQueue.map(i =>
                                                                    i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, email: e.target.value } } : i
                                                                );
                                                                setUploadQueue(newQueue);
                                                            }}
                                                            className="h-10 text-sm"
                                                            placeholder="ejemplo@email.com"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] uppercase font-bold text-slate-500">Teléfono</Label>
                                                        <Input
                                                            value={currentItem.extractedData.telefono}
                                                            onChange={(e) => {
                                                                const newQueue = uploadQueue.map(i =>
                                                                    i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, telefono: e.target.value } } : i
                                                                );
                                                                setUploadQueue(newQueue);
                                                            }}
                                                            className="h-10 text-sm"
                                                            placeholder="+569..."
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] uppercase font-bold text-slate-500">Total</Label>
                                                        <Input
                                                            type="number"
                                                            value={currentItem.extractedData.monto}
                                                            onChange={(e) => {
                                                                const newQueue = uploadQueue.map(i =>
                                                                    i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, monto: e.target.value } } : i
                                                                );
                                                                setUploadQueue(newQueue);
                                                            }}
                                                            className="h-10 text-sm font-bold text-primary"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] uppercase font-bold text-slate-500">Fecha Emisión</Label>
                                                        <Input
                                                            type="date"
                                                            value={currentItem.extractedData.fecha_emision}
                                                            onChange={(e) => {
                                                                const newQueue = uploadQueue.map(i =>
                                                                    i.id === currentItem.id ? { ...i, extractedData: { ...i.extractedData, fecha_emision: e.target.value } } : i
                                                                );
                                                                setUploadQueue(newQueue);
                                                            }}
                                                            className="h-10 text-sm"
                                                        />
                                                    </div>
                                                </div>

                                                <Button
                                                    className={cn(
                                                        "w-full h-12 text-md shadow-lg",
                                                        currentItem.isDuplicate
                                                            ? "bg-slate-400 cursor-not-allowed"
                                                            : "bg-green-600 hover:bg-green-700"
                                                    )}
                                                    onClick={() => !currentItem.isDuplicate && handleSaveToDatabase(currentItem.id)}
                                                    disabled={isSaving || currentItem.isDuplicate}
                                                >
                                                    {isSaving ? <Loader2 className="animate-spin h-5 w-5" /> : currentItem.isDuplicate ? "Documento Duplicado" : "Guardar Factura"}
                                                </Button>
                                            </div>

                                            {/* Vista Previa del Documento (Derecha) */}
                                            <div className="xl:col-span-8 bg-slate-100 rounded-lg overflow-hidden border border-slate-200 min-h-[500px] flex items-start justify-center order-1 xl:order-2">
                                                {objectUrl ? (
                                                    currentItem.file.type.includes('pdf') ? (
                                                        <iframe
                                                            src={`${objectUrl}#toolbar=0&navpanes=0&scrollbar=1`}
                                                            className="w-full h-full min-h-[750px]"
                                                            title="Vista previa PDF"
                                                        />
                                                    ) : (
                                                        <img
                                                            src={objectUrl}
                                                            alt="Vista previa documento"
                                                            className="w-full h-auto object-contain shadow-lg"
                                                        />
                                                    )
                                                ) : (
                                                    <div className="text-center p-10 text-muted-foreground mt-20">
                                                        <FileText className="h-10 w-10 mx-auto mb-2 opacity-20" />
                                                        <p className="text-xs">No se pudo generar vista previa</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center py-16 px-6 text-red-500 max-w-md mx-auto">
                                            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-80" />
                                            <h4 className="font-bold text-lg mb-2">Error al procesar el archivo</h4>
                                            <div className="bg-red-50 border border-red-100 rounded-md p-3 mb-6">
                                                <p className="text-xs font-mono break-all line-clamp-4">
                                                    {currentItem.errorMessage || "Error desconocido durante la comunicación con el motor interno."}
                                                </p>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <Button
                                                    variant="default"
                                                    className="bg-red-600 hover:bg-red-700 h-10 shadow-sm"
                                                    onClick={() => handleProcessSingleOCR(currentItem.id)}
                                                >
                                                    Reintentar
                                                </Button>
                                                <p className="text-[10px] text-muted-foreground mt-2">
                                                    Si el error persiste, revisa la configuración del OCR interno en Supabase Functions.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="h-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-10 text-muted-foreground bg-slate-50">
                                <div className="bg-slate-100 p-6 rounded-full mb-4">
                                    <FileText className="h-12 w-12 opacity-30" />
                                </div>
                                <p className="text-sm font-medium">Selecciona un archivo de la lista para revisarlo.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
