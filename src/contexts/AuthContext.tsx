import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';

type AuthContextType = {
    session: Session | null;
    user: User | null;
    signOut: () => Promise<void>;
    loading: boolean;
};

const AuthContext = createContext<AuthContextType>({
    session: null,
    user: null,
    signOut: async () => { },
    loading: true,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        let authCheckCounter = 0;
        const loadingTimeout = setTimeout(() => {
            if (isMounted) {
                setLoading(false);
            }
        }, 7000);

        const resolveActiveSession = async (nextSession: Session | null) => {
            if (!nextSession?.user) {
                return { session: null, user: null };
            }

            const currentCheck = ++authCheckCounter;
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('activo')
                .eq('id', nextSession.user.id)
                .maybeSingle();

            if (currentCheck !== authCheckCounter) {
                return { session: null, user: null };
            }

            if (error) {
                console.error("Error validating active profile:", error);
                return { session: nextSession, user: nextSession.user };
            }

            if (profile && profile.activo === false) {
                await supabase.auth.signOut();
                return { session: null, user: null };
            }

            return { session: nextSession, user: nextSession.user };
        };

        const applyResolvedSession = async (nextSession: Session | null) => {
            const resolved = await resolveActiveSession(nextSession);
            if (!isMounted) return;
            setSession(resolved.session);
            setUser(resolved.user);
            setLoading(false);
        };

        // Obtenemos la sesión inicial
        supabase.auth.getSession()
            .then(async ({ data: { session } }) => {
                if (!isMounted) return;
                await applyResolvedSession(session);
            })
            .catch((error) => {
                console.error("Error getting initial session:", error);
                if (isMounted) {
                    setSession(null);
                    setUser(null);
                    setLoading(false);
                }
            });

        // Escuchamos cambios en la autenticación
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!isMounted) return;
            window.setTimeout(() => {
                void applyResolvedSession(nextSession);
            }, 0);
        });

        return () => {
            isMounted = false;
            clearTimeout(loadingTimeout);
            subscription.unsubscribe();
        };
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <AuthContext.Provider value={{ session, user, signOut, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
