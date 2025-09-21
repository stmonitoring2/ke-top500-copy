"use client";

import * as React from "react";
import { createPortal } from "react-dom";

export function Toast({
  open,
  onClose,
  children,
  duration = 3000,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  duration?: number;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => {
    if (!open) return;
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [open, duration, onClose]);

  if (!mounted) return null;

  const node = (
    <div className="pointer-events-none fixed inset-0 z-[1000] flex items-start justify-center p-4">
      <div className="mt-2 max-w-md w-full pointer-events-auto">
        <div className="rounded-xl border border-gray-200 bg-white shadow-lg p-3 text-sm">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(open ? node : null, document.body);
}
