import { describe, expect, it } from "vitest";
import { ProviderConfigSchema } from "./config.ts";

describe("provider promptCaching", () => {
  it.each([false, { ttl: "5m" }, { ttl: "1h" }, undefined])(
    "accepts %j",
    (promptCaching) => {
      expect(
        ProviderConfigSchema.safeParse({ type: "anthropic", promptCaching })
          .success,
      ).toBe(true);
    },
  );

  it.each([true, { ttl: "2h" }, "5m"])("rejects %j", (promptCaching) => {
    expect(
      ProviderConfigSchema.safeParse({ type: "openrouter", promptCaching })
        .success,
    ).toBe(false);
  });
});
