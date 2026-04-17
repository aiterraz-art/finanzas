import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowRightLeft, Landmark, Loader2, Plus, RefreshCcw, ScrollText, Upload, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  buildObjectsFromWorksheetRows,
  canEditTreasury,
  detectChequeWorksheetFormat,
  formatTreasuryCurrency,
  formatTreasuryDate,
  normalizeChequeImportRow,
  normalizeRut,
  normalizeText,
} from "@/lib/treasury";
import { useBankAccounts, useChequeReceivables, useTreasuryKpis } from "@/hooks/useTreasury";
import type { ChequeReceivable } from "@/lib/treasury";
import { cn } from "@/lib/utils";

type InvoiceOption = {
  id: string;
  numero_documento: string | null;
  tercero_id: string | null;
  tercero_nombre: string | null;
  monto: number;
  fecha_vencimiento: string | null;
};

type ClientOption = {
  id: string;
  razon_social: string;
  rut: string | null;
};

type ChequeForm = {
  numeroCheque: string;
  bancoEmisor: string;
  librador: string;
  rutLibrador: string;
  terceroId: string;
  facturaId: string;
  bankAccountId: string;
  monto: string;
  montoAplicadoFactura: string;
  fechaEmision: string;
  fechaVencimiento: string;
  fechaCobroEsperada: string;
  estado: ChequeReceivable["estado"];
  notas: string;
};

const today = new Date().toISOString().split("T")[0];

const addDaysIso = (days: number) => {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.toISOString().split("T")[0];
};

const createChequeForm = (): ChequeForm => ({
  numeroCheque: "",
  bancoEmisor: "",
  librador: "",
  rutLibrador: "",
  terceroId: "none",
  facturaId: "none",
  bankAccountId: "none",
  monto: "",
  montoAplicadoFactura: "",
  fechaEmision: today,
  fechaVencimiento: addDaysIso(30),
  fechaCobroEsperada: addDaysIso(30),
  estado: "en_cartera",
  notas: "",
});

const chequeStatusLabels: Record<ChequeReceivable["estado"], string> = {
  en_cartera: "En cartera",
  depositado: "Depositado",
  cobrado: "Cobrado",
  rechazado: "Rechazado",
  anulado: "Anulado",
};

const chequeStatusClasses: Record<ChequeReceivable["estado"], string> = {
  en_cartera: "border-blue-200 bg-blue-50 text-blue-700",
  depositado: "border-amber-200 bg-amber-50 text-amber-700",
  cobrado: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rechazado: "border-red-200 bg-red-50 text-red-700",
  anulado: "border-slate-200 bg-slate-50 text-slate-700",
};

type ChequeImportSummary = {
  filename: string;
  imported: number;
  duplicates: number;
  createdClients: number;
  linkedInvoices: number;
  rejected: number;
};

const normalizeMatchText = (value: unknown) => normalizeText(value).toLowerCase();

const buildChequeDuplicateKey = (params: {
  numeroCheque: string;
  rut: string | null;
  razonSocial: string;
  monto: number;
  fechaVencimiento: string;
}) =>
  [
    normalizeText(params.numeroCheque),
    normalizeRut(params.rut) || normalizeMatchText(params.razonSocial),
    Number(params.monto).toFixed(2),
    params.fechaVencimiento,
  ].join("|");

