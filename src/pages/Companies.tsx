import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Building2, Loader2, Pencil, Plus, Save, Upload } from 'lucide-react';

type CompanyForm = {
  id?: string;
  nombre: string;
  razon_social: string;
  rut: string;
  email: string;
  telefono: string;
  direccion: string;
  ciudad: string;
  pais: string;
  moneda: string;
  timezone: string;
  logo_url: string;
  activa: boolean;
};

const EMPTY_FORM: CompanyForm = {
  nombre: '',
  razon_social: '',
  rut: '',
  email: '',
  telefono: '',
  direccion: '',
  ciudad: '',
  pais: 'Chile',
  moneda: 'CLP',
  timezone: 'America/Santiago',
  logo_url: '',
  activa: true,
};

export default function Companies() {
  const { user } = useAuth();
  const { isGlobalAdmin, selectedEmpresaId, setSelectedEmpresaId, refreshCompanies } = useCompany();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isGlobalAdmin) {
      fetchCompanies();
    } else {
      setLoading(false);
    }
  }, [isGlobalAdmin]);

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('empresas')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCompanies(data || []);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const startEdit = (company: any) => {
    setForm({
      id: company.id,
      nombre: company.nombre || '',
      razon_social: company.razon_social || '',
      rut: company.rut || '',
      email: company.email || '',
      telefono: company.telefono || '',
      direccion: company.direccion || '',
      ciudad: company.ciudad || '',
      pais: company.pais || 'Chile',
      moneda: company.moneda || 'CLP',
      timezone: company.timezone || 'America/Santiago',
      logo_url: company.logo_url || '',
      activa: company.activa ?? true,
    });
    setOpen(true);
  };

  const canSave = useMemo(() => {
    return form.nombre.trim().length > 0 && form.razon_social.trim().length > 0;
  }, [form.nombre, form.razon_social]);

  const handleSave = async () => {
    if (!canSave || !user) return;
    setSaving(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        razon_social: form.razon_social.trim(),
        rut: form.rut.trim() || null,
        email: form.email.trim() || null,
        telefono: form.telefono.trim() || null,
        direccion: form.direccion.trim() || null,
        ciudad: form.ciudad.trim() || null,
        pais: form.pais.trim() || 'Chile',
        moneda: form.moneda.trim() || 'CLP',
        timezone: form.timezone.trim() || 'America/Santiago',
        logo_url: form.logo_url.trim() || null,
        activa: form.activa,
      };

      if (form.id) {
        const { error } = await supabase.from('empresas').update(payload).eq('id', form.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('empresas').insert([payload]).select('id').single();
        if (error) throw error;

        const { error: membershipError } = await supabase
          .from('user_empresas')
          .upsert([{ user_id: user.id, empresa_id: data.id, role: 'owner' }], { onConflict: 'user_id,empresa_id' });

        if (membershipError) throw membershipError;
      }

      setOpen(false);
      setForm(EMPTY_FORM);
      await Promise.all([fetchCompanies(), refreshCompanies()]);
    } catch (error: any) {
      alert(`No se pudo guardar empresa: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingLogo(true);
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const safeName = (form.nombre || 'empresa').toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      const path = `${safeName}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('company-logos').getPublicUrl(path);
      setForm((prev) => ({ ...prev, logo_url: data.publicUrl }));
    } catch (error: any) {
      alert(`No se pudo subir el logo: ${error.message}`);
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  if (!isGlobalAdmin) {
    return (
      <div className="rounded-lg border bg-card p-6 text-muted-foreground">
        Solo un administrador global puede crear o editar empresas.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Empresas</h1>
          <p className="text-muted-foreground mt-1">Administra empresas, logos y datos corporativos.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={startCreate}>
              <Plus className="h-4 w-4" /> Nueva Empresa
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{form.id ? 'Editar Empresa' : 'Crear Empresa'}</DialogTitle>
              <DialogDescription>Completa los datos base para operar la empresa de forma independiente.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label>Nombre Comercial *</Label>
                <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="EMPRESA" />
              </div>
              <div className="grid gap-2">
                <Label>Razón Social *</Label>
                <Input value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} placeholder="Empresa Ejemplo SpA" />
              </div>
              <div className="grid gap-2">
                <Label>RUT Empresa</Label>
                <Input value={form.rut} onChange={(e) => setForm({ ...form, rut: e.target.value })} placeholder="76.123.456-7" />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@empresa.cl" />
              </div>
              <div className="grid gap-2">
                <Label>Teléfono</Label>
                <Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="+56 9 ..." />
              </div>
              <div className="grid gap-2">
                <Label>Dirección</Label>
                <Input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} placeholder="Av. Apoquindo 123" />
              </div>
              <div className="grid gap-2">
                <Label>Ciudad</Label>
                <Input value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} placeholder="Santiago" />
              </div>
              <div className="grid gap-2">
                <Label>País</Label>
                <Input value={form.pais} onChange={(e) => setForm({ ...form, pais: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label>Moneda</Label>
                <Input value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value.toUpperCase() })} placeholder="CLP" />
              </div>
              <div className="grid gap-2">
                <Label>Zona Horaria</Label>
                <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="America/Santiago" />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label>Logo URL</Label>
                <div className="flex gap-2">
                  <Input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://.../logo.png" />
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleUploadLogo}
                  />
                  <Button type="button" variant="outline" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                    {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!canSave || saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empresas Registradas</CardTitle>
          <CardDescription>Selecciona una empresa para operar o edita sus datos.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-24 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>RUT</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{company.nombre}</p>
                          <p className="text-xs text-muted-foreground">{company.razon_social || '-'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{company.rut || '-'}</TableCell>
                    <TableCell>{company.email || company.telefono || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={company.activa ? 'default' : 'secondary'}>
                        {company.activa ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant={selectedEmpresaId === company.id ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSelectedEmpresaId(company.id)}
                        >
                          {selectedEmpresaId === company.id ? 'Activa' : 'Usar'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => startEdit(company)}>
                          <Pencil className="h-4 w-4 mr-1" /> Editar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {companies.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">No hay empresas creadas.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
