import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Dashboard from "@/pages/Dashboard";
import Clientes from "@/pages/Clientes";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Proveedores from "@/pages/Proveedores";
import BankReconciliation from "@/pages/BankReconciliation";
import TerceroDetalle from "@/pages/TerceroDetalle";
import CashFlow from "@/pages/CashFlow";
import Collections from "@/pages/Collections";
import Budgets from "@/pages/Budgets";
import ReconciliationAudit from "@/pages/ReconciliationAudit";
import Rendiciones from "@/pages/Rendiciones";

import ManualInvoiceEntry from "@/pages/ManualInvoiceEntry";
import Users from "@/pages/Users";

import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import RendicionPrint from "@/pages/RendicionPrint";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Navigate, Outlet } from "react-router-dom";

const ProtectedRoute = () => {
  const { session, user, loading } = useAuth();

  // Mientras carga el estado de autenticación, no redirigimos ni mostramos nada (o un spinner)
  if (loading) return null; // O un spinner centralizado

  if (!session) return <Navigate to="/login" replace />;

  // Si el usuario debe cambiar su contraseña, lo mandamos a reset-password
  // a menos que ya esté ahí.
  const mustChange = user?.user_metadata?.must_change_password;
  if (mustChange && window.location.pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />;
  }

  return <Outlet />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="clientes" element={<Clientes />} />
              <Route path="clientes/:id" element={<TerceroDetalle />} />
              <Route path="proveedores" element={<Proveedores />} />
              <Route path="proveedores/:id" element={<TerceroDetalle />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
              <Route path="reconciliation" element={<BankReconciliation />} />
              <Route path="cashflow" element={<CashFlow />} />
              <Route path="collections" element={<Collections />} />
              <Route path="budgets" element={<Budgets />} />
              <Route path="audit" element={<ReconciliationAudit />} />
              <Route path="rendiciones" element={<Rendiciones />} />
              <Route path="rendiciones/print/:id" element={<RendicionPrint />} />
              <Route path="users" element={<Users />} />
              <Route path="invoices/new" element={<ManualInvoiceEntry />} />
              <Route path="facturas/nueva" element={<ManualInvoiceEntry />} />
              <Route path="*" element={<Dashboard />} />
            </Route>
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
