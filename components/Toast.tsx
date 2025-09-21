"use client";
import React, { useEffect } from "react";
import { X } from "lucide-react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastProps {
  /** Show/hide; optional so callers can omit it (defaults to true) */
  open?: boolean;
  /** Required close handler */
  onClose: () => void;
  /** Optional auto-dismiss in ms (e.g., 4000) */
  duration?: number;

  /** You can pass structured content... */
  title?: string;
  description?: string;
  variant?: ToastVariant;

  /** ...or raw children for full control */
  children?: React.ReactNode;
}

const variantStyles: Record<ToastVariant, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  error: "border-rose-300 bg-rose-50 text-rose-900",
  info: "border-neutral-300 bg-white text-neutral-900",
};

export default function Toast({
  open = true,
  onClose,
  duration = 4000,
  title,
  description,
  variant = "info",
  children,
}: ToastProps) {
  useEffect(() => {
    if (!open || !duration) return;
    const id = setTimeout(onClose, duration);
    return () => clearTimeout(id);
  }, [open, duration, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 top-3 z-[100] flex justify-center px-3 sm:px-4">
      <div
        role="status"
        aria-live="polite"
        className={`w-full max-w-md rounded-2xl border shadow-lg ${variantStyles[variant]}`}
      >
        <div className="p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              {title ? (
                <p className="font-semibold leading-5">{title}</p>
              ) : null}
              {description ? (
                <p className="text-sm mt-0.5 text-neutral-700">{description}</p>
              ) : null}
              {!title && !description && children}
            </div>
            <button
              aria-label="Close"
              onClick={onClose}
              className="ml-auto inline-flex shrink-0 items-center rounded-lg p-1 hover:bg-black/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
