import type { PolymodelConfig, ProviderConfig } from "#types";

export type RenderConfigOptions = {
  server: PolymodelConfig["server"];
  providers: Readonly<Record<string, ProviderConfig>>;
  model: Readonly<{ id: string; planner: string; worker: string }>;
};

export const CONFIG_HEADER =
  "// Polymodel config, written by `polymodel setup`. Docs: https://github.com/ryaninvents/polymodel";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** JSON with bare identifier keys, matching how people write config by hand. */
function literal(value: unknown, indent: string): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  const inner = `${indent}  `;
  const fields = entries.map(([key, v]) => {
    const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    return `${inner}${name}: ${literal(v, inner)},`;
  });
  return `{\n${fields.join("\n")}\n${indent}}`;
}

/**
 * The generated file avoids type annotations so it is valid as `.js`/`.mjs`
 * too, which lets setup rewrite whichever config file the user already has.
 */
export function renderConfig({
  server,
  providers,
  model,
}: RenderConfigOptions): string {
  const serverFields = {
    host: server.host,
    port: server.port,
    ...(server.apiKey !== undefined && { apiKey: server.apiKey }),
  };
  return `${CONFIG_HEADER}
import { defineConfig, workerBee } from "@ryaninvents/polymodel/plugin";

export default defineConfig({
  server: ${literal(serverFields, "  ")},

  // Where upstream models live. Reference them as "<provider>:<model>".
  // Keys referenced with { env } are read from the environment, then from
  // credentials.env next to this file.
  providers: ${literal(providers, "  ")},

  // Each key is a model id exposed at /v1/models.
  models: {
    ${JSON.stringify(model.id)}: workerBee({
      planner: ${JSON.stringify(model.planner)},
      worker: ${JSON.stringify(model.worker)},
    }),
  },
});
`;
}
