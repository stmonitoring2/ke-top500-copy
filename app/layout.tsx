// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import IdleLogoutGuard from "@/components/IdleLogoutGuard"; // <-- add

export const metadata: Metadata = { title: "KE Top 500 – Podcasts & Interviews" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <IdleLogoutGuard /> {/* <-- runs everywhere */}
        {children}
      </body>
    </html>
  );
}
