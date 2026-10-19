import { credentialsFilePath, readCredentialsFile } from "./credentialsFile.ts";
import { createEnv, type Env } from "./env.ts";

/** The process environment layered over the credentials file written by setup. */
export function loadEnv(
  processEnv: Readonly<Record<string, string | undefined>>,
): Env {
  const credentials = readCredentialsFile(
    credentialsFilePath(createEnv(processEnv)),
  );
  // An empty variable in the shell shouldn't mask a key saved by setup.
  const setVariables = Object.entries(processEnv).filter(([, value]) => value);
  return createEnv({ ...credentials, ...Object.fromEntries(setVariables) });
}
