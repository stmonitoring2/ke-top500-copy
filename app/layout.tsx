import "./globals.css";
export const metadata = { title: "KE Top 500 – Podcasts & Interviews" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
