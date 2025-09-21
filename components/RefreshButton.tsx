"use client";

import * as React from "react";

type AnyJson = Record<string, any>;
type Metrics = {
  updatedChannels: number;
  newVideoCount: number;
};

function extractLatestIdFromChannel(ch: AnyJson): string | null {
  const c = ch || {};
  if (typeof c.latestVideoId === "string") return c.latestVideoId;
  if (typeof c.last_video_id === "string") return c.last_video_id;
  if (c.latest && typeof c.latest.videoId === "string") return c.latest.videoId;
  if (c.latest && typeof c.latest.id === "string") return c.latest.id;
  if (typeof c.latest_id === "string") return c.latest_id;
  return null;
}

function indexByChannelId(arr: AnyJson[]): Record<string, AnyJson> {
  const map: Record<string, AnyJson> = {};
  for (const it of arr || []) {
    const id =
      it.channel_id ||
      it.channelId ||
      it.id ||
      it.youtube_channel_id ||
      (it.channel && it.channel.id);
    if (typeof id === "string") map[id] = it;
  }
  return map;
}

function computeDiff(oldData: AnyJson, newData: AnyJson): Metrics {
  const getList = (obj: AnyJson) =>
    Array.isArray(obj) ? obj : obj.items || obj.channels || obj.data || [];

  const before = getList(oldData || {});
  const after = getList(newData || {});
  const beforeMap = indexByChannelId(before);
  const afterMap = indexByChannelId(after);

  let updated = 0;

  for (const key of Object.keys(afterMap)) {
    const a = afterMap[key];
    const b = beforeMap[key];
    if (!b) continue; // treat brand-new channels as not "updated" (tweak if desired)
    const aVid = extractLatestIdFromChannel(a);
    const bVid = extractLatestIdFromChannel(b);
    if (aVid && bVid && aVid !== bVid) updated += 1;
  }

  return { updatedChannels: updated, newVideoCount: updated };
}

export function RefreshButton({
  onData,
  baseline,
  onMetrics,
  className = "",
}: {
  onData: (data: AnyJson) => void;
  baseline?: AnyJson | null;
  onMetrics?: (m: Metrics) => void;
  className?: string;
}) {
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<null | { type: "ok" | "err"; text: string }>(null);

  async function handleRefresh() {
    setMessage(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/top500?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upstream ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
      }
      const json = await res.json();

      if (baseline && onMetrics) {
        const metrics = computeDiff(baseline, json);
        onMetrics(metrics);
      }

      onData(json);
      setMessage({ type: "ok", text: "Data refreshed" });
    } catch (err: any) {
      setMessage({ type: "err", text: err?.message ?? "Refresh failed" });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 2500);
    }
  }

  return (
    <div className={`inline-flex flex-col items-start gap-2 ${className}`}>
      <button
        onClick={handleRefresh}
        disabled={loading}
        className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium
          border border-gray-300 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed`}
        aria-busy={loading}
        aria-live="polite"
      >
        {loading && (
          <svg aria-hidden className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        <span>{loading ? "Refreshing…" : "Refresh"}</span>
      </button>

      {message && (
        <div
          role="status"
          className={`text-xs rounded-md px-2 py-1 ${
            message.type === "ok"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
