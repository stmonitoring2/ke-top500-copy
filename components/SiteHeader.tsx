// components/SiteHeader.tsx
import React from "react";
import { Video } from "lucide-react";

function NavLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { className = "", ...rest } = props;
  return (
    <a
      {...rest}
      className={
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border " +
        "border-neutral-300 bg-white/80 hover:bg-white shadow-sm hover:shadow " +
        "transition " + className
      }
    />
  );
}

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur border-b border-neutral-200">
      <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Video className="w-5 h-5" />
          <a href="/" className="font-semibold text-sm sm:text-base hover:underline">
            KE Top 500 – Podcasts & Interviews
          </a>
        </div>

        <nav className="ml-auto flex items-center gap-2">
          <NavLink href="/me/playlists" aria-label="My Playlists">My Playlists</NavLink>
          <NavLink href="/signin" aria-label="Sign in">Sign in</NavLink>
          <NavLink href="/auth/signout" aria-label="Sign out">Sign out</NavLink>
        </nav>
      </div>
    </header>
  );
}
