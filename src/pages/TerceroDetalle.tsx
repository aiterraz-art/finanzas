import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Clock, CreditCard, Edit3, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LinkedMovement = {
  id?: string;
  fecha_movimiento?: string | null;
  descripcion?: string | null;
  numero_documento?: string | null;
  monto?: number | null;
};

type PaymentRecord = {
  id: string;
  monto_aplicado: number | null;
  estado: string | null;
  created_at?: string | null;
  movimiento_banco_id?: string | null;
  movimientos_banco?: LinkedMovement[] | LinkedMovement | null;
};

type DocumentRecord = {
  id: string;
  tipo: string | null;
  monto: number | null;
  estado: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  numero_documento: string | null;
  archivo_url?: string | null;
  tercero_id?: string | null;
  rut?: string | null;
  facturas_pagos?: PaymentRecord[];
};

const DOCUMENT_SELECT = `
  id,
  tipo,
  monto,
  estado,
  fecha_emision,
  fecha_vencimiento,
  numero_documento,
  archivo_url,
  tercero_id,
  rut,
  facturas_pagos (
    id,
    monto_aplicado,
    estado,
    created_at,
    movimiento_banco_id,
    movimientos_banco (
      id,
      fecha_movimiento,
      descripcion,
      numero_documento,
      monto
    )
  )
`;

