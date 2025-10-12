// app/layout.tsx
import "./globals.css";
import React from "react";
import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "KE Top 500 – Podcasts & Interviews",
  description: "Ranked feed + playlists",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
