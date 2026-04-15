import { Link, useLocation } from "react-router-dom";
import {
    LayoutDashboard,
    Scale,
    Building2,
    BarChart3,
    Settings,
    Truck,
    TrendingUp,
    HandCoins,
    ReceiptText,
    Target,
    ShieldCheck,
    ClipboardList,
    LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";

const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Banco", href: "/reconciliation", icon: Scale },
    { name: "Tesoreria", href: "/cashflow", icon: TrendingUp },
    { name: "Egresos", href: "/egresos", icon: ReceiptText },
    { name: "Cobranzas", href: "/collections", icon: HandCoins },
    { name: "Presupuestos", href: "/budgets", icon: Target },
    { name: "Auditoría", href: "/audit", icon: ShieldCheck },
    { name: "Rendiciones", href: "/rendiciones", icon: ClipboardList },
    { name: "Clientes", href: "/clientes", icon: Building2 },
    { name: "Proveedores", href: "/proveedores", icon: Truck },
    { name: "Reportes", href: "/reports", icon: BarChart3 },
];

export function Sidebar() {
    const location = useLocation();
    const { signOut } = useAuth();
    const { selectedEmpresa, isGlobalAdmin } = useCompany();


    return (
        <div className="flex flex-col w-64 border-r bg-card h-screen fixed left-0 top-0 z-40">
            <div className="h-24 flex items-center px-6 border-b">
                <Link to="/" className="flex items-center w-full justify-center">
                    <img
                        src={selectedEmpresa?.logo_url || "/logo_lab3d.jpg"}
                        alt={selectedEmpresa?.nombre || "LAB3D Logo"}
                        className="h-16 w-auto object-contain transition-transform hover:scale-105"
                    />
                </Link>
            </div>

            <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
                <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Menu
                </div>
                {isGlobalAdmin && (
                    <>
                        <Link
                            to="/users"
                            className={cn(
                                "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors mb-1",
                                location.pathname === "/users"
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            <ShieldCheck className="w-5 h-5" />
                            Administración
                        </Link>
                    </>
                )}

                {navigation.map((item) => {
                    const isActive = location.pathname === item.href ||
                        (item.href !== "/" && location.pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.name}
                            to={item.href}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors",
                                isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                        >
                            <item.icon className="w-5 h-5" />
                            {item.name}
                        </Link>
                    );
                })}
            </div>

            <div className="p-4 border-t space-y-1">
                <Link
                    to="/settings"
                    className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
                >
                    <Settings className="w-5 h-5" />
                    Configuración
                </Link>
                <button
                    onClick={() => signOut()}
                    className="flex w-full items-center gap-3 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
                >
                    <LogOut className="w-5 h-5" />
                    Cerrar Sesión
                </button>
            </div>
        </div>
    );
}
