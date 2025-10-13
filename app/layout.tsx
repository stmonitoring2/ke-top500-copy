// app/layout.tsx
import "./globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import HeaderAuthButtons from "@/components/HeaderAuthButtons";

export const metadata: Metadata = {
  title: "KE Top 500 – Podcasts & Interviews",
  description:
    "Daily/weekly/monthly ranking of long-form videos with playlists.",
  manifest: "/site.webmanifest",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">
        {/* Global header */}
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-neutral-200">
          <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg sm:text-xl font-semibold">
                KE Top 500 – Podcasts & Interviews
              </span>
            </Link>

            {/* Right side: auth-aware buttons (client component) */}
            <div className="ml-auto">
              <HeaderAuthButtons />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="min-h-[calc(100vh-56px)]">{children}</main>

        {/* (Optional) global footer */}
        <footer className="border-t border-neutral-200 bg-white">
          <div className="mx-auto max-w-7xl px-3 sm:px-4 py-6 text-center text-xs text-neutral-500">
            Data refreshes twice daily. Rankings may shift as new videos drop.
          </div>
        </footer>
      </body>
    </html>
  );
}
