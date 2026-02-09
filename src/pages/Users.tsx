import { useState, useEffect } from 'react';
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
import { Loader2, Plus, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const INVITE_WEBHOOK_URL = import.meta.env.VITE_N8N_INVITE_WEBHOOK_URL;

export default function Users() {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState("user");
    const [isInviting, setIsInviting] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setUsers(data || []);
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
            // Trigger n8n webhook
            if (!INVITE_WEBHOOK_URL) {
                alert("Webhook URL not configured (VITE_N8N_INVITE_WEBHOOK_URL)");
                return;
            }

            const response = await fetch(INVITE_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: inviteEmail,
                    role: inviteRole,
                    invited_by: "admin", // Could use current user email
                    app_url: 'https://lab-finanzas.vercel.app/'
                })
            });

            if (response.ok) {
                alert("Invitación enviada con éxito.");
                setIsInviteOpen(false);
                setInviteEmail("");
                // Optionally refetch if the webhook creates the user immediately, 
                // but usually the user is created when they sign up or the webhook does it.
                // We'll refetch just in case.
                fetchUsers();
            } else {
                throw new Error("Error al comunicarse con el servidor de invitaciones.");
            }
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        } finally {
            setIsInviting(false);
        }
    };

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestión de Usuarios</h1>
                    <p className="text-muted-foreground mt-1">
                        Administra el acceso y roles de los miembros del equipo.
                    </p>
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
                                <Label htmlFor="role">Rol</Label>
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
            </div>

            <div className="border rounded-md bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Usuario</TableHead>
                            <TableHead>Rol</TableHead>
                            <TableHead>Fecha Registro</TableHead>
                            <TableHead className="text-right">Estado</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : users.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                    No hay usuarios registrados.
                                </TableCell>
                            </TableRow>
                        ) : (
                            users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                                {user.email?.substring(0, 2).toUpperCase()}
                                            </div>
                                            {user.email}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'} className="capitalize">
                                            {user.role}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        {user.created_at ? format(new Date(user.created_at * 1000), "d 'de' MMMM, yyyy", { locale: es }) : '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50">Activo</Badge>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
