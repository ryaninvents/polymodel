import { z } from "zod";
import type { Secret } from "#types";

const PolymodelEnvSchema = z.object({
  POLYMODEL_CONFIG: z.string().min(1).optional(),
  POLYMODEL_HOST: z.string().min(1).optional(),
  POLYMODEL_PORT: z.coerce.number().int().min(0).max(65535).optional(),
  POLYMODEL_LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "silent"])
    .default("info"),
  POLYMODEL_PLANNER_MODEL: z.string().min(1).optional(),
  POLYMODEL_WORKER_MODEL: z.string().min(1).optional(),
  XDG_CONFIG_HOME: z.string().min(1).optional(),
  HOME: z.string().min(1).optional(),
});

export type PolymodelEnvValues = z.output<typeof PolymodelEnvSchema>;

export class EnvError extends Error {
  readonly code = "ENV_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export class MissingSecretError extends Error {
  readonly code = "SECRET_MISSING" as const;
  constructor(variable: string) {
    super(`Environment variable ${variable} is not set`);
    this.name = "MissingSecretError";
  }
}

/** The single gateway for environment access. */
export function createEnv(
  source: Readonly<Record<string, string | undefined>>,
) {
  const parsed = PolymodelEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      `Invalid environment:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return {
    values: parsed.data,
    /** Reads a variable that isn't part of the schema, such as a provider API key. */
    lookup(variable: string): string | undefined {
      return source[variable] || undefined;
    },
    resolveSecret(secret: Secret): string {
      if (typeof secret === "string") return secret;
      const value = source[secret.env];
      if (!value) throw new MissingSecretError(secret.env);
      return value;
    },
  };
}

export type Env = ReturnType<typeof createEnv>;
