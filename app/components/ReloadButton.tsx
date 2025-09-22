"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

export type ReloadButtonProps = {
  /** Called when the user clicks refresh. Can be async. */
  onRefresh: () => Promise<void> | void;
  className?: string;
  /** Optional label override (defaults to "Refresh"). */
  label?: string;
};

export const ReloadButton: React.FC<ReloadButtonProps> = ({
  onRefresh,
  className = "",
  label = "Refresh",
}) => {
  const [loading, setLoading] = React.useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onRefresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      title={label}
      className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm shadow-sm hover:shadow-md border border-neutral-200 bg-white hover:bg-neutral-50 transition disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
};
