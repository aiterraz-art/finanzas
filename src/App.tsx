import { BrowserRouter as Router, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
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
import Egresos from "@/pages/Egresos";
import Cheques from "@/pages/Cheques";
import WebPay from "@/pages/WebPay";

import ManualInvoiceEntry from "@/pages/ManualInvoiceEntry";
import InvoicesList from "@/pages/InvoicesList";
import InvoiceImport from "@/pages/InvoiceImport";
import Users from "@/pages/Users";

import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import RendicionPrint from "@/pages/RendicionPrint";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { CompanyProvider, useCompany } from "@/contexts/CompanyContext";

const ProtectedRoute = () => {
  const { session, user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  if (!session) return <Navigate to="/login" replace />;

  const mustChange = user?.user_metadata?.must_change_password;
  if (mustChange && location.pathname !== "/reset-password") {
    return <Navigate to="/reset-password" replace />;
  }

  return <Outlet />;
};

const AdminRoute = () => {
  const { loading, isGlobalAdmin } = useCompany();

  if (loading) return null;
  if (!isGlobalAdmin) return <Navigate to="/" replace />;

  return <Outlet />;
};

function App() {
  return (
    <AuthProvider>
      <CompanyProvider>
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
                <Route path="cuentas-por-pagar" element={<Proveedores />} />
                <Route path="proveedores/:id" element={<TerceroDetalle />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<Settings />} />
                <Route path="reconciliation" element={<BankReconciliation />} />
                <Route path="banco" element={<Navigate to="/reconciliation" replace />} />
                <Route path="cashflow" element={<CashFlow />} />
                <Route path="flujo-caja" element={<Navigate to="/cashflow" replace />} />
                <Route path="egresos" element={<Egresos />} />
                <Route path="cheques" element={<Cheques />} />
                <Route path="webpay" element={<WebPay />} />
                <Route path="expenses" element={<Navigate to="/egresos" replace />} />
                <Route path="collections" element={<Collections />} />
                <Route path="budgets" element={<Budgets />} />
                <Route path="audit" element={<ReconciliationAudit />} />
                <Route path="rendiciones" element={<Rendiciones />} />
                <Route path="rendiciones/print/:id" element={<RendicionPrint />} />
                <Route path="facturas" element={<InvoicesList />} />
                <Route path="facturas/importar" element={<InvoiceImport />} />
                <Route path="invoice-import" element={<InvoiceImport />} />
                <Route path="invoices/new" element={<ManualInvoiceEntry />} />
                <Route path="facturas/nueva" element={<ManualInvoiceEntry />} />
                <Route element={<AdminRoute />}>
                  <Route path="users" element={<Users />} />
                  <Route path="empresas" element={<Navigate to="/users" replace />} />
                </Route>
                <Route path="*" element={<Dashboard />} />
              </Route>
            </Route>
          </Routes>
        </Router>
      </CompanyProvider>
    </AuthProvider>
  );
}

export default App;
