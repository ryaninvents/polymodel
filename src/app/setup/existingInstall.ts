import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  credentialsFilePath,
  defaultConfigDirectory,
  findConfigFile,
  loadConfigFile,
  readCredentialsFile,
  type Env,
} from "#infra";
import type { PolymodelConfig } from "#types";

export type ExistingConfig =
  | { status: "missing" }
  | { status: "loaded"; config: PolymodelConfig; source: string }
  | { status: "invalid"; error: Error };

export type Install = {
  configPath: string;
  credentialsPath: string;
  credentials: Readonly<Record<string, string>>;
  existing: ExistingConfig;
};

async function loadExisting(path: string): Promise<ExistingConfig> {
  if (!existsSync(path)) return { status: "missing" };
  try {
    const config = await loadConfigFile(path);
    return { status: "loaded", config, source: readFileSync(path, "utf8") };
  } catch (error) {
    return {
      status: "invalid",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export async function detectInstall(
  env: Env,
  explicitPath: string | undefined,
): Promise<Install> {
  const configPath =
    findConfigFile(env, explicitPath) ??
    join(defaultConfigDirectory(env), "config.ts");
  const credentialsPath = credentialsFilePath(env);
  return {
    configPath,
    credentialsPath,
    credentials: readCredentialsFile(credentialsPath),
    existing: await loadExisting(configPath),
  };
}

const MODEL_ID = /^\s*["']?([\w.-]+)["']?\s*:\s*workerBee\(/m;
const PLANNER = /\bplanner\s*:\s*["']([^"']+)["']/;
const WORKER = /\bworker\s*:\s*["']([^"']+)["']/;

/**
 * Polymodels are opaque objects once loaded, so the previous worker-bee
 * choice is recovered from the config's source. It only seeds prompt defaults,
 * so a miss on a hand-written config just falls back to suggestions.
 */
export function readModelDefaults(
  source: string,
): Partial<Record<"id" | "planner" | "worker", string>> {
  return {
    id: MODEL_ID.exec(source)?.[1],
    planner: PLANNER.exec(source)?.[1],
    worker: WORKER.exec(source)?.[1],
  };
}
