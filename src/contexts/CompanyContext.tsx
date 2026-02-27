import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

type Empresa = {
  id: string;
  nombre: string;
  logo_url: string | null;
  activa: boolean;
};

type MembershipRole = 'admin' | 'user' | 'viewer' | null;

type CompanyContextType = {
  empresas: Empresa[];
  selectedEmpresaId: string | null;
  selectedEmpresa: Empresa | null;
  selectedRole: MembershipRole;
  isGlobalAdmin: boolean;
  loading: boolean;
  setSelectedEmpresaId: (id: string) => void;
  refreshCompanies: () => Promise<void>;
};

const CompanyContext = createContext<CompanyContextType>({
  empresas: [],
  selectedEmpresaId: null,
  selectedEmpresa: null,
  selectedRole: null,
  isGlobalAdmin: false,
  loading: true,
  setSelectedEmpresaId: () => {},
  refreshCompanies: async () => {},
});

export const CompanyProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [selectedEmpresaId, setSelectedEmpresaIdState] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Record<string, MembershipRole>>({});
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const storageKey = user ? `selected_empresa_${user.id}` : 'selected_empresa';

  const refreshCompanies = async () => {
    if (!user) {
      setEmpresas([]);
      setMemberships({});
      setSelectedEmpresaIdState(null);
      setIsGlobalAdmin(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      const globalAdmin = profile?.role === 'admin';
      setIsGlobalAdmin(globalAdmin);

      if (globalAdmin) {
        const [{ data: empresasData }, { data: membershipData }] = await Promise.all([
          supabase.from('empresas').select('id, nombre, logo_url, activa').eq('activa', true).order('nombre', { ascending: true }),
          supabase.from('user_empresas').select('empresa_id, role').eq('user_id', user.id),
        ]);

        const allEmpresas = (empresasData || []) as Empresa[];
        const roleMap: Record<string, MembershipRole> = {};
        for (const row of membershipData || []) {
          roleMap[row.empresa_id] = row.role === 'viewer' ? 'viewer' : 'user';
        }

        setEmpresas(allEmpresas);
        setMemberships(roleMap);

        const saved = localStorage.getItem(storageKey);
        const fallback = allEmpresas[0]?.id || null;
        const next = saved && allEmpresas.some((e) => e.id === saved) ? saved : fallback;
        setSelectedEmpresaIdState(next);
      } else {
        const { data: rows } = await supabase
          .from('user_empresas')
          .select('empresa_id, role, empresas(id, nombre, logo_url, activa)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });

        const allowedRows = (rows || []).filter((r: any) => r.empresas?.activa);
        const scopedEmpresas = allowedRows
          .map((r: any) => r.empresas)
          .filter(Boolean) as Empresa[];

        const roleMap: Record<string, MembershipRole> = {};
        for (const row of allowedRows as any[]) {
          roleMap[row.empresa_id] = row.role === 'viewer' ? 'viewer' : 'user';
        }

        setEmpresas(scopedEmpresas);
        setMemberships(roleMap);

        const saved = localStorage.getItem(storageKey);
        const fallback = scopedEmpresas[0]?.id || null;
        const next = saved && scopedEmpresas.some((e) => e.id === saved) ? saved : fallback;
        setSelectedEmpresaIdState(next);
      }
    } catch (error) {
      console.error('Error loading companies:', error);
      setEmpresas([]);
      setMemberships({});
      setSelectedEmpresaIdState(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (selectedEmpresaId) {
      localStorage.setItem(storageKey, selectedEmpresaId);
    }
  }, [selectedEmpresaId, storageKey]);

  const selectedEmpresa = useMemo(
    () => empresas.find((e) => e.id === selectedEmpresaId) || null,
    [empresas, selectedEmpresaId]
  );

  const selectedRole: MembershipRole = selectedEmpresaId ? memberships[selectedEmpresaId] || (isGlobalAdmin ? 'admin' : null) : null;

  const setSelectedEmpresaId = (id: string) => {
    setSelectedEmpresaIdState(id);
  };

  return (
    <CompanyContext.Provider
      value={{
        empresas,
        selectedEmpresaId,
        selectedEmpresa,
        selectedRole,
        isGlobalAdmin,
        loading,
        setSelectedEmpresaId,
        refreshCompanies,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompany = () => useContext(CompanyContext);