const currencyFormatter = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const readFirstLinkedRow = <T,>(value: T[] | T | null | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

const formatCurrency = (value: number) => currencyFormatter.format(value || 0);

const formatDate = (value?: string | null, fallback = "Sin fecha") => {
  if (!value) return fallback;
  const normalized = value.includes("T") ? value : `${value}T12:00:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("es-CL");
};

const getAppliedPayments = (document: DocumentRecord) => (document.facturas_pagos || []).filter((payment) => payment.estado !== "revertido");

const getPaymentDate = (payment: PaymentRecord) => {
  const movement = readFirstLinkedRow(payment.movimientos_banco);
  return movement?.fecha_movimiento || payment.created_at?.split("T")[0] || null;
};

const getPaymentMethodLabel = (payment: PaymentRecord) => {
  const movement = readFirstLinkedRow(payment.movimientos_banco);
  if (movement?.id) return "Transferencia";
  return "Pago manual";
};

const getStatusMeta = (document: {
  tipo: string | null;
  estado: string | null;
  total: number;
  paidAmount: number;
  balance: number;
}) => {
  if (document.estado === "archivada") {
    return {
      label: "Archivada",
      icon: <Clock className="h-4 w-4 text-slate-500" />,
      badgeClassName: "border-slate-200 text-slate-700",
    };
  }

  if (document.tipo === "nota_credito") {
    return {
      label: "Nota de crédito",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      badgeClassName: "border-emerald-200 text-emerald-700",
    };
  }

  if (document.balance <= 0.01 && document.total > 0) {
    return {
      label: "Pagada",
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      badgeClassName: "border-emerald-200 text-emerald-700",
    };
  }

  if (document.paidAmount > 0.01) {
    return {
      label: "Abonada",
      icon: <Clock className="h-4 w-4 text-sky-600" />,
      badgeClassName: "border-sky-200 text-sky-700",
    };
  }

  return {
    label: document.estado === "pagada" ? "Pagada" : "Pendiente",
    icon: <Clock className="h-4 w-4 text-amber-500" />,
    badgeClassName: "border-amber-200 text-amber-700",
  };
};

export default function TerceroDetalle() {
  const { selectedEmpresaId } = useCompany();
  const { user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tercero, setTercero] = useState<any>(null);
  const [documentos, setDocumentos] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [columnMissing, setColumnMissing] = useState(false);
  const [editData, setEditData] = useState({
    razon_social: "",
    rut: "",
    email: "",
    telefono: "",
    direccion: "",
    plazo_pago_dias: 30,
  });

  useEffect(() => {
    if (id && selectedEmpresaId) {
      void fetchData();
    }
  }, [id, selectedEmpresaId]);

  useEffect(() => {
    if (tercero) {
      setEditData({
        razon_social: tercero.razon_social || "",
        rut: tercero.rut || "",
        email: tercero.email || "",
        telefono: tercero.telefono || "",
        direccion: tercero.direccion || "",
        plazo_pago_dias: tercero.plazo_pago_dias || 30,
      });
    }
  }, [tercero]);

  const entityLabel = tercero?.tipo === "proveedor" ? "proveedor" : "cliente";

  const accountRows = useMemo(() => {
    return documentos
      .map((document) => {
        const total = Number(document.monto || 0);
        const payments = getAppliedPayments(document);
        const paidAmount = payments.reduce((sum, payment) => sum + Number(payment.monto_aplicado || 0), 0);
        const isCreditNote = document.tipo === "nota_credito";
        const signedTotal = isCreditNote ? -total : total;
        const balance = isCreditNote ? -total : Math.max(total - paidAmount, 0);
        const paymentDates = payments
          .map((payment) => getPaymentDate(payment))
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => left.localeCompare(right));
        const lastPaymentDate = paymentDates[paymentDates.length - 1] || null;
        const paymentBreakdown = payments
          .map((payment, index) => {
            const movement = readFirstLinkedRow(payment.movimientos_banco);
            return {
              id: payment.id,
              sequence: index + 1,
              amount: Number(payment.monto_aplicado || 0),
              date: getPaymentDate(payment),
              methodLabel: getPaymentMethodLabel(payment),
              reference: movement?.descripcion || movement?.numero_documento || null,
            };
          })
          .sort((left, right) => (left.date || "").localeCompare(right.date || ""));

        return {
          ...document,
          total: signedTotal,
          rawTotal: total,
          paidAmount,
          balance,
          payments,
          paymentCount: payments.length,
          paymentBreakdown,
          lastPaymentDate,
          statusMeta: getStatusMeta({
            tipo: document.tipo,
            estado: document.estado,
            total,
            paidAmount,
            balance,
          }),
        };
      })
      .sort((left, right) => {
        const leftDate = left.fecha_emision || "";
        const rightDate = right.fecha_emision || "";
        return rightDate.localeCompare(leftDate);
      });
  }, [documentos]);

  const paymentHistory = useMemo(() => {
    return accountRows
      .flatMap((document) =>
        document.payments.map((payment) => {
          const movement = readFirstLinkedRow(payment.movimientos_banco);
          return {
            id: payment.id,
            documentId: document.id,
            documentNumber: document.numero_documento || "Sin folio",
            emissionDate: document.fecha_emision,
            dueDate: document.fecha_vencimiento,
            appliedAmount: Number(payment.monto_aplicado || 0),
            paymentDate: getPaymentDate(payment),
            paymentState: payment.estado || "aplicado",
            movementDescription: movement?.descripcion || movement?.numero_documento || "Sin referencia bancaria",
            movementNumber: movement?.numero_documento || null,
          };
        })
      )
      .sort((left, right) => (right.paymentDate || "").localeCompare(left.paymentDate || ""));
  }, [accountRows]);

  const summary = useMemo(() => {
    return accountRows.reduce(
      (acc, document) => {
        acc.netDocumentTotal += document.total;
        acc.totalPaid += document.paidAmount;
        acc.pendingBalance += document.balance;
        return acc;
      },
      { netDocumentTotal: 0, totalPaid: 0, pendingBalance: 0 }
    );
  }, [accountRows]);

  const handleDeleteTercero = async () => {
    if (!selectedEmpresaId || !tercero) return;
    const hasDocs = documentos.length > 0;
    const msg = hasDocs
      ? `El ${entityLabel} ${tercero.razon_social} tiene ${documentos.length} documentos asociados. Se inactivará la ficha, pero el historial seguirá disponible. ¿Deseas continuar?`
      : `¿Inactivar la ficha de ${tercero.razon_social}? Su historial se conservará.`;

    const confirmed = window.confirm(msg);
    if (!confirmed) return;

    try {
      setIsSaving(true);
      const { error } = await supabase
        .from("terceros")
        .update({
          estado: "inactivo",
          archived_at: new Date().toISOString(),
          archived_by: user?.id ?? null,
          archive_reason: "Ficha inactivada desde detalle de tercero",
        })
        .eq("id", id)
        .eq("empresa_id", selectedEmpresaId);

      if (error) throw error;

      alert(`${entityLabel === "cliente" ? "Cliente" : "Proveedor"} inactivado correctamente. El historial sigue disponible.`);
      navigate(entityLabel === "cliente" ? "/clientes" : "/proveedores");
    } catch (error: any) {
      console.error("Error al inactivar tercero:", error);
      alert(`Error al inactivar: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateTercero = async () => {
    if (!selectedEmpresaId) return;
    setIsSaving(true);
    try {
      const payload: any = {
        razon_social: editData.razon_social,
        email: editData.email,
        telefono: editData.telefono,
        direccion: editData.direccion,
      };

      if (!columnMissing) {
        payload.plazo_pago_dias = editData.plazo_pago_dias;
      }

      const { error } = await supabase
        .from("terceros")
        .update(payload)
        .eq("id", id)
        .eq("empresa_id", selectedEmpresaId);

      if (error) {
        if (error.message.includes("plazo_pago_dias")) {
          setColumnMissing(true);
          alert("Aviso: No se pudo guardar el campo 'Días de Crédito' porque la columna no existe en la base de datos. Los demás cambios sí se guardaron.");
          delete payload.plazo_pago_dias;
          await supabase.from("terceros").update(payload).eq("id", id).eq("empresa_id", selectedEmpresaId);
        } else {
          throw error;
        }
      }

      setTercero((current: any) => ({ ...current, ...editData }));
      setIsEditOpen(false);
      if (!error) alert("Ficha actualizada correctamente.");
    } catch (error: any) {
      console.error("Error updating entity:", error);
      alert(`Error al actualizar: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const fetchData = async () => {
    if (!selectedEmpresaId || !id) return;
    setLoading(true);
    try {
      const { data: entity, error: entityError } = await supabase
        .from("terceros")
        .select("*")
        .eq("id", id)
        .eq("empresa_id", selectedEmpresaId)
        .single();

      if (entityError) throw entityError;
      setTercero(entity);

      const documentsById = new Map<string, DocumentRecord>();

      const loadDocuments = async (column: "tercero_id" | "rut", value: string) => {
        const { data, error } = await supabase
          .from("facturas")
          .select(DOCUMENT_SELECT)
          .eq("empresa_id", selectedEmpresaId)
          .eq(column, value)
          .order("fecha_emision", { ascending: false });

        if (error) throw error;
        for (const document of ((data || []) as DocumentRecord[])) {
          documentsById.set(document.id, document);
        }
      };

      await loadDocuments("tercero_id", entity.id);
      if (entity.rut) {
        await loadDocuments("rut", entity.rut);
      }

      setDocumentos(Array.from(documentsById.values()));
    } catch (error) {
      console.error("Error fetching detail:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFactura = async (documentId: string, numero: string | null) => {
    if (!selectedEmpresaId) return;
    const confirmed = window.confirm(`¿Archivar la factura folio ${numero || "sin número"}? No se borrará, pero saldrá de la operación diaria.`);
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("facturas")
        .update({
          estado: "archivada",
          archived_at: new Date().toISOString(),
          archived_by: user?.id ?? null,
          archive_reason: "Factura archivada desde detalle de tercero",
        })
        .eq("id", documentId)
        .eq("empresa_id", selectedEmpresaId);

      if (error) throw error;

      setDocumentos((current) =>
        current.map((document) =>
          document.id === documentId
            ? { ...document, estado: "archivada" }
            : document
        )
      );
      alert("Factura archivada correctamente.");
    } catch (error) {
      console.error("Error al archivar factura:", error);
      alert("Error al archivar la factura.");
    }
  };

  if (loading) return <div className="p-10 text-center">Cargando estado de cuenta...</div>;
  if (!tercero) return <div className="p-10 text-center">Entidad no encontrada.</div>;

  return (
    <div className="container mx-auto space-y-6 py-8">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-2">
        <ArrowLeft className="mr-2 h-4 w-4" /> Volver al listado
      </Button>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">{tercero.razon_social}</h1>
            <Badge variant={tercero.tipo === "cliente" ? "default" : "secondary"}>
              {tercero.tipo?.toUpperCase() || "TERCERO"}
            </Badge>
          </div>
          <p className="font-mono text-muted-foreground">{tercero.rut}</p>
          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-1">
              <MapPin className="h-4 w-4" /> {tercero.direccion || "Sin dirección"}
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" /> Plazo: {tercero.plazo_pago_dias || 0} días
            </div>
            <div>{tercero.email || "Sin email"} • {tercero.telefono || "Sin teléfono"}</div>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap xl:justify-end">
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Edit3 className="h-4 w-4" /> Editar ficha
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Editar ficha de {entityLabel}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Razón social</Label>
                  <Input
                    id="edit-name"
                    value={editData.razon_social}
                    onChange={(event) => setEditData({ ...editData, razon_social: event.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-rut">RUT (no editable)</Label>
                  <Input id="edit-rut" value={editData.rut} disabled className="bg-muted font-mono" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editData.email}
                    onChange={(event) => setEditData({ ...editData, email: event.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-phone">Teléfono</Label>
                  <Input
                    id="edit-phone"
                    value={editData.telefono}
                    onChange={(event) => setEditData({ ...editData, telefono: event.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-address">Dirección</Label>
                  <Input
                    id="edit-address"
                    value={editData.direccion}
                    onChange={(event) => setEditData({ ...editData, direccion: event.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-plazo" className={columnMissing ? "text-muted-foreground" : ""}>
                    Días de crédito / plazo de pago {columnMissing ? "(columna faltante en DB)" : ""}
                  </Label>
                  <Input
                    id="edit-plazo"
                    type="number"
                    value={editData.plazo_pago_dias}
                    onChange={(event) => setEditData({ ...editData, plazo_pago_dias: parseInt(event.target.value, 10) || 0 })}
                    disabled={columnMissing}
                    className={columnMissing ? "opacity-50" : ""}
                  />
                  {columnMissing ? (
                    <p className="text-[10px] text-orange-600">Ejecuta el script SQL en Supabase para habilitar este campo.</p>
                  ) : null}
                </div>
              </div>
              <Button onClick={handleUpdateTercero} disabled={isSaving} className="w-full">
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Guardar cambios
              </Button>
            </DialogContent>
          </Dialog>

          <Button
            variant="ghost"
            className="gap-2 border border-amber-100 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
            onClick={handleDeleteTercero}
            disabled={isSaving}
          >
            <Trash2 className="h-4 w-4" /> Inactivar
          </Button>

          <Button onClick={() => navigate("/facturas/nueva")}>
            <Plus className="mr-2 h-4 w-4" /> Ingresar factura manual
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Saldo pendiente</CardDescription>
            <CardTitle className={summary.pendingBalance > 0.01 ? "text-red-600" : "text-emerald-600"}>
              {formatCurrency(summary.pendingBalance)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Total aún abierto en el estado de cuenta.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Documentos netos</CardDescription>
            <CardTitle>{formatCurrency(summary.netDocumentTotal)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Facturas y notas de crédito registradas para este {entityLabel}.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pagos aplicados</CardDescription>
            <CardTitle>{formatCurrency(summary.totalPaid)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Abonos y pagos conciliados o registrados sobre los documentos.
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="estado-cuenta" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:w-[420px]">
          <TabsTrigger value="estado-cuenta">Estado de cuenta</TabsTrigger>
          <TabsTrigger value="pagos">Pagos aplicados</TabsTrigger>
        </TabsList>

        <TabsContent value="estado-cuenta" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Estado de cuenta</CardTitle>
              <CardDescription>
                Revisa facturas, fechas de emisión, vencimientos, abonos, saldo y último pago.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emisión</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Último pago</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                        No hay documentos registrados para este {entityLabel}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    accountRows.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell>{formatDate(document.fecha_emision)}</TableCell>
                        <TableCell>{formatDate(document.fecha_vencimiento, "Sin vencimiento")}</TableCell>
                        <TableCell>
                          <div className="font-mono">{document.numero_documento || "---"}</div>
                          {document.paymentCount > 0 ? (
                            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                              <div>
                                {document.paymentCount === 1
                                  ? "Pagada con 1 transferencia"
                                  : `Pagada con ${document.paymentCount} transferencias`}
                              </div>
                              {document.paymentBreakdown.map((payment) => (
                                <div key={payment.id}>
                                  {formatDate(payment.date)} · {payment.methodLabel} {payment.sequence} · {formatCurrency(payment.amount)}
                                  {payment.reference ? ` · ${payment.reference}` : ""}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {document.tipo === "nota_credito" ? "Nota de crédito" : "Factura"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(document.total)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(document.paidAmount)}</TableCell>
                        <TableCell className={`text-right font-semibold ${document.balance > 0.01 ? "text-red-600" : "text-emerald-600"}`}>
                          {formatCurrency(document.balance)}
                        </TableCell>
                        <TableCell>{formatDate(document.lastPaymentDate, "Sin pago")}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {document.statusMeta.icon}
                            <Badge variant="outline" className={document.statusMeta.badgeClassName}>
                              {document.statusMeta.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={!document.archivo_url ? "cursor-not-allowed opacity-30" : ""}
                              onClick={() => document.archivo_url && window.open(document.archivo_url, "_blank")}
                              title={document.archivo_url ? "Ver PDF escaneado" : "No hay PDF asociado"}
                            >
                              Ver PDF
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                              onClick={() => handleDeleteFactura(document.id, document.numero_documento)}
                              title="Archivar factura"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pagos" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pagos aplicados</CardTitle>
              <CardDescription>
                Historial de pagos y abonos vinculados a los documentos de este {entityLabel}.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {paymentHistory.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center text-muted-foreground">
                  <CreditCard className="mb-2 h-10 w-10 opacity-20" />
                  <p>Todavía no hay pagos aplicados para este {entityLabel}.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha pago</TableHead>
                      <TableHead>Factura</TableHead>
                      <TableHead>Emisión</TableHead>
                      <TableHead>Vencimiento</TableHead>
                      <TableHead className="text-right">Monto aplicado</TableHead>
                      <TableHead>Movimiento / referencia</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentHistory.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell className="font-mono">{payment.documentNumber}</TableCell>
                        <TableCell>{formatDate(payment.emissionDate)}</TableCell>
                        <TableCell>{formatDate(payment.dueDate, "Sin vencimiento")}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(payment.appliedAmount)}</TableCell>
                        <TableCell>
                          <div>{payment.movementDescription}</div>
                          {payment.movementNumber ? (
                            <div className="text-xs text-muted-foreground">{payment.movementNumber}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {payment.paymentState}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
