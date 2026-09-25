import { useEffect, useState } from "react";
import { elapsedLabel } from "./call-model.ts";

/** Quiet elapsed time. Not a live region, so it never interrupts a screen reader. */
export function CallTimer({ since }: { readonly since: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const started = Date.parse(since);
  if (!Number.isFinite(started)) return null;
  return (
    <span className="call-timer" role="timer" aria-label="Call duration">
      {elapsedLabel((now - started) / 1000)}
    </span>
  );
}
