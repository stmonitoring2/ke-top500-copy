"use client";

import React from "react";
import { RefreshCw } from "lucide-react";

type Props = {
  onRefresh: () => Promise<void> | void;
  className?: string;
};

export default function ReloadButton({ onRefresh, className = "" }: Props) {
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
      title="Refresh (R)"
      className={`inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm shadow-sm hover:shadow-md border border-neutral-200 bg-white hover:bg-neutral-50 transition disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{loading ? "Refreshing…" : "Refresh"}</span>
    </button>
  );
}
