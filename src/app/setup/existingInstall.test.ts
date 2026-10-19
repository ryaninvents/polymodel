import { describe, expect, it } from "vitest";
import { readModelDefaults } from "./existingInstall.ts";

describe("readModelDefaults", () => {
  it("recovers the first worker-bee polymodel from config source", () => {
    const source = `export default defineConfig({
      models: {
        "opus-haiku": workerBee({
          planner: 'litellm:claude-opus-5-5',
          worker: "litellm:claude-haiku-5-5",
        }),
      },
    });`;

    expect(readModelDefaults(source)).toEqual({
      id: "opus-haiku",
      planner: "litellm:claude-opus-5-5",
      worker: "litellm:claude-haiku-5-5",
    });
  });

  it("returns nothing for configs it can't read", () => {
    expect(readModelDefaults("export default makeConfig();")).toEqual({
      id: undefined,
      planner: undefined,
      worker: undefined,
    });
  });
});
