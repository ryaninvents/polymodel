import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { defaultConfigDirectory } from "./configLoader.ts";
import type { Env } from "./env.ts";

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER = `# Written by \`polymodel setup\`. Values here are read as environment
# variables; variables already set in the environment take precedence.
`;

export class CredentialsError extends Error {
  readonly code = "CREDENTIALS_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

/**
 * API keys live next to the config rather than in the shell profile so that
 * background services (e.g. `brew services`), which don't load the profile,
 * still find them.
 */
export function credentialsFilePath(env: Env): string {
  return join(defaultConfigDirectory(env), "credentials.env");
}

export function readCredentialsFile(
  path: string,
): Readonly<Record<string, string>> {
  if (!existsSync(path)) return {};
  const entries = Object.entries(parseEnv(readFileSync(path, "utf8")));
  return Object.fromEntries(
    entries.filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

export function formatCredentials(
  credentials: Readonly<Record<string, string>>,
): string {
  const lines = Object.entries(credentials)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => {
      if (!VARIABLE_NAME.test(name))
        throw new CredentialsError(`Invalid variable name: ${name}`);
      if (/["\r\n]/.test(value))
        throw new CredentialsError(`${name} contains quotes or newlines`);
      return `${name}="${value}"`;
    });
  return `${HEADER}${lines.join("\n")}\n`;
}

/** Writes the file readable only by the current user, since it holds secrets. */
export function writeCredentialsFile(
  path: string,
  credentials: Readonly<Record<string, string>>,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatCredentials(credentials), { mode: 0o600 });
  // `mode` only applies when the file is created.
  chmodSync(path, 0o600);
}
