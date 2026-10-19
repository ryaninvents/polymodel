import type { StateStore } from "#types";

type Entry = { value: unknown; expiresAt: number };

export type MemoryStoreOptions = {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
};

/**
 * Process-local state. Polymodel targets a single developer laptop, so losing
 * state on restart is acceptable: plugins must treat a miss as "start over".
 */
export function createMemoryStore({
  ttlMs,
  maxEntries,
  now = Date.now,
}: MemoryStoreOptions): StateStore {
  const entries = new Map<string, Entry>();

  function evictOverflow(): void {
    // Map iteration order is insertion order, and `set` re-inserts on write,
    // so the first key is always the least recently written.
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) return;
      entries.delete(oldest.value);
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now() + ttlMs });
      evictOverflow();
    },
    delete(key) {
      entries.delete(key);
    },
  };
}