export default function Cheques() {
  const { selectedEmpresa, selectedEmpresaId, selectedRole } = useCompany();
  const { user } = useAuth();
  const canEdit = canEditTreasury(selectedRole);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ChequeForm>(createChequeForm());
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBankAccountId, setImportBankAccountId] = useState("none");
  const [importSummary, setImportSummary] = useState<ChequeImportSummary | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingCheque, setEditingCheque] = useState<ChequeReceivable | null>(null);
  const [editForm, setEditForm] = useState({
    estado: "en_cartera" as ChequeReceivable["estado"],
    bankAccountId: "none",
    fechaCobroEsperada: today,
    fechaCobroReal: "",
    notas: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: cheques, loading, refresh } = useChequeReceivables(selectedEmpresaId);
  const { data: bankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: kpis } = useTreasuryKpis(selectedEmpresaId, today);

  const invoiceMap = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);
  const bankAccountMap = useMemo(() => new Map(bankAccounts.map((account) => [account.id, account])), [bankAccounts]);

  useEffect(() => {
    if (selectedEmpresaId) {
      void fetchSupportData();
    } else {
      setInvoices([]);
      setClients([]);
    }
  }, [selectedEmpresaId]);

  useEffect(() => {
    if (importBankAccountId !== "none") return;
    const preferred = bankAccounts.find((account) => account.esPrincipal) || bankAccounts[0];
    if (preferred) {
      setImportBankAccountId(preferred.id);
    }
  }, [bankAccounts, importBankAccountId]);

  const fetchSupportData = async () => {
    if (!selectedEmpresaId) return;
    setSupportLoading(true);
    try {
      const [{ data: invoiceRows, error: invoiceError }, { data: clientRows, error: clientError }] = await Promise.all([
        supabase
          .from("facturas")
          .select("id, numero_documento, tercero_id, tercero_nombre, monto, fecha_vencimiento")
          .eq("empresa_id", selectedEmpresaId)
          .eq("tipo", "venta")
          .is("archived_at", null)
          .order("fecha_emision", { ascending: false }),
        supabase
          .from("terceros")
          .select("id, razon_social, rut")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["cliente", "ambos"])
          .is("archived_at", null)
          .order("razon_social", { ascending: true }),
      ]);
      if (invoiceError) throw invoiceError;
      if (clientError) throw clientError;
      setInvoices((invoiceRows || []) as InvoiceOption[]);
      setClients((clientRows || []) as ClientOption[]);
    } catch (error) {
      console.error("Error loading cheque support data:", error);
    } finally {
      setSupportLoading(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedEmpresaId || !user || !canEdit) return;

    const bankAccountId = importBankAccountId === "none" ? null : importBankAccountId;
    setImporting(true);
    setImportSummary(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const worksheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: true });
      const detection = detectChequeWorksheetFormat(worksheetRows);

      if (detection.kind !== "cheque_portfolio" || detection.headerRowIndex === null) {
        throw new Error(detection.reason || "No se detectó un layout compatible de cheques en cartera.");
      }

      const rawRows = buildObjectsFromWorksheetRows(worksheetRows, detection.headerRowIndex);
      const parsedRows = rawRows.map((row) => normalizeChequeImportRow(row));
      const validRows = parsedRows.filter(Boolean);
      const rejected = parsedRows.length - validRows.length;
      if (validRows.length === 0) {
        throw new Error("No se encontraron cheques válidos en el archivo seleccionado.");
      }

      const [{ data: currentClients, error: clientsError }, { data: currentInvoices, error: invoicesError }, { data: currentCheques, error: chequesError }] =
        await Promise.all([
          supabase
            .from("terceros")
            .select("id, razon_social, rut")
            .eq("empresa_id", selectedEmpresaId)
            .in("tipo", ["cliente", "ambos"])
            .is("archived_at", null),
          supabase
            .from("facturas")
            .select("id, numero_documento, tercero_id, tercero_nombre, monto, fecha_vencimiento")
            .eq("empresa_id", selectedEmpresaId)
            .eq("tipo", "venta")
            .is("archived_at", null),
          supabase
            .from("cheques_cartera")
            .select("numero_cheque, rut_librador, librador, monto, fecha_vencimiento")
            .eq("empresa_id", selectedEmpresaId),
        ]);
      if (clientsError) throw clientsError;
      if (invoicesError) throw invoicesError;
      if (chequesError) throw chequesError;

      const clientByRut = new Map<string, ClientOption>();
      const clientByName = new Map<string, ClientOption>();
      for (const client of (currentClients || []) as ClientOption[]) {
        if (client.rut) clientByRut.set(normalizeRut(client.rut) || "", client);
        clientByName.set(normalizeMatchText(client.razon_social), client);
      }

      const missingClients = new Map<string, { razon_social: string; rut: string | null }>();
      for (const row of validRows) {
        if (!row) continue;
        const key = row.rut || normalizeMatchText(row.razonSocial);
        if (!key) continue;
        if (row.rut ? clientByRut.has(row.rut) : clientByName.has(normalizeMatchText(row.razonSocial))) continue;
        if (!missingClients.has(key)) {
          missingClients.set(key, { razon_social: row.razonSocial, rut: row.rut });
        }
      }

      let createdClients = 0;
      if (missingClients.size > 0) {
        const { error: insertClientsError } = await supabase.from("terceros").insert(
          Array.from(missingClients.values()).map((client) => ({
            empresa_id: selectedEmpresaId,
            rut: client.rut,
            razon_social: client.razon_social,
            tipo: "cliente",
            estado: "activo",
          }))
        );
        if (insertClientsError) throw insertClientsError;
        createdClients = missingClients.size;

        const { data: refreshedClients, error: refreshedClientsError } = await supabase
          .from("terceros")
          .select("id, razon_social, rut")
          .eq("empresa_id", selectedEmpresaId)
          .in("tipo", ["cliente", "ambos"])
          .is("archived_at", null);
        if (refreshedClientsError) throw refreshedClientsError;
        clientByRut.clear();
        clientByName.clear();
        for (const client of (refreshedClients || []) as ClientOption[]) {
          if (client.rut) clientByRut.set(normalizeRut(client.rut) || "", client);
          clientByName.set(normalizeMatchText(client.razon_social), client);
        }
      }

      const invoiceByDocument = new Map<string, InvoiceOption>();
      for (const invoice of (currentInvoices || []) as InvoiceOption[]) {
        const key = normalizeText(invoice.numero_documento);
        if (key && !invoiceByDocument.has(key)) invoiceByDocument.set(key, invoice);
      }

      const existingChequeKeys = new Set(
        ((currentCheques || []) as Array<{
          numero_cheque: string;
          rut_librador: string | null;
          librador: string;
          monto: number;
          fecha_vencimiento: string;
        }>).map((row) =>
          buildChequeDuplicateKey({
            numeroCheque: row.numero_cheque,
            rut: row.rut_librador,
            razonSocial: row.librador,
            monto: Number(row.monto),
            fechaVencimiento: row.fecha_vencimiento,
          })
        )
      );

      let linkedInvoices = 0;
      let duplicates = 0;
      const rowsToInsert = validRows.flatMap((row) => {
        if (!row) return [];
        const duplicateKey = buildChequeDuplicateKey({
          numeroCheque: row.numeroCheque,
          rut: row.rut,
          razonSocial: row.razonSocial,
          monto: row.monto,
          fechaVencimiento: row.fechaVencimiento,
        });
        if (existingChequeKeys.has(duplicateKey)) {
          duplicates += 1;
          return [];
        }
        existingChequeKeys.add(duplicateKey);

        const client = (row.rut && clientByRut.get(row.rut)) || clientByName.get(normalizeMatchText(row.razonSocial)) || null;
        const invoice = row.numeroFactura ? invoiceByDocument.get(normalizeText(row.numeroFactura)) || null : null;
        if (invoice) linkedInvoices += 1;

        return [{
          empresa_id: selectedEmpresaId,
          bank_account_id: bankAccountId,
          tercero_id: client?.id || invoice?.tercero_id || null,
          factura_id: invoice?.id || null,
          numero_cheque: row.numeroCheque,
          banco_emisor: row.banco,
          librador: row.razonSocial,
          rut_librador: row.rut,
          moneda: "CLP",
          monto: row.monto,
          monto_aplicado_factura: invoice ? Math.min(row.monto, Number(invoice.monto || row.monto)) : 0,
          fecha_emision: row.fechaRecepcion,
          fecha_vencimiento: row.fechaVencimiento,
          fecha_cobro_esperada: row.fechaVencimiento,
          estado: row.montoOriginal < 0 ? "anulado" : "en_cartera",
          notas: [row.concepto, row.observaciones, row.detalleObservacion].filter(Boolean).join(" | ") || null,
          created_by: user.id,
        }];
      });

      if (rowsToInsert.length > 0) {
        const { error: insertChequesError } = await supabase.from("cheques_cartera").insert(rowsToInsert);
        if (insertChequesError) throw insertChequesError;
      }

      setImportSummary({
        filename: file.name,
        imported: rowsToInsert.length,
        duplicates,
        createdClients,
        linkedInvoices,
        rejected,
      });

      await Promise.all([refresh(), fetchSupportData()]);
    } catch (error: any) {
      console.error("Error importing cheque portfolio:", error);
      alert(error.message || "No se pudo importar la cartera de cheques.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filteredCheques = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return cheques.filter((cheque) => {
      if (statusFilter !== "all" && cheque.estado !== statusFilter) return false;
      if (!normalizedSearch) return true;
      return [
        cheque.numeroCheque,
        cheque.librador,
        cheque.bancoEmisor,
        cheque.facturaNumero,
        cheque.terceroNombre,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [cheques, search, statusFilter]);

  const openCheques = useMemo(
    () => cheques.filter((cheque) => cheque.estado === "en_cartera" || cheque.estado === "depositado"),
    [cheques]
  );

  const totalOpenAmount = useMemo(
    () => openCheques.reduce((sum, cheque) => sum + cheque.monto, 0),
    [openCheques]
  );

  const nextSevenDaysAmount = useMemo(() => {
    const limit = addDaysIso(7);
    return openCheques
      .filter((cheque) => cheque.fechaCobroEsperada <= limit)
      .reduce((sum, cheque) => sum + cheque.monto, 0);
  }, [openCheques]);

  const overdueCount = useMemo(
    () => openCheques.filter((cheque) => cheque.fechaVencimiento < today).length,
    [openCheques]
  );

  const handleInvoiceSelect = (invoiceId: string) => {
    const invoice = invoiceMap.get(invoiceId);
    setForm((current) => ({
      ...current,
      facturaId: invoiceId,
      terceroId: invoice?.tercero_id || current.terceroId,
      librador: invoice?.tercero_nombre || current.librador,
      montoAplicadoFactura: invoice
        ? String(Math.min(Number(current.monto || invoice.monto || 0), Number(invoice.monto || 0)))
        : "0",
      fechaVencimiento: invoice?.fecha_vencimiento || current.fechaVencimiento,
      fechaCobroEsperada: invoice?.fecha_vencimiento || current.fechaCobroEsperada,
    }));
  };

  const handleCreateCheque = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedEmpresaId || !user || !canEdit) return;
    if (!form.numeroCheque || !form.librador || !form.monto) {
      alert("Número de cheque, librador y monto son obligatorios.");
      return;
    }

    setSaving(true);
    try {
      const montoCheque = Number(form.monto || 0);
      const montoAplicado = Number(form.montoAplicadoFactura || 0);

      if (!Number.isFinite(montoCheque) || montoCheque <= 0) {
        alert("El monto del cheque debe ser mayor a cero.");
        return;
      }

      if (!Number.isFinite(montoAplicado) || montoAplicado < 0) {
        alert("El monto aplicado a factura no puede ser negativo.");
        return;
      }

      if (form.facturaId === "none" && montoAplicado > 0) {
        alert("No puedes aplicar monto a factura si el cheque no tiene factura asociada.");
        return;
      }

      if (montoAplicado - montoCheque > 0.01) {
        alert("El monto aplicado a factura no puede ser mayor al monto del cheque.");
        return;
      }

      const { error } = await supabase.from("cheques_cartera").insert({
        empresa_id: selectedEmpresaId,
        bank_account_id: form.bankAccountId === "none" ? null : form.bankAccountId,
        tercero_id: form.terceroId === "none" ? null : form.terceroId,
        factura_id: form.facturaId === "none" ? null : form.facturaId,
        numero_cheque: form.numeroCheque,
        banco_emisor: form.bancoEmisor || null,
        librador: form.librador,
        rut_librador: form.rutLibrador || null,
        moneda: "CLP",
        monto: montoCheque,
        monto_aplicado_factura: montoAplicado,
        fecha_emision: form.fechaEmision || null,
        fecha_vencimiento: form.fechaVencimiento,
        fecha_cobro_esperada: form.fechaCobroEsperada,
        estado: form.estado,
        notas: form.notas || null,
        created_by: user.id,
      });
      if (error) throw error;
      setForm(createChequeForm());
      await refresh();
    } catch (error: any) {
      console.error("Error creating cheque:", error);
      alert(error.message || "No se pudo registrar el cheque.");
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (cheque: ChequeReceivable) => {
    setEditingCheque(cheque);
    setEditForm({
      estado: cheque.estado,
      bankAccountId: cheque.bankAccountId || "none",
      fechaCobroEsperada: cheque.fechaCobroEsperada,
      fechaCobroReal: cheque.fechaCobroReal || "",
      notas: cheque.notas || "",
    });
  };

  const handleSaveEdit = async () => {
    if (!selectedEmpresaId || !editingCheque || !canEdit) return;
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from("cheques_cartera")
        .update({
          estado: editForm.estado,
          bank_account_id: editForm.bankAccountId === "none" ? null : editForm.bankAccountId,
          fecha_cobro_esperada: editForm.fechaCobroEsperada,
          fecha_cobro_real: editForm.fechaCobroReal || null,
          notas: editForm.notas || null,
        })
        .eq("id", editingCheque.id)
        .eq("empresa_id", selectedEmpresaId);
      if (error) throw error;
      setEditingCheque(null);
      await refresh();
    } catch (error: any) {
      console.error("Error updating cheque:", error);
      alert(error.message || "No se pudo actualizar el cheque.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Cheques sin empresa activa</CardTitle>
            <CardDescription>Selecciona una empresa para registrar cheques en cartera.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cheques</h1>
          <p className="mt-1 text-muted-foreground">
            Controla los cheques en cartera y su entrada futura a caja para {selectedEmpresa?.nombre || "la empresa"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button variant="outline" asChild>
            <Link to="/cashflow">
              <Wallet className="mr-2 h-4 w-4" />
              Ver Tesorería
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/reconciliation">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Ir a Banco
            </Link>
          </Button>
          <Button variant="outline" onClick={() => { void refresh(); void fetchSupportData(); }}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refrescar
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={!canEdit || importing}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importar Excel
          </Button>
        </div>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar la cartera, pero no crear ni editar cheques.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Importador de cheques en cartera</CardTitle>
          <CardDescription>
            Lee el Excel operativo de cartera, crea clientes faltantes y vincula facturas por número de documento cuando exista coincidencia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[280px_1fr] md:items-end">
            <div className="space-y-2">
              <Label>Cuenta destino por defecto</Label>
              <Select value={importBankAccountId} onValueChange={setImportBankAccountId} disabled={!canEdit || importing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cuenta asignada</SelectItem>
                  {bankAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
              El importador deduplica contra cheques ya registrados usando número, RUT o razón social, monto y vencimiento. Los ingresos negativos se cargan como `anulado`.
            </div>
          </div>

          {importSummary && (
            <div className="rounded-xl border border-emerald-200 p-4 text-sm">
              <div className="font-medium text-emerald-700">Importación completada: {importSummary.filename}</div>
              <div className="mt-1 text-muted-foreground">
                {importSummary.imported} cheque(s) importados, {importSummary.duplicates} duplicado(s), {importSummary.createdClients} cliente(s) creados, {importSummary.linkedInvoices} cheque(s) vinculados a factura y {importSummary.rejected} fila(s) rechazadas.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Cheques abiertos"
          value={formatTreasuryCurrency(totalOpenAmount)}
          description={`${openCheques.length} cheque(s) en cartera o depositados`}
          icon={<ScrollText className="h-4 w-4" />}
        />
        <MetricCard
          title="Próximos 7 días"
          value={formatTreasuryCurrency(nextSevenDaysAmount)}
          description="Cobros esperados esta semana"
          icon={<Wallet className="h-4 w-4" />}
        />
        <MetricCard
          title="Vencidos"
          value={String(overdueCount)}
          description="Cheque(s) con vencimiento cumplido"
          icon={<Landmark className="h-4 w-4" />}
          tone={overdueCount > 0 ? "warning" : "default"}
        />
        <MetricCard
          title="Caja actual"
          value={formatTreasuryCurrency(kpis.currentCash)}
          description="Saldo bancario consolidado"
          icon={<Wallet className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Registrar cheque en cartera</CardTitle>
            <CardDescription>
              Vincúlalo a la factura si corresponde para que Tesorería no duplique el cobro.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateCheque}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Número de cheque</Label>
                  <Input value={form.numeroCheque} onChange={(event) => setForm((current) => ({ ...current, numeroCheque: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Banco emisor</Label>
                  <Input value={form.bancoEmisor} onChange={(event) => setForm((current) => ({ ...current, bancoEmisor: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Cliente / tercero</Label>
                  <Select value={form.terceroId} onValueChange={(value) => setForm((current) => ({ ...current, terceroId: value }))} disabled={!canEdit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin tercero vinculado</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.razon_social}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Factura asociada</Label>
                  <Select value={form.facturaId} onValueChange={handleInvoiceSelect} disabled={!canEdit || supportLoading}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin factura asociada</SelectItem>
                      {invoices.map((invoice) => (
                        <SelectItem key={invoice.id} value={invoice.id}>
                          {(invoice.numero_documento || "Sin folio")} • {invoice.tercero_nombre || "Sin cliente"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Librador</Label>
                  <Input value={form.librador} onChange={(event) => setForm((current) => ({ ...current, librador: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>RUT librador</Label>
                  <Input value={form.rutLibrador} onChange={(event) => setForm((current) => ({ ...current, rutLibrador: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Monto</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.monto}
                    onChange={(event) =>
                      setForm((current) => {
                        const nextAmount = event.target.value;
                        const numericAmount = Number(nextAmount || 0);
                        const currentApplied = Number(current.montoAplicadoFactura || 0);
                        return {
                          ...current,
                          monto: nextAmount,
                          montoAplicadoFactura:
                            currentApplied > numericAmount && Number.isFinite(numericAmount)
                              ? String(Math.max(numericAmount, 0))
                              : current.montoAplicadoFactura,
                        };
                      })
                    }
                    disabled={!canEdit}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Monto aplicado a factura</Label>
                  <Input
                    type="number"
                    min="0"
                    max={form.monto || undefined}
                    value={form.montoAplicadoFactura}
                    onChange={(event) =>
                      setForm((current) => {
                        const nextApplied = event.target.value;
                        const numericApplied = Number(nextApplied || 0);
                        const numericAmount = Number(current.monto || 0);
                        return {
                          ...current,
                          montoAplicadoFactura:
                            Number.isFinite(numericAmount) && numericApplied > numericAmount
                              ? String(numericAmount)
                              : nextApplied,
                        };
                      })
                    }
                    disabled={!canEdit}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lo aplicado a factura no puede superar el monto del cheque.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Fecha emisión</Label>
                  <Input type="date" value={form.fechaEmision} onChange={(event) => setForm((current) => ({ ...current, fechaEmision: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha vencimiento</Label>
                  <Input type="date" value={form.fechaVencimiento} onChange={(event) => setForm((current) => ({ ...current, fechaVencimiento: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha esperada de cobro</Label>
                  <Input type="date" value={form.fechaCobroEsperada} onChange={(event) => setForm((current) => ({ ...current, fechaCobroEsperada: event.target.value }))} disabled={!canEdit} />
                </div>
                <div className="space-y-2">
                  <Label>Cuenta destino</Label>
                  <Select value={form.bankAccountId} onValueChange={(value) => setForm((current) => ({ ...current, bankAccountId: value }))} disabled={!canEdit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin cuenta asignada</SelectItem>
                      {bankAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={form.estado} onValueChange={(value) => setForm((current) => ({ ...current, estado: value as ChequeReceivable["estado"] }))} disabled={!canEdit}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en_cartera">En cartera</SelectItem>
                      <SelectItem value="depositado">Depositado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Notas</Label>
                  <Textarea value={form.notas} onChange={(event) => setForm((current) => ({ ...current, notas: event.target.value }))} disabled={!canEdit} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <div className="text-sm text-muted-foreground">
                  Los cheques abiertos pasan a Tesorería como cobros por recibir.
                </div>
                <Button type="submit" disabled={!canEdit || saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Guardar cheque
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cartera abierta</CardTitle>
            <CardDescription>Cheques vigentes que todavía no entran al saldo bancario real.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {openCheques.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
                No hay cheques abiertos.
              </div>
            )}
            {openCheques.slice(0, 6).map((cheque) => (
              <div key={cheque.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      Cheque {cheque.numeroCheque} • {cheque.librador}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {cheque.bancoEmisor || "Banco no informado"} • cobro esperado {formatTreasuryDate(cheque.fechaCobroEsperada)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatTreasuryCurrency(cheque.monto, cheque.moneda)}</div>
                    <Badge variant="outline" className={cn(chequeStatusClasses[cheque.estado])}>
                      {chequeStatusLabels[cheque.estado]}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Cheques registrados</CardTitle>
            <CardDescription>Administra el estado, vencimiento y cuenta de destino de cada cheque.</CardDescription>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar número, cliente o banco..." />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="en_cartera">En cartera</SelectItem>
                <SelectItem value="depositado">Depositado</SelectItem>
                <SelectItem value="cobrado">Cobrado</SelectItem>
                <SelectItem value="rechazado">Rechazado</SelectItem>
                <SelectItem value="anulado">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cheque</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Cobro esperado</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Gestión</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCheques.map((cheque) => (
                <TableRow key={cheque.id}>
                  <TableCell>
                    <div className="font-medium">{cheque.numeroCheque}</div>
                    <div className="text-xs text-muted-foreground">{cheque.bancoEmisor || "Banco no informado"}</div>
                  </TableCell>
                  <TableCell>
                    <div>{cheque.librador}</div>
                    <div className="text-xs text-muted-foreground">
                      {cheque.facturaNumero ? `Factura ${cheque.facturaNumero}` : cheque.terceroNombre || "Sin vínculo comercial"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatTreasuryCurrency(cheque.monto, cheque.moneda)}</TableCell>
                  <TableCell>{formatTreasuryDate(cheque.fechaVencimiento)}</TableCell>
                  <TableCell>{formatTreasuryDate(cheque.fechaCobroEsperada)}</TableCell>
                  <TableCell>{cheque.bankAccountId ? bankAccountMap.get(cheque.bankAccountId)?.nombre || "Cuenta" : "Sin cuenta"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(chequeStatusClasses[cheque.estado])}>
                      {chequeStatusLabels[cheque.estado]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={!canEdit} onClick={() => openEditDialog(cheque)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredCheques.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "No hay cheques registrados para el filtro actual."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingCheque)} onOpenChange={(open) => !open && setEditingCheque(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar cheque</DialogTitle>
            <DialogDescription>
              Ajusta el estado del cheque y cuándo esperas que entre a caja o quede definitivamente cobrado.
            </DialogDescription>
          </DialogHeader>

          {editingCheque && (
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Cheque</Label>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="font-medium">
                    {editingCheque.numeroCheque} • {editingCheque.librador}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatTreasuryCurrency(editingCheque.monto, editingCheque.moneda)} • vence {formatTreasuryDate(editingCheque.fechaVencimiento)}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Select value={editForm.estado} onValueChange={(value) => setEditForm((current) => ({ ...current, estado: value as ChequeReceivable["estado"] }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en_cartera">En cartera</SelectItem>
                    <SelectItem value="depositado">Depositado</SelectItem>
                    <SelectItem value="cobrado">Cobrado</SelectItem>
                    <SelectItem value="rechazado">Rechazado</SelectItem>
                    <SelectItem value="anulado">Anulado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cuenta destino</Label>
                <Select value={editForm.bankAccountId} onValueChange={(value) => setEditForm((current) => ({ ...current, bankAccountId: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cuenta asignada</SelectItem>
                    {bankAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fecha cobro esperada</Label>
                <Input type="date" value={editForm.fechaCobroEsperada} onChange={(event) => setEditForm((current) => ({ ...current, fechaCobroEsperada: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Fecha cobro real</Label>
                <Input type="date" value={editForm.fechaCobroReal} onChange={(event) => setEditForm((current) => ({ ...current, fechaCobroReal: event.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Notas</Label>
                <Textarea value={editForm.notas} onChange={(event) => setEditForm((current) => ({ ...current, notas: event.target.value }))} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCheque(null)} disabled={savingEdit}>
              Cerrar
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon,
  tone = "default",
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <Card className={cn(tone === "warning" && "border-amber-200")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={cn("rounded-full p-2", tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-primary/10 text-primary")}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
