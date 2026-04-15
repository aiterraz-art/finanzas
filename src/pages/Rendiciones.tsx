import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip, Plus, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { useBankAccounts, useTreasuryCategories } from "@/hooks/useTreasury";
import {
  PRIORITY_BADGE_CLASSES,
  PRIORITY_LABELS,
  canEditTreasury,
  formatTreasuryCurrency,
  formatTreasuryDate,
} from "@/lib/treasury";
import { cn } from "@/lib/utils";

type RendicionItem = {
  descripcion: string;
  monto: number;
};

type Trabajador = {
  id: string;
  razon_social: string;
  cargo: string | null;
};

type Rendicion = {
  id: string;
  fecha: string | null;
  tercero_id: string | null;
  tercero_nombre: string | null;
  descripcion: string | null;
  monto_total: number;
  estado: string;
  archivos_urls: string[] | null;
  treasury_category_id: string | null;
  planned_cash_date: string | null;
  treasury_priority: "critical" | "high" | "normal" | "deferrable" | null;
  preferred_bank_account_id: string | null;
};

const today = new Date().toISOString().split("T")[0];

export default function Rendiciones() {
  const { selectedEmpresaId, selectedRole } = useCompany();
  const canEdit = canEditTreasury(selectedRole);
  const [rendiciones, setRendiciones] = useState<Rendicion[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingRendicion, setEditingRendicion] = useState<Rendicion | null>(null);
  const [savingTreasury, setSavingTreasury] = useState(false);
  const [terceros, setTerceros] = useState<Trabajador[]>([]);
  const [selectedTercero, setSelectedTercero] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [items, setItems] = useState<RendicionItem[]>([{ descripcion: "", monto: 0 }]);
  const [files, setFiles] = useState<File[]>([]);
  const [treasuryForm, setTreasuryForm] = useState({
    categoryId: "",
    priority: "high",
    plannedCashDate: today,
    preferredBankAccountId: "none",
  });
  const [editForm, setEditForm] = useState({
    categoryId: "",
    priority: "high",
    plannedCashDate: today,
    preferredBankAccountId: "none",
  });

  const { data: bankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: treasuryCategories } = useTreasuryCategories(selectedEmpresaId);

  useEffect(() => {
    if (selectedEmpresaId) {
      void fetchRendiciones();
      void fetchTerceros();
    }
  }, [selectedEmpresaId]);

  useEffect(() => {
    const defaultCategoryId = treasuryCategories.find((category) => category.code === "other_outflow")?.id ?? "";
    setTreasuryForm((current) =>
      current.categoryId
        ? current
        : {
            ...current,
            categoryId: defaultCategoryId,
          }
    );
  }, [treasuryCategories]);

  const fetchRendiciones = async () => {
    if (!selectedEmpresaId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("rendiciones")
        .select("id, fecha, tercero_id, tercero_nombre, descripcion, monto_total, estado, archivos_urls, treasury_category_id, planned_cash_date, treasury_priority, preferred_bank_account_id")
        .eq("empresa_id", selectedEmpresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRendiciones((data || []) as Rendicion[]);
    } catch (error) {
      console.error("Error fetching rendiciones:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTerceros = async () => {
    if (!selectedEmpresaId) return;
    try {
      const { data, error } = await supabase
        .from("terceros")
        .select("id, razon_social, cargo")
        .eq("empresa_id", selectedEmpresaId)
        .eq("estado", "activo")
        .eq("es_trabajador", true)
        .order("razon_social", { ascending: true });
      if (error) throw error;
      setTerceros((data || []) as Trabajador[]);
    } catch (error) {
      console.error("Error fetching terceros:", error);
    }
  };

  const totalMonto = items.reduce((sum, item) => sum + Number(item.monto || 0), 0);

  const totals = useMemo(() => {
    return rendiciones.reduce(
      (acc, rendicion) => {
        if (rendicion.estado === "pendiente") {
          acc.pending += rendicion.monto_total;
          if (rendicion.planned_cash_date && new Date(rendicion.planned_cash_date).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000) {
            acc.dueSoon += rendicion.monto_total;
          }
        }
        return acc;
      },
      { pending: 0, dueSoon: 0 }
    );
  }, [rendiciones]);

  const handleAddItem = () => {
    setItems((current) => [...current, { descripcion: "", monto: 0 }]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleUpdateItem = (index: number, field: keyof RendicionItem, value: string | number) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: field === "monto" ? Number(value) : value } : item
      )
    );
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;
    setFiles((current) => [...current, ...Array.from(event.target.files || [])]);
  };

  const handleSubmit = async () => {
    if (!selectedEmpresaId) return;
    if (!selectedTercero || items.some((item) => !item.descripcion || item.monto <= 0)) {
      alert("Completa trabajador y detalle de gastos.");
      return;
    }

    setIsSubmitting(true);
    try {
      const uploadedUrls: string[] = [];

      for (const file of files) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
        const filePath = `rendiciones/${fileName}`;
        const { error: uploadError } = await supabase.storage.from("invoices").upload(filePath, file);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("invoices").getPublicUrl(filePath);
        uploadedUrls.push(data.publicUrl);
      }

      const selectedWorker = terceros.find((tercero) => tercero.id === selectedTercero);
      const { data: rendicion, error: rendicionError } = await supabase
        .from("rendiciones")
        .insert({
          empresa_id: selectedEmpresaId,
          tercero_id: selectedTercero,
          tercero_nombre: selectedWorker?.razon_social,
          descripcion,
          monto_total: totalMonto,
          archivos_urls: uploadedUrls,
          estado: "pendiente",
          treasury_category_id: treasuryForm.categoryId || null,
          planned_cash_date: treasuryForm.plannedCashDate || today,
          treasury_priority: treasuryForm.priority,
          preferred_bank_account_id: treasuryForm.preferredBankAccountId === "none" ? null : treasuryForm.preferredBankAccountId,
        })
        .select()
        .single();
      if (rendicionError) throw rendicionError;

      const detailRows = items.map((item) => ({
        empresa_id: selectedEmpresaId,
        rendicion_id: rendicion.id,
        descripcion: item.descripcion,
        monto: item.monto,
      }));

      const { error: detailsError } = await supabase.from("rendicion_detalles").insert(detailRows);
      if (detailsError) throw detailsError;

      setIsCreateOpen(false);
      resetForm();
      await fetchRendiciones();
    } catch (error: any) {
      console.error("Error saving rendicion:", error);
      alert(`No se pudo guardar la rendición: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    const defaultCategoryId = treasuryCategories.find((category) => category.code === "other_outflow")?.id ?? "";
    setSelectedTercero("");
    setDescripcion("");
    setItems([{ descripcion: "", monto: 0 }]);
    setFiles([]);
    setTreasuryForm({
      categoryId: defaultCategoryId,
      priority: "high",
      plannedCashDate: today,
      preferredBankAccountId: "none",
    });
  };

  const openEditDialog = (rendicion: Rendicion) => {
    const defaultCategoryId = treasuryCategories.find((category) => category.code === "other_outflow")?.id ?? "";
    setEditingRendicion(rendicion);
    setEditForm({
      categoryId: rendicion.treasury_category_id || defaultCategoryId,
      priority: rendicion.treasury_priority || "high",
      plannedCashDate: rendicion.planned_cash_date || rendicion.fecha || today,
      preferredBankAccountId: rendicion.preferred_bank_account_id || "none",
    });
  };

  const handleSaveTreasury = async () => {
    if (!selectedEmpresaId || !editingRendicion) return;
    setSavingTreasury(true);
    try {
      const { error } = await supabase
        .from("rendiciones")
        .update({
          treasury_category_id: editForm.categoryId || null,
          planned_cash_date: editForm.plannedCashDate || null,
          treasury_priority: editForm.priority,
          preferred_bank_account_id: editForm.preferredBankAccountId === "none" ? null : editForm.preferredBankAccountId,
        })
        .eq("id", editingRendicion.id)
        .eq("empresa_id", selectedEmpresaId);
      if (error) throw error;
      setEditingRendicion(null);
      await fetchRendiciones();
    } catch (error: any) {
      console.error("Error saving treasury metadata:", error);
      alert(`No se pudo guardar la configuración de tesorería: ${error.message}`);
    } finally {
      setSavingTreasury(false);
    }
  };

  const categoriesById = useMemo(
    () => new Map(treasuryCategories.map((category) => [category.id, category.nombre])),
    [treasuryCategories]
  );
  const accountsById = useMemo(
    () => new Map(bankAccounts.map((account) => [account.id, account.nombre])),
    [bankAccounts]
  );

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Rendiciones</CardTitle>
            <CardDescription>Selecciona una empresa para gestionar reembolsos.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rendiciones</h1>
          <p className="mt-1 text-muted-foreground">
            Gestiona gastos del equipo y mételos correctamente a la cola de pagos.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} disabled={!canEdit}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva rendición
        </Button>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar rendiciones, pero no crear ni editar.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Rendiciones registradas" value={String(rendiciones.length)} description="Histórico visible" />
        <SummaryCard title="Pendiente de pago" value={formatTreasuryCurrency(totals.pending)} description="Estado pendiente" />
        <SummaryCard title="Impacto próximos 7 días" value={formatTreasuryCurrency(totals.dueSoon)} description="Según planned cash date" tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado de rendiciones</CardTitle>
          <CardDescription>Incluye categoría, prioridad, fecha esperada de pago y cuenta sugerida.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && rendiciones.length === 0 && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {rendiciones.map((rendicion) => (
            <div key={rendicion.id} className="rounded-xl border p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="font-medium">{rendicion.tercero_nombre || "Sin responsable"}</div>
                  <div className="text-sm text-muted-foreground">
                    {rendicion.descripcion || "Sin descripción"} • {formatTreasuryDate(rendicion.fecha)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{rendicion.estado}</Badge>
                  <Badge variant="outline" className={cn("capitalize", PRIORITY_BADGE_CLASSES[rendicion.treasury_priority || "high"])}>
                    {PRIORITY_LABELS[rendicion.treasury_priority || "high"]}
                  </Badge>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[0.8fr_0.9fr_0.9fr_0.8fr_0.8fr]">
                <MetaBlock label="Monto" value={formatTreasuryCurrency(rendicion.monto_total)} />
                <MetaBlock label="Pago esperado" value={formatTreasuryDate(rendicion.planned_cash_date)} />
                <MetaBlock label="Categoría" value={categoriesById.get(rendicion.treasury_category_id || "") || "Sin categoría"} />
                <MetaBlock label="Cuenta" value={accountsById.get(rendicion.preferred_bank_account_id || "") || "Sin cuenta"} />
                <div className="flex items-end justify-start lg:justify-end">
                  <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => openEditDialog(rendicion)}>
                    Editar tesorería
                  </Button>
                </div>
              </div>

              {rendicion.archivos_urls && rendicion.archivos_urls.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {rendicion.archivos_urls.map((url, index) => (
                    <a key={`${rendicion.id}-${index}`} href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                      Respaldo {index + 1}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!loading && rendiciones.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              No hay rendiciones registradas.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Nueva rendición</DialogTitle>
            <DialogDescription>Se registrará con metadata de tesorería desde el origen.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Trabajador">
              <Select value={selectedTercero} onValueChange={setSelectedTercero}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona trabajador" />
                </SelectTrigger>
                <SelectContent>
                  {terceros.map((tercero) => (
                    <SelectItem key={tercero.id} value={tercero.id}>
                      {tercero.razon_social}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Descripción">
              <Input value={descripcion} onChange={(event) => setDescripcion(event.target.value)} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Categoría tesorería">
                <Select value={treasuryForm.categoryId} onValueChange={(value) => setTreasuryForm((current) => ({ ...current, categoryId: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {treasuryCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Prioridad">
                <Select value={treasuryForm.priority} onValueChange={(value) => setTreasuryForm((current) => ({ ...current, priority: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critica</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="deferrable">Postergable</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Fecha esperada de pago">
                <Input type="date" value={treasuryForm.plannedCashDate} onChange={(event) => setTreasuryForm((current) => ({ ...current, plannedCashDate: event.target.value }))} />
              </Field>
              <Field label="Cuenta preferida">
                <Select value={treasuryForm.preferredBankAccountId} onValueChange={(value) => setTreasuryForm((current) => ({ ...current, preferredBankAccountId: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cuenta</SelectItem>
                    {bankAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Detalle</Label>
                <Button type="button" size="sm" variant="outline" onClick={handleAddItem}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar ítem
                </Button>
              </div>
              {items.map((item, index) => (
                <div key={index} className="grid gap-3 md:grid-cols-[1fr_180px_48px]">
                  <Input value={item.descripcion} onChange={(event) => handleUpdateItem(index, "descripcion", event.target.value)} placeholder="Descripción del gasto" />
                  <Input type="number" min="0" value={item.monto} onChange={(event) => handleUpdateItem(index, "monto", event.target.value)} placeholder="Monto" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveItem(index)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Field label="Respaldos">
              <div className="space-y-3">
                <Input type="file" multiple onChange={handleFileChange} />
                <div className="flex flex-wrap gap-2">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
                      <Paperclip className="h-3 w-3" />
                      {file.name}
                    </div>
                  ))}
                </div>
              </div>
            </Field>

            <div className="rounded-xl border bg-muted/20 p-4 text-sm">
              Total rendición: <strong>{formatTreasuryCurrency(totalMonto)}</strong>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar rendición
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRendicion)} onOpenChange={(open) => !open && setEditingRendicion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar tesorería de rendición</DialogTitle>
            <DialogDescription>
              {editingRendicion ? `${editingRendicion.tercero_nombre || "Sin responsable"} • ${editingRendicion.descripcion || "Rendición"}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Categoría">
              <Select value={editForm.categoryId} onValueChange={(value) => setEditForm((current) => ({ ...current, categoryId: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {treasuryCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Prioridad">
              <Select value={editForm.priority} onValueChange={(value) => setEditForm((current) => ({ ...current, priority: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">Critica</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="deferrable">Postergable</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fecha esperada de pago">
              <Input type="date" value={editForm.plannedCashDate} onChange={(event) => setEditForm((current) => ({ ...current, plannedCashDate: event.target.value }))} />
            </Field>
            <Field label="Cuenta preferida">
              <Select value={editForm.preferredBankAccountId} onValueChange={(value) => setEditForm((current) => ({ ...current, preferredBankAccountId: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cuenta</SelectItem>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRendicion(null)}>Cancelar</Button>
            <Button onClick={handleSaveTreasury} disabled={savingTreasury}>
              {savingTreasury ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
  tone = "default",
}: {
  title: string;
  value: string;
  description: string;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={tone === "warning" ? "border-amber-200" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function MetaBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
