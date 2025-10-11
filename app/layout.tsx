import "./globals.css";
export const metadata = { title: "KE Top 500 – Podcasts & Interviews" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <header>
        <nav style={{display:'flex', gap:12}}>
          <a href="/me/playlists">My Playlists</a>
          <a href="/signin">Sign in</a>
          <a href="/auth/signout">Sign out</a>
        </nav>
      </header>
      <body>{children}</body>
    </html>
  );
}
