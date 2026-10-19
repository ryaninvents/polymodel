import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./memoryStore.ts";

function createClock(start = 0) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe("createMemoryStore", () => {
  it("expires entries after the TTL", () => {
    const clock = createClock();
    const store = createMemoryStore({
      ttlMs: 100,
      maxEntries: 10,
      now: clock.now,
    });
    store.set("a", 1);
    clock.advance(99);
    expect(store.get("a")).toBe(1);
    clock.advance(1);
    expect(store.get("a")).toBeUndefined();
  });

  it("evicts the least recently written entry when full", () => {
    const store = createMemoryStore({ ttlMs: 1000, maxEntries: 2 });
    store.set("a", 1);
    store.set("b", 2);
    store.set("a", 3);
    store.set("c", 4);
    expect(store.get("b")).toBeUndefined();
    expect(store.get("a")).toBe(3);
    expect(store.get("c")).toBe(4);
  });
});
