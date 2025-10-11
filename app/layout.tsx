import "./globals.css";

export const metadata = {
  title: "KE Top 500 – Podcasts & Interviews",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{padding: "1rem 2rem", borderBottom: "1px solid #ddd"}}>
          <nav style={{display: "flex", gap: 12}}>
            <a href="/me/playlists">My Playlists</a>
            <a href="/signin">Sign in</a>
            <a href="/auth/signout">Sign out</a>
          </nav>
        </header>

        {/* Main site content */}
        {children}
      </body>
    </html>
  );
}
