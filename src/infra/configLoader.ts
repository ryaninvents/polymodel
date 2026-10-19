import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { PolymodelConfigSchema, type PolymodelConfig } from "#types";
import type { Env } from "./env.ts";

const PACKAGE_NAME = "@ryaninvents/polymodel";
const CONFIG_FILENAMES = [
  "config.ts",
  "config.mts",
  "config.mjs",
  "config.js",
] as const;

export class ConfigError extends Error {
  readonly code = "CONFIG_INVALID" as const;
  constructor(path: string, detail: string) {
    super(`Invalid polymodel config at ${path}:\n${detail}`);
    this.name = "ConfigError";
  }
}

/**
 * Config files usually live in ~/.config with no node_modules of their own, so a
 * bare `import ... from '@ryaninvents/polymodel/plugin'` would not resolve. Point
 * those imports at this running copy, which also guarantees the config shares
 * module instances with the server.
 */
export function registerPackageAlias(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const isOwnPackage =
        specifier === PACKAGE_NAME || specifier.startsWith(`${PACKAGE_NAME}/`);
      // Resolving as if imported from this file turns the bare specifier into
      // a package self-reference, which always finds this running copy.
      return nextResolve(
        specifier,
        isOwnPackage ? { ...context, parentURL: import.meta.url } : context,
      );
    },
  });
}

export function defaultConfigDirectory(env: Env): string {
  const { XDG_CONFIG_HOME, HOME } = env.values;
  return join(XDG_CONFIG_HOME ?? join(HOME ?? ".", ".config"), "polymodel");
}

/** Explicit path > POLYMODEL_CONFIG > first existing file in the config directory. */
export function findConfigFile(
  env: Env,
  explicitPath?: string,
): string | undefined {
  const requested = explicitPath ?? env.values.POLYMODEL_CONFIG;
  if (requested) return resolve(requested);
  const directory = defaultConfigDirectory(env);
  return CONFIG_FILENAMES.map((name) => join(directory, name)).find((path) =>
    existsSync(path),
  );
}

export async function loadConfigFile(path: string): Promise<PolymodelConfig> {
  if (!existsSync(path)) throw new ConfigError(path, "File does not exist");
  const module: { default?: unknown } = await import(pathToFileURL(path).href);
  if (module.default === undefined) {
    throw new ConfigError(
      path,
      "The config file must `export default defineConfig({...})`",
    );
  }
  return parseConfig(module.default, path);
}

export function parseConfig(input: unknown, source: string): PolymodelConfig {
  const parsed = PolymodelConfigSchema.safeParse(input);
  if (!parsed.success)
    throw new ConfigError(source, z.prettifyError(parsed.error));
  return parsed.data;
}
