import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Loader2, Mail, Pencil, Plus, Save, ShieldPlus, Trash2, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { inviteUserInternal } from '@/lib/internalAutomation';
import { useCompany } from '@/contexts/CompanyContext';
import { useAuth } from '@/contexts/AuthContext';

const COMPANY_ROLES = ['owner', 'admin', 'manager', 'user', 'viewer'] as const;
type CompanyRole = typeof COMPANY_ROLES[number];

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

const EMPTY_COMPANY_FORM: CompanyForm = {
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

const formatProfileCreatedAt = (raw: unknown) => {
    if (raw === null || raw === undefined) return '-';
    if (typeof raw === 'number') {
        return format(new Date(raw * 1000), "d 'de' MMMM, yyyy", { locale: es });
    }
    if (typeof raw === 'string') {
        const date = new Date(raw);
        if (!Number.isNaN(date.getTime())) {
            return format(date, "d 'de' MMMM, yyyy", { locale: es });
        }
    }
    return '-';
};

export default function Users() {
    const { user } = useAuth();
    const { selectedEmpresaId, selectedEmpresa, isGlobalAdmin, refreshCompanies, setSelectedEmpresaId } = useCompany();

    const [users, setUsers] = useState<any[]>([]);
    const [memberships, setMemberships] = useState<Record<string, CompanyRole>>({});
    const [companies, setCompanies] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingCompanies, setLoadingCompanies] = useState(true);

    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState("user");
    const [isInviting, setIsInviting] = useState(false);

    const [isCompanyDialogOpen, setIsCompanyDialogOpen] = useState(false);
    const [isSavingCompany, setIsSavingCompany] = useState(false);
    const [isUploadingLogo, setIsUploadingLogo] = useState(false);
    const [companyForm, setCompanyForm] = useState<CompanyForm>(EMPTY_COMPANY_FORM);
    const logoInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (selectedEmpresaId) {
            fetchUsers();
        } else {
            setUsers([]);
            setMemberships({});
            setLoading(false);
        }
    }, [selectedEmpresaId]);

    useEffect(() => {
        if (isGlobalAdmin) {
            fetchCompanies();
        } else {
            setLoadingCompanies(false);
        }
    }, [isGlobalAdmin]);

    const fetchCompanies = async () => {
        setLoadingCompanies(true);
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
            setLoadingCompanies(false);
        }
    };

    const fetchUsers = async () => {
        if (!selectedEmpresaId) return;

        setLoading(true);
        try {
            const [{ data: profileData, error: profilesError }, { data: membershipData, error: membershipsError }] = await Promise.all([
                supabase.from('profiles').select('*').order('created_at', { ascending: false }),
                supabase.from('user_empresas').select('user_id, role').eq('empresa_id', selectedEmpresaId),
            ]);

            if (profilesError) throw profilesError;
            if (membershipsError) throw membershipsError;

            const roleMap: Record<string, CompanyRole> = {};
            for (const row of membershipData || []) {
                if (COMPANY_ROLES.includes(row.role)) {
                    roleMap[row.user_id] = row.role;
                }
            }

            setUsers(profileData || []);
            setMemberships(roleMap);
        } catch (error) {
            console.error("Error fetching users:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleInvite = async () => {
        if (!inviteEmail) return;
        setIsInviting(true);
        try {
            await inviteUserInternal(inviteEmail, inviteRole as "user" | "admin");
            alert("Invitación enviada con éxito.");
            setIsInviteOpen(false);
            setInviteEmail("");
            fetchUsers();
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        } finally {
            setIsInviting(false);
        }
    };

    const handleDeleteUser = async (userId: string) => {
        if (!confirm("¿Estás seguro de que deseas eliminar este usuario? Esta acción no se puede deshacer.")) return;

        try {
            const { error } = await supabase.rpc('delete_user_completely', { user_id: userId });
            if (error) throw error;

            setUsers(prev => prev.filter(u => u.id !== userId));
            alert("Usuario eliminado correctamente (Auth + Perfil).");
        } catch (error: any) {
            console.error("Error deleting user:", error);
            alert(`Error al eliminar usuario: ${error.message}`);
        }
    };

    const handleSetCompanyRole = async (userId: string, role: CompanyRole) => {
        if (!selectedEmpresaId) return;

        try {
            const { error } = await supabase
                .from('user_empresas')
                .upsert([
                    { user_id: userId, empresa_id: selectedEmpresaId, role },
                ], { onConflict: 'user_id,empresa_id' });

            if (error) throw error;

            setMemberships((prev) => ({
                ...prev,
                [userId]: role,
            }));
        } catch (error: any) {
            alert(`No se pudo actualizar permiso: ${error.message}`);
        }
    };

    const handleRemoveAccess = async (userId: string) => {
        if (!selectedEmpresaId) return;
        if (!confirm('¿Quitar acceso de este usuario a la empresa actual?')) return;

        try {
            const { error } = await supabase
                .from('user_empresas')
                .delete()
                .eq('user_id', userId)
                .eq('empresa_id', selectedEmpresaId);

            if (error) throw error;
            setMemberships((prev) => {
                const next = { ...prev };
                delete next[userId];
                return next;
            });
        } catch (error: any) {
            alert(`No se pudo quitar acceso: ${error.message}`);
        }
    };

    const startCreateCompany = () => {
        setCompanyForm(EMPTY_COMPANY_FORM);
        setIsCompanyDialogOpen(true);
    };

    const startEditCompany = (company: any) => {
        setCompanyForm({
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
        setIsCompanyDialogOpen(true);
    };

    const canSaveCompany = useMemo(() => {
        return companyForm.nombre.trim().length > 0 && companyForm.razon_social.trim().length > 0;
    }, [companyForm.nombre, companyForm.razon_social]);

    const handleSaveCompany = async () => {
        if (!canSaveCompany || !user) return;

        setIsSavingCompany(true);
        try {
            const payload = {
                nombre: companyForm.nombre.trim(),
                razon_social: companyForm.razon_social.trim(),
                rut: companyForm.rut.trim() || null,
                email: companyForm.email.trim() || null,
                telefono: companyForm.telefono.trim() || null,
                direccion: companyForm.direccion.trim() || null,
                ciudad: companyForm.ciudad.trim() || null,
                pais: companyForm.pais.trim() || 'Chile',
                moneda: companyForm.moneda.trim() || 'CLP',
                timezone: companyForm.timezone.trim() || 'America/Santiago',
                logo_url: companyForm.logo_url.trim() || null,
                activa: companyForm.activa,
            };

            if (companyForm.id) {
                const { error } = await supabase
                    .from('empresas')
                    .update(payload)
                    .eq('id', companyForm.id);
                if (error) throw error;
            } else {
                const { data, error } = await supabase
                    .from('empresas')
                    .insert([payload])
                    .select('id')
                    .single();

                if (error) throw error;

                const { error: membershipError } = await supabase
                    .from('user_empresas')
                    .upsert([{ user_id: user.id, empresa_id: data.id, role: 'owner' }], { onConflict: 'user_id,empresa_id' });

                if (membershipError) throw membershipError;
            }

            setIsCompanyDialogOpen(false);
            setCompanyForm(EMPTY_COMPANY_FORM);
            await Promise.all([fetchCompanies(), refreshCompanies()]);
        } catch (error: any) {
            alert(`No se pudo guardar empresa: ${error.message}`);
        } finally {
            setIsSavingCompany(false);
        }
    };

    const handleUploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setIsUploadingLogo(true);
            const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
            const safeName = (companyForm.nombre || 'empresa').toLowerCase().replace(/[^a-z0-9-_]/g, '-');
            const path = `${safeName}/${Date.now()}.${ext}`;

            const { error: uploadError } = await supabase.storage
                .from('company-logos')
                .upload(path, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data } = supabase.storage.from('company-logos').getPublicUrl(path);
            setCompanyForm((prev) => ({ ...prev, logo_url: data.publicUrl }));
        } catch (error: any) {
            alert(`No se pudo subir el logo: ${error.message}`);
        } finally {
            setIsUploadingLogo(false);
            if (logoInputRef.current) logoInputRef.current.value = '';
        }
    };

    const usersWithAccess = useMemo(() => users.filter((u) => memberships[u.id]), [users, memberships]);

    if (!isGlobalAdmin) {
        return (
            <div className="rounded-lg border bg-card p-6 text-muted-foreground">
                Solo un administrador global puede acceder a este módulo.
            </div>
        );
    }

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Administración</h1>
                <p className="text-muted-foreground mt-1">
                    Control centralizado de empresas, usuarios y permisos por empresa.
                </p>
            </div>

            <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle>Empresas</CardTitle>
                        <CardDescription>Crea o edita empresas con sus datos corporativos y logo único.</CardDescription>
                    </div>
                    <Dialog open={isCompanyDialogOpen} onOpenChange={setIsCompanyDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2" onClick={startCreateCompany}>
                                <Plus className="h-4 w-4" /> Nueva Empresa
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>{companyForm.id ? 'Editar Empresa' : 'Crear Empresa'}</DialogTitle>
                                <DialogDescription>Completa los datos base para operar la empresa de forma independiente.</DialogDescription>
                            </DialogHeader>

                            <div className="grid gap-4 py-4 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label>Nombre Comercial *</Label>
                                    <Input value={companyForm.nombre} onChange={(e) => setCompanyForm({ ...companyForm, nombre: e.target.value })} placeholder="LAB3D" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Razón Social *</Label>
                                    <Input value={companyForm.razon_social} onChange={(e) => setCompanyForm({ ...companyForm, razon_social: e.target.value })} placeholder="Laboratorio Dental 3D SpA" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>RUT Empresa</Label>
                                    <Input value={companyForm.rut} onChange={(e) => setCompanyForm({ ...companyForm, rut: e.target.value })} placeholder="76.123.456-7" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Email</Label>
                                    <Input value={companyForm.email} onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })} placeholder="admin@empresa.cl" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Teléfono</Label>
                                    <Input value={companyForm.telefono} onChange={(e) => setCompanyForm({ ...companyForm, telefono: e.target.value })} placeholder="+56 9 ..." />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Dirección</Label>
                                    <Input value={companyForm.direccion} onChange={(e) => setCompanyForm({ ...companyForm, direccion: e.target.value })} placeholder="Av. Apoquindo 123" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Ciudad</Label>
                                    <Input value={companyForm.ciudad} onChange={(e) => setCompanyForm({ ...companyForm, ciudad: e.target.value })} placeholder="Santiago" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>País</Label>
                                    <Input value={companyForm.pais} onChange={(e) => setCompanyForm({ ...companyForm, pais: e.target.value })} />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Moneda</Label>
                                    <Input value={companyForm.moneda} onChange={(e) => setCompanyForm({ ...companyForm, moneda: e.target.value.toUpperCase() })} placeholder="CLP" />
                                </div>
                                <div className="grid gap-2">
                                    <Label>Zona Horaria</Label>
                                    <Input value={companyForm.timezone} onChange={(e) => setCompanyForm({ ...companyForm, timezone: e.target.value })} placeholder="America/Santiago" />
                                </div>
                                <div className="grid gap-2 md:col-span-2">
                                    <Label>Logo URL</Label>
                                    <div className="flex gap-2">
                                        <Input value={companyForm.logo_url} onChange={(e) => setCompanyForm({ ...companyForm, logo_url: e.target.value })} placeholder="https://.../logo.png" />
                                        <input
                                            ref={logoInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleUploadLogo}
                                        />
                                        <Button type="button" variant="outline" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo}>
                                            {isUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsCompanyDialogOpen(false)}>Cancelar</Button>
                                <Button onClick={handleSaveCompany} disabled={!canSaveCompany || isSavingCompany}>
                                    {isSavingCompany ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Guardar
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    {loadingCompanies ? (
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
                                                <Button variant="outline" size="sm" onClick={() => startEditCompany(company)}>
                                                    <Pencil className="h-4 w-4 mr-1" /> Editar
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {companies.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                                            No hay empresas creadas.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle>Usuarios y Permisos</CardTitle>
                        <CardDescription>
                            Empresa activa: <span className="font-semibold">{selectedEmpresa?.nombre || 'Ninguna seleccionada'}</span>
                        </CardDescription>
                    </div>
                    <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
                        <DialogTrigger asChild>
                            <Button className="gap-2">
                                <Plus className="w-4 h-4" /> Invitar Usuario
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                                <DialogTitle>Invitar Nuevo Usuario</DialogTitle>
                                <DialogDescription>
                                    Se enviará un correo con instrucciones para acceder al sistema.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="email">Correo Electrónico</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="usuario@lab3d.cl"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="role">Rol Global</Label>
                                    <Select value={inviteRole} onValueChange={setInviteRole}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecciona un rol" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="user">Usuario</SelectItem>
                                            <SelectItem value="admin">Administrador</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsInviteOpen(false)}>Cancelar</Button>
                                <Button onClick={handleInvite} disabled={isInviting}>
                                    {isInviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                                    Enviar Invitación
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    {!selectedEmpresaId ? (
                        <div className="rounded-md border p-4 text-sm text-muted-foreground">
                            Selecciona una empresa en la tabla superior para asignar permisos.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Usuario</TableHead>
                                    <TableHead>Rol Global</TableHead>
                                    <TableHead>Permiso en Empresa</TableHead>
                                    <TableHead>Fecha Registro</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            <div className="flex justify-center items-center">
                                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : users.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                            No hay usuarios registrados.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    users.map((profile) => {
                                        const companyRole = memberships[profile.id];
                                        return (
                                            <TableRow key={profile.id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                                            {profile.email?.substring(0, 2).toUpperCase()}
                                                        </div>
                                                        {profile.email}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={profile.role === 'admin' ? 'default' : 'secondary'} className="capitalize">
                                                        {profile.role}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <Select
                                                            value={companyRole || undefined}
                                                            onValueChange={(value) => handleSetCompanyRole(profile.id, value as CompanyRole)}
                                                        >
                                                            <SelectTrigger className="w-40">
                                                                <SelectValue placeholder="Sin acceso" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {COMPANY_ROLES.map((role) => (
                                                                    <SelectItem key={role} value={role}>
                                                                        {role}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        {!companyRole && (
                                                            <Badge variant="outline">Sin acceso</Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{formatProfileCreatedAt(profile.created_at)}</TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        {companyRole && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-muted-foreground hover:text-amber-600"
                                                                onClick={() => handleRemoveAccess(profile.id)}
                                                                title="Quitar acceso a esta empresa"
                                                            >
                                                                <ShieldPlus className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                                            onClick={() => handleDeleteUser(profile.id)}
                                                            title="Eliminar usuario"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {selectedEmpresaId && (
                <div className="text-sm text-muted-foreground">
                    Usuarios con acceso en esta empresa: <strong>{usersWithAccess.length}</strong>
                </div>
            )}
        </div>
    );
}
