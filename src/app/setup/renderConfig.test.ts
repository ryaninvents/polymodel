import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfigFile } from "#infra";
import { renderConfig, type RenderConfigOptions } from "./renderConfig.ts";

function createRenderOptions(
  overrides: Partial<RenderConfigOptions> = {},
): RenderConfigOptions {
  return {
    server: { host: "127.0.0.1", port: 4100 },
    providers: {
      anthropic: { type: "anthropic", apiKey: { env: "ANTHROPIC_API_KEY" } },
      litellm: {
        type: "openai-compatible",
        baseURL: "http://127.0.0.1:4000/v1",
      },
    },
    model: {
      id: "opus-haiku",
      planner: "anthropic:claude-opus-5-5",
      worker: "litellm:claude-haiku-5-5",
    },
    ...overrides,
  };
}

async function loadRendered(options: RenderConfigOptions, extension: string) {
  const path = join(
    mkdtempSync(join(tmpdir(), "polymodel-render-")),
    `config.${extension}`,
  );
  writeFileSync(path, renderConfig(options));
  return loadConfigFile(path);
}

describe("renderConfig", () => {
  it.each(["ts", "mjs"])("loads as a valid .%s config", async (extension) => {
    const config = await loadRendered(createRenderOptions(), extension);

    expect(config.providers).toEqual(createRenderOptions().providers);
    expect(Object.keys(config.models)).toEqual(["opus-haiku"]);
    expect(config.models["opus-haiku"]?.description).toBe(
      "Plans with anthropic:claude-opus-5-5, delegates to litellm:claude-haiku-5-5",
    );
  });

  it("keeps server settings, including the client API key", async () => {
    const server = {
      host: "0.0.0.0",
      port: 4200,
      apiKey: { env: "POLYMODEL_API_KEY" },
    };
    const config = await loadRendered(createRenderOptions({ server }), "ts");

    expect(config.server).toEqual(server);
  });
});
