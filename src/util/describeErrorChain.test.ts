import { describe, expect, it } from "vitest";
import { describeErrorChain } from "./describeErrorChain.ts";

describe("describeErrorChain", () => {
  it("surfaces provider fields on every error in the cause chain", () => {
    const provider = Object.assign(new Error("Provider returned error"), {
      name: "AI_StreamProviderError",
      statusCode: 502,
      data: { error: { metadata: { provider_name: "SomeHost" } } },
    });
    const chain = describeErrorChain(new Error("outer", { cause: provider }));

    expect(chain.map((entry) => entry.name)).toEqual([
      "Error",
      "AI_StreamProviderError",
    ]);
    expect(chain[1]?.details).toEqual({
      statusCode: 502,
      data: { error: { metadata: { provider_name: "SomeHost" } } },
    });
  });

  it("truncates oversized payloads", () => {
    const error = Object.assign(new Error("big"), {
      responseBody: "x".repeat(10_000),
    });
    const body = describeErrorChain(error)[0]?.details.responseBody;
    expect(String(body).length).toBeLessThan(4100);
  });
});
