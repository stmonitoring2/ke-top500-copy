"use client";

import React, { useEffect } from "react";

type ToastProps = {
  open?: boolean;                 // optional; default true
  onClose: () => void;            // required close handler
  children?: React.ReactNode;     // not used when title/description are passed
  duration?: number;              // ms, default 3000
  title?: string;                 // our extra props
  description?: string;           // our extra props
  variant?: "success" | "error" | "info";
};

export default function Toast({
  open = true,
  onClose,
  children,
  duration = 3000,
  title,
  description,
  variant = "info",
}: ToastProps) {
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => onClose(), duration);
    return () => clearTimeout(id);
  }, [open, duration, onClose]);

  const color =
    variant === "success" ? "bg-green-100 border-green-300 text-green-800" :
    variant === "error"   ? "bg-red-100 border-red-300 text-red-800" :
                            "bg-neutral-100 border-neutral-300 text-neutral-800";

  return open ? (
    <div
      role="status"
      className={`min-w-[260px] max-w-[360px] rounded-xl border shadow-sm ${color}`}
    >
      <div className="p-3">
        {(title || description) ? (
          <>
            {title && <div className="font-semibold text-sm">{title}</div>}
            {description && <div className="text-xs mt-0.5">{description}</div>}
          </>
        ) : (
          children
        )}
      </div>
      <button
        aria-label="Close"
        className="absolute right-1.5 top-1.5 text-xs opacity-70 hover:opacity-100"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  ) : null;
}
