// app/layout.tsx
import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import HeaderAuth from "@/components/HeaderAuth";
import { AuthProvider } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "KE Top 500 – Podcasts & Interviews",
  description: "Daily/weekly/monthly ranking of long-form videos with playlists.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the cookie-backed session on the server
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900">
        {/* Provide the initial user to the client so the header renders correctly immediately */}
        <AuthProvider initialUser={session?.user ?? null}>
          <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-neutral-200">
            <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-lg sm:text-xl font-semibold">
                  KE Top 500 – Podcasts & Interviews
                </span>
              </Link>

              {/* Right side: auth-aware header (Server Component that renders client buttons) */}
              <div className="ml-auto">
                <HeaderAuth />
              </div>
            </div>
          </header>

          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
