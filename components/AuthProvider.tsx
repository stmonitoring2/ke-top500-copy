"use client";

import { createClient } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type UserLite = { id: string } | null;
type Ctx = { user: UserLite; setUser(u: UserLite): void };

const AuthCtx = createContext<Ctx | undefined>(undefined);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

export function AuthProvider({ initialUser, children }: { initialUser: any; children: React.ReactNode }) {
  const [user, setUser] = useState<UserLite>(initialUser ? { id: initialUser.id } : null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(data.session?.user ? { id: data.session.user.id } : null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });

    return () => {
      sub.subscription?.unsubscribe?.();
      mounted = false;
    };
  }, []);

  const value = useMemo(() => ({ user, setUser }), [user]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
