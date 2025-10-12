// lib/idle-bus.ts
const bus = new EventTarget();

// Call this anywhere to reset the idle timer (e.g. when video starts playing)
export function reportActivity(source: string = "generic") {
  bus.dispatchEvent(new CustomEvent("activity", { detail: { source, at: Date.now() } }));
}

export function onActivity(cb: (e: CustomEvent) => void) {
  const handler = (e: Event) => cb(e as CustomEvent);
  bus.addEventListener("activity", handler);
  return () => bus.removeEventListener("activity", handler);
}
