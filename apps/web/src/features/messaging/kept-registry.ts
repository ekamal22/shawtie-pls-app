/*
 * The Ribbon (PRESENTATION_ONLY). Talk can show the kept mark after a reload only when it can
 * learn which messages are already kept. R1 list responses that Ours already loads carry
 * `message` source references; this in-memory registry lets Talk read them. It makes no requests,
 * does not poll, and does not persist. Until Ours has loaded Remember This in the current session
 * the registry is empty and Talk falls back to its session-only mark (known limitation).
 */

interface KeptSourceItem {
  readonly kind: string;
  readonly references: ReadonlyArray<{
    readonly referenceType: string;
    readonly referenceId?: string;
    readonly role?: string;
  }>;
}

let sources: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function sourceIds(items: readonly KeptSourceItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind !== "remember_this") continue;
    for (const reference of item.references) {
      if (
        reference.referenceType === "message" &&
        reference.role === "source" &&
        typeof reference.referenceId === "string"
      ) {
        ids.push(reference.referenceId);
      }
    }
  }
  return ids;
}

/**
 * `complete` is true for the first, unfiltered page of the Remember This list, which may
 * replace the set (so a deleted kept item stops showing its mark). Any other page only adds.
 */
export function publishKeptSources(items: readonly KeptSourceItem[], complete: boolean): void {
  const ids = sourceIds(items);
  const next = new Set(complete ? [] : sources);
  for (const id of ids) next.add(id);
  if (next.size === sources.size && [...next].every((id) => sources.has(id))) return;
  sources = next;
  for (const listener of listeners) listener();
}

export function keptSourcesSnapshot(): ReadonlySet<string> {
  return sources;
}

export function subscribeKeptSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
