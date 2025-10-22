// lib/loadDaily.ts
export async function loadDaily() {
  const url = "/data/top500.json";
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error("Daily data unavailable");
  }

  const data = await res.json();
  return data;
}
