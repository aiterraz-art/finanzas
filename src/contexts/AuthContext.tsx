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
        let profileValidationCounter = 0;

        const validateActiveProfile = async (nextSession: Session | null) => {
            if (!nextSession?.user) return;

            const currentValidation = ++profileValidationCounter;
            const { data: profile, error } = await supabase
                .from('profiles')
                .select('activo')
                .eq('id', nextSession.user.id)
                .maybeSingle();

            if (!isMounted || currentValidation !== profileValidationCounter) return;

            if (error) {
                console.error("Error validating active profile:", error);
                return;
            }

            if (profile && profile.activo === false) {
                await supabase.auth.signOut();
            }
        };

        const applySession = (nextSession: Session | null) => {
            if (!isMounted) return;
            setSession(nextSession);
            setUser(nextSession?.user ?? null);
            setLoading(false);
            void validateActiveProfile(nextSession);
        };

        // Obtenemos la sesión inicial
        supabase.auth.getSession()
            .then(({ data: { session } }) => {
                if (!isMounted) return;
                applySession(session);
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
                applySession(nextSession);
            }, 0);
        });

        return () => {
            isMounted = false;
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
