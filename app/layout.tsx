import "./globals.css";

export const metadata = {
  title: "KE Top 500 – Podcasts & Interviews",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        // inside <body> top area (or wherever your header lives)
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-neutral-200">
          <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 flex items-center gap-3">
            <a href="/" className="text-sm sm:text-base font-semibold">KE Top 500</a>
            <nav className="ml-auto flex items-center gap-2">
              <a
                href="/me/playlists"
                className="inline-flex items-center rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                My Playlists
              </a>
              <a
                href="/signin"
                className="inline-flex items-center rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Sign in
              </a>
              <a
                href="/auth/signout"
                className="inline-flex items-center rounded-full border px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Sign out
              </a>
            </nav>
          </div>
        </header>
        {/* Main site content */}
        {children}
      </body>
    </html>
  );
}
