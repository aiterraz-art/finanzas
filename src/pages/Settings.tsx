import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCcw, ShieldCheck, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import {
  useBankAccountPositions,
  useBankAccounts,
  useCashCommitmentTemplates,
  useTreasuryCategories,
  useTreasuryPolicy,
} from "@/hooks/useTreasury";
import { PRIORITY_BADGE_CLASSES, PRIORITY_LABELS, canEditTreasury, formatTreasuryCurrency, formatTreasuryDate } from "@/lib/treasury";
import { cn } from "@/lib/utils";

export default function Settings() {
  const { selectedEmpresa, selectedEmpresaId, selectedRole } = useCompany();
  const canEdit = canEditTreasury(selectedRole);
  const { data: policy, loading: loadingPolicy, refresh: refreshPolicy } = useTreasuryPolicy(selectedEmpresaId);
  const { data: bankAccounts, refresh: refreshBankAccounts } = useBankAccounts(selectedEmpresaId);
  const { data: bankPositions, refresh: refreshPositions } = useBankAccountPositions(selectedEmpresaId);
  const { data: categories, refresh: refreshCategories } = useTreasuryCategories(selectedEmpresaId);
  const { data: templates, refresh: refreshTemplates } = useCashCommitmentTemplates(selectedEmpresaId);

  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [policyForm, setPolicyForm] = useState({
    monedaBase: "CLP",
    timezone: "America/Santiago",
    forecastWeeks: "13",
    weekStartsOn: "1",
    minimumCashBuffer: "0",
    criticalCashBuffer: "0",
    staleBankImportDays: "3",
    missingFollowupDays: "7",
  });
  const [accountForm, setAccountForm] = useState({
    nombre: "",
    banco: "",
    tipo: "corriente",
    moneda: "CLP",
    numeroMascarado: "",
    saldoInicial: "0",
    saldoInicialFecha: new Date().toISOString().split("T")[0],
  });
  const [categoryForm, setCategoryForm] = useState({
    code: "",
    nombre: "",
    directionScope: "outflow",
    sortOrder: "100",
  });
  const [templateForm, setTemplateForm] = useState({
    description: "",
    categoryId: "",
    bankAccountId: "none",
    obligationType: "manual",
    counterparty: "",
    frequency: "monthly",
    dayOfMonth: "1",
    defaultAmount: "",
    requiresAmountConfirmation: "false",
    priority: "normal",
    nextDueDate: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    setPolicyForm({
      monedaBase: policy.monedaBase || "CLP",
      timezone: policy.timezone || "America/Santiago",
      forecastWeeks: String(policy.forecastWeeks || 13),
      weekStartsOn: String(policy.weekStartsOn || 1),
      minimumCashBuffer: String(policy.minimumCashBuffer || 0),
      criticalCashBuffer: String(policy.criticalCashBuffer || 0),
      staleBankImportDays: String(policy.staleBankImportDays || 3),
      missingFollowupDays: String(policy.missingFollowupDays || 7),
    });
  }, [policy]);

  const positionMap = useMemo(
    () => new Map(bankPositions.map((position) => [position.bankAccountId, position])),
    [bankPositions]
  );

  const refreshAll = async () => {
    await Promise.all([
      refreshPolicy(),
      refreshBankAccounts(),
      refreshPositions(),
      refreshCategories(),
      refreshTemplates(),
    ]);
  };

  const withSaving = async (section: string, work: () => Promise<void>) => {
    setSavingSection(section);
    try {
      await work();
    } catch (err: any) {
      console.error(`Settings error in ${section}:`, err);
      alert(err.message || "No se pudo guardar la configuracion.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleSavePolicy = async () => {
    if (!selectedEmpresaId || !canEdit) return;
    await withSaving("policy", async () => {
      const { error } = await supabase.from("treasury_policies").upsert({
        empresa_id: selectedEmpresaId,
        moneda_base: policyForm.monedaBase,
        timezone: policyForm.timezone,
        forecast_weeks: Number(policyForm.forecastWeeks),
        week_starts_on: Number(policyForm.weekStartsOn),
        minimum_cash_buffer: Number(policyForm.minimumCashBuffer || 0),
        critical_cash_buffer: Number(policyForm.criticalCashBuffer || 0),
        stale_bank_import_days: Number(policyForm.staleBankImportDays || 3),
        missing_followup_days: Number(policyForm.missingFollowupDays || 7),
      });
      if (error) throw error;
      await refreshPolicy();
    });
  };

  const handleCreateAccount = async () => {
    if (!selectedEmpresaId || !canEdit) return;
    if (!accountForm.nombre || !accountForm.banco) {
      alert("Nombre y banco son obligatorios.");
      return;
    }

    await withSaving("account", async () => {
      const { error } = await supabase.from("bank_accounts").insert({
        empresa_id: selectedEmpresaId,
        nombre: accountForm.nombre,
        banco: accountForm.banco,
        tipo: accountForm.tipo,
        moneda: accountForm.moneda,
        numero_mascarado: accountForm.numeroMascarado || null,
        saldo_inicial: Number(accountForm.saldoInicial || 0),
        saldo_inicial_fecha: accountForm.saldoInicialFecha,
        activa: true,
        es_principal: bankAccounts.length === 0,
      });
      if (error) throw error;
      setAccountForm({
        nombre: "",
        banco: "",
        tipo: "corriente",
        moneda: "CLP",
        numeroMascarado: "",
        saldoInicial: "0",
        saldoInicialFecha: new Date().toISOString().split("T")[0],
      });
      await Promise.all([refreshBankAccounts(), refreshPositions()]);
    });
  };

  const handleSetPrimaryAccount = async (accountId: string) => {
    if (!selectedEmpresaId || !canEdit) return;
    await withSaving(`primary-${accountId}`, async () => {
      const { error: resetError } = await supabase
        .from("bank_accounts")
        .update({ es_principal: false })
        .eq("empresa_id", selectedEmpresaId);
      if (resetError) throw resetError;

      const { error } = await supabase
        .from("bank_accounts")
        .update({ es_principal: true })
        .eq("empresa_id", selectedEmpresaId)
        .eq("id", accountId);
      if (error) throw error;

      await Promise.all([refreshBankAccounts(), refreshPositions()]);
    });
  };

  const toggleAccountActive = async (accountId: string, active: boolean) => {
    if (!canEdit) return;
    await withSaving(`account-toggle-${accountId}`, async () => {
      const { error } = await supabase.from("bank_accounts").update({ activa: !active }).eq("id", accountId);
      if (error) throw error;
      await Promise.all([refreshBankAccounts(), refreshPositions()]);
    });
  };

  const handleCreateCategory = async () => {
    if (!selectedEmpresaId || !canEdit) return;
    if (!categoryForm.code || !categoryForm.nombre) {
      alert("Codigo y nombre son obligatorios.");
      return;
    }

    await withSaving("category", async () => {
      const { error } = await supabase.from("treasury_categories").insert({
        empresa_id: selectedEmpresaId,
        code: categoryForm.code.trim().toLowerCase(),
        nombre: categoryForm.nombre,
        direction_scope: categoryForm.directionScope,
        sort_order: Number(categoryForm.sortOrder || 100),
        active: true,
        is_system: false,
      });
      if (error) throw error;
      setCategoryForm({ code: "", nombre: "", directionScope: "outflow", sortOrder: "100" });
      await refreshCategories();
    });
  };

  const toggleCategoryActive = async (categoryId: string, active: boolean) => {
    if (!canEdit) return;
    await withSaving(`category-toggle-${categoryId}`, async () => {
      const { error } = await supabase.from("treasury_categories").update({ active: !active }).eq("id", categoryId);
      if (error) throw error;
      await refreshCategories();
    });
  };

  const handleCreateTemplate = async () => {
    if (!selectedEmpresaId || !canEdit) return;
    if (!templateForm.description || !templateForm.categoryId) {
      alert("Descripcion y categoria son obligatorias.");
      return;
    }

    await withSaving("template", async () => {
      const { error } = await supabase.from("cash_commitment_templates").insert({
        empresa_id: selectedEmpresaId,
        category_id: templateForm.categoryId,
        bank_account_id: templateForm.bankAccountId === "none" ? null : templateForm.bankAccountId,
        obligation_type: templateForm.obligationType,
        description: templateForm.description,
        counterparty: templateForm.counterparty || null,
        frequency: templateForm.frequency,
        day_of_month: Number(templateForm.dayOfMonth || 1),
        default_amount: templateForm.defaultAmount ? Number(templateForm.defaultAmount) : null,
        requires_amount_confirmation: templateForm.requiresAmountConfirmation === "true",
        priority: templateForm.priority,
        active: true,
        next_due_date: templateForm.nextDueDate,
      });
      if (error) throw error;

      setTemplateForm({
        description: "",
        categoryId: "",
        bankAccountId: "none",
        obligationType: "manual",
        counterparty: "",
        frequency: "monthly",
        dayOfMonth: "1",
        defaultAmount: "",
        requiresAmountConfirmation: "false",
        priority: "normal",
        nextDueDate: new Date().toISOString().split("T")[0],
      });
      await refreshTemplates();
    });
  };

  const toggleTemplateActive = async (templateId: string, active: boolean) => {
    if (!canEdit) return;
    await withSaving(`template-toggle-${templateId}`, async () => {
      const { error } = await supabase.from("cash_commitment_templates").update({ active: !active }).eq("id", templateId);
      if (error) throw error;
      await refreshTemplates();
    });
  };

  if (!selectedEmpresaId) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>Configuracion de tesoreria</CardTitle>
            <CardDescription>Selecciona una empresa para editar sus parametros financieros.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configuracion de tesoreria</h1>
          <p className="mt-1 text-muted-foreground">
            Parametros, cuentas y plantillas para operar tesoreria profesional de {selectedEmpresa?.nombre || "la empresa"}.
          </p>
        </div>
        <Button variant="outline" onClick={refreshAll}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refrescar
        </Button>
      </div>

      {!canEdit && (
        <Card className="border-amber-200">
          <CardContent className="pt-6 text-sm text-amber-700">
            Tu rol actual es solo lectura. Puedes revisar la configuración, pero no modificar políticas ni plantillas.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="treasury" className="space-y-4">
        <TabsList className="grid h-auto grid-cols-2 gap-1 md:grid-cols-4">
          <TabsTrigger value="treasury">Tesoreria</TabsTrigger>
          <TabsTrigger value="accounts">Cuentas Bancarias</TabsTrigger>
          <TabsTrigger value="categories">Categorias</TabsTrigger>
          <TabsTrigger value="templates">Plantillas</TabsTrigger>
        </TabsList>

        <TabsContent value="treasury">
          <Card>
            <CardHeader>
              <CardTitle>Politica financiera</CardTitle>
              <CardDescription>Define buffers, horizonte, timezone y reglas operativas del cockpit.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingPolicy && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Moneda base">
                  <Input value={policyForm.monedaBase} onChange={(event) => setPolicyForm((current) => ({ ...current, monedaBase: event.target.value }))} />
                </Field>
                <Field label="Timezone">
                  <Input value={policyForm.timezone} onChange={(event) => setPolicyForm((current) => ({ ...current, timezone: event.target.value }))} />
                </Field>
                <Field label="Semanas forecast">
                  <Input type="number" min="1" value={policyForm.forecastWeeks} onChange={(event) => setPolicyForm((current) => ({ ...current, forecastWeeks: event.target.value }))} />
                </Field>
                <Field label="Inicio de semana">
                  <Select value={policyForm.weekStartsOn} onValueChange={(value) => setPolicyForm((current) => ({ ...current, weekStartsOn: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Lunes</SelectItem>
                      <SelectItem value="7">Domingo</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Buffer minimo">
                  <Input type="number" min="0" value={policyForm.minimumCashBuffer} onChange={(event) => setPolicyForm((current) => ({ ...current, minimumCashBuffer: event.target.value }))} />
                </Field>
                <Field label="Buffer critico">
                  <Input type="number" min="0" value={policyForm.criticalCashBuffer} onChange={(event) => setPolicyForm((current) => ({ ...current, criticalCashBuffer: event.target.value }))} />
                </Field>
                <Field label="Dias max. cartola vieja">
                  <Input type="number" min="1" value={policyForm.staleBankImportDays} onChange={(event) => setPolicyForm((current) => ({ ...current, staleBankImportDays: event.target.value }))} />
                </Field>
                <Field label="Dias sin follow-up">
                  <Input type="number" min="1" value={policyForm.missingFollowupDays} onChange={(event) => setPolicyForm((current) => ({ ...current, missingFollowupDays: event.target.value }))} />
                </Field>
              </div>
              <Button onClick={handleSavePolicy} disabled={savingSection === "policy" || !canEdit}>
                {savingSection === "policy" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Guardar politica
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Cuentas configuradas</CardTitle>
                <CardDescription>Saldo actual, ultima cartola y rol dentro de la empresa.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {bankAccounts.map((account) => {
                  const position = positionMap.get(account.id);
                  return (
                    <div key={account.id} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{account.nombre}</span>
                            {account.esPrincipal && <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Principal</Badge>}
                            {!account.activa && <Badge variant="outline">Inactiva</Badge>}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {account.banco} • {account.tipo} • {account.numeroMascarado || "Sin numero"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">
                            {formatTreasuryCurrency(position?.currentBalance ?? account.saldoInicial, account.moneda)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Ultima cartola {formatTreasuryDate(position?.latestStatementDate ?? account.saldoInicialFecha)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {!account.esPrincipal && (
                          <Button size="sm" variant="outline" onClick={() => handleSetPrimaryAccount(account.id)} disabled={!canEdit}>
                            Definir principal
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => toggleAccountActive(account.id, account.activa)} disabled={!canEdit}>
                          {account.activa ? "Desactivar" : "Activar"}
                        </Button>
                        <Badge
                          variant="outline"
                          className={cn(
                            position?.staleImport
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          )}
                        >
                          {position?.staleImport ? "Cartola vieja" : "Importacion al dia"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Nueva cuenta</CardTitle>
                <CardDescription>Alta manual para trabajar varias cuentas por empresa.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Nombre">
                  <Input value={accountForm.nombre} onChange={(event) => setAccountForm((current) => ({ ...current, nombre: event.target.value }))} />
                </Field>
                <Field label="Banco">
                  <Input value={accountForm.banco} onChange={(event) => setAccountForm((current) => ({ ...current, banco: event.target.value }))} />
                </Field>
                <Field label="Tipo">
                  <Select value={accountForm.tipo} onValueChange={(value) => setAccountForm((current) => ({ ...current, tipo: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corriente">Corriente</SelectItem>
                      <SelectItem value="vista">Vista</SelectItem>
                      <SelectItem value="ahorro">Ahorro</SelectItem>
                      <SelectItem value="caja_chica">Caja chica</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Moneda">
                  <Input value={accountForm.moneda} onChange={(event) => setAccountForm((current) => ({ ...current, moneda: event.target.value }))} />
                </Field>
                <Field label="Numero mascarado">
                  <Input value={accountForm.numeroMascarado} onChange={(event) => setAccountForm((current) => ({ ...current, numeroMascarado: event.target.value }))} />
                </Field>
                <Field label="Saldo inicial">
                  <Input type="number" value={accountForm.saldoInicial} onChange={(event) => setAccountForm((current) => ({ ...current, saldoInicial: event.target.value }))} />
                </Field>
                <Field label="Fecha saldo inicial">
                  <Input type="date" value={accountForm.saldoInicialFecha} onChange={(event) => setAccountForm((current) => ({ ...current, saldoInicialFecha: event.target.value }))} />
                </Field>
                <Button onClick={handleCreateAccount} disabled={savingSection === "account" || !canEdit} className="w-full">
                  {savingSection === "account" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
                  Crear cuenta
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Categorias de tesoreria</CardTitle>
                <CardDescription>Clasifican entradas, salidas y alimentan forecast, pagos y reportabilidad.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {categories.map((category) => (
                  <div key={category.id} className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{category.nombre}</span>
                        {category.isSystem && <Badge variant="outline">Sistema</Badge>}
                        {!category.active && <Badge variant="outline">Inactiva</Badge>}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {category.code} • {category.directionScope} • orden {category.sortOrder}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleCategoryActive(category.id, category.active)}
                      disabled={!canEdit}
                    >
                      {category.active ? "Archivar" : "Reactivar"}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Nueva categoria</CardTitle>
                <CardDescription>Usa codigos simples y consistentes para evitar ruido en reportes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Codigo">
                  <Input value={categoryForm.code} onChange={(event) => setCategoryForm((current) => ({ ...current, code: event.target.value }))} placeholder="ej. freight" />
                </Field>
                <Field label="Nombre">
                  <Input value={categoryForm.nombre} onChange={(event) => setCategoryForm((current) => ({ ...current, nombre: event.target.value }))} />
                </Field>
                <Field label="Alcance">
                  <Select value={categoryForm.directionScope} onValueChange={(value) => setCategoryForm((current) => ({ ...current, directionScope: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inflow">Ingreso</SelectItem>
                      <SelectItem value="outflow">Egreso</SelectItem>
                      <SelectItem value="both">Ambos</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Orden">
                  <Input type="number" value={categoryForm.sortOrder} onChange={(event) => setCategoryForm((current) => ({ ...current, sortOrder: event.target.value }))} />
                </Field>
                <Button onClick={handleCreateCategory} disabled={savingSection === "category" || !canEdit} className="w-full">
                  {savingSection === "category" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Crear categoria
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Plantillas de compromisos</CardTitle>
                <CardDescription>Base para impuestos, nomina, arriendos, servicios y otros egresos recurrentes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {templates.map((template) => (
                  <div key={template.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{template.description}</span>
                          {!template.active && <Badge variant="outline">Inactiva</Badge>}
                          <Badge variant="outline" className={cn("capitalize", PRIORITY_BADGE_CLASSES[template.priority])}>
                            {PRIORITY_LABELS[template.priority]}
                          </Badge>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {template.categoryName || "Sin categoria"} • {template.frequency} • prox. {formatTreasuryDate(template.nextDueDate)}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {template.defaultAmount !== null
                            ? formatTreasuryCurrency(template.defaultAmount, policy.monedaBase)
                            : "Monto por confirmar"}
                          {template.bankAccountName ? ` • ${template.bankAccountName}` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleTemplateActive(template.id, template.active)}
                        disabled={!canEdit}
                      >
                        {template.active ? "Archivar" : "Reactivar"}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Nueva plantilla</CardTitle>
                <CardDescription>Genera compromisos futuros dentro del forecast sin depender de facturas.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Descripcion">
                  <Input value={templateForm.description} onChange={(event) => setTemplateForm((current) => ({ ...current, description: event.target.value }))} />
                </Field>
                <Field label="Categoria">
                  <Select value={templateForm.categoryId} onValueChange={(value) => setTemplateForm((current) => ({ ...current, categoryId: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories
                        .filter((category) => category.active)
                        .map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.nombre}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Cuenta sugerida">
                  <Select value={templateForm.bankAccountId} onValueChange={(value) => setTemplateForm((current) => ({ ...current, bankAccountId: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin cuenta asignada</SelectItem>
                      {bankAccounts
                        .filter((account) => account.activa)
                        .map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.nombre}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tipo de obligacion">
                  <Select value={templateForm.obligationType} onValueChange={(value) => setTemplateForm((current) => ({ ...current, obligationType: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="tax">Impuesto</SelectItem>
                      <SelectItem value="payroll">Nomina</SelectItem>
                      <SelectItem value="recurring">Recurrente</SelectItem>
                      <SelectItem value="debt">Deuda</SelectItem>
                      <SelectItem value="capex">Capex</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Frecuencia">
                  <Select value={templateForm.frequency} onValueChange={(value) => setTemplateForm((current) => ({ ...current, frequency: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="biweekly">Quincenal</SelectItem>
                      <SelectItem value="monthly">Mensual</SelectItem>
                      <SelectItem value="quarterly">Trimestral</SelectItem>
                      <SelectItem value="annual">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Dia del mes">
                  <Input type="number" min="1" max="31" value={templateForm.dayOfMonth} onChange={(event) => setTemplateForm((current) => ({ ...current, dayOfMonth: event.target.value }))} />
                </Field>
                <Field label="Monto por defecto">
                  <Input type="number" min="0" value={templateForm.defaultAmount} onChange={(event) => setTemplateForm((current) => ({ ...current, defaultAmount: event.target.value }))} />
                </Field>
                <Field label="Contraparte">
                  <Input value={templateForm.counterparty} onChange={(event) => setTemplateForm((current) => ({ ...current, counterparty: event.target.value }))} />
                </Field>
                <Field label="Prioridad">
                  <Select value={templateForm.priority} onValueChange={(value) => setTemplateForm((current) => ({ ...current, priority: value }))}>
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
                <Field label="Requiere confirmacion de monto">
                  <Select value={templateForm.requiresAmountConfirmation} onValueChange={(value) => setTemplateForm((current) => ({ ...current, requiresAmountConfirmation: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">No</SelectItem>
                      <SelectItem value="true">Si</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Proximo vencimiento">
                  <Input type="date" value={templateForm.nextDueDate} onChange={(event) => setTemplateForm((current) => ({ ...current, nextDueDate: event.target.value }))} />
                </Field>
                <Button onClick={handleCreateTemplate} disabled={savingSection === "template" || !canEdit} className="w-full">
                  {savingSection === "template" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Crear plantilla
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
