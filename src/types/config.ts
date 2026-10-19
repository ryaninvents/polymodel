import { z } from "zod";
import type { Polymodel } from "./polymodel.ts";

export const SecretSchema = z.union([
  z.string(),
  z
    .object({ env: z.string().min(1) })
    .describe("Read the value from this environment variable"),
]);

export const PromptCachingSchema = z
  .union([z.literal(false), z.object({ ttl: z.enum(["5m", "1h"]) })])
  .optional()
  .describe(
    "Anthropic prompt caching. On with a 5 minute TTL by default; false turns it off",
  );

export const ProviderConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("openai-compatible"),
    baseURL: z.url(),
    apiKey: SecretSchema.optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("anthropic"),
    baseURL: z.url().optional(),
    apiKey: SecretSchema.optional(),
    promptCaching: PromptCachingSchema,
  }),
  z.object({
    type: z.literal("openai"),
    baseURL: z.url().optional(),
    apiKey: SecretSchema.optional(),
  }),
  z.object({
    type: z.literal("openrouter"),
    baseURL: z.url().optional(),
    apiKey: SecretSchema.optional(),
    promptCaching: PromptCachingSchema,
  }),
]);

const PolymodelSchema = z.custom<Polymodel>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { run?: unknown }).run === "function",
  { message: "Expected a polymodel (an object with a run() function)" },
);

export const PolymodelConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(0).max(65535).default(4100),
      /** When set, clients must send `Authorization: Bearer <apiKey>`. */
      apiKey: SecretSchema.optional(),
    })
    .prefault({}),
  state: z
    .object({
      ttlMs: z
        .number()
        .int()
        .positive()
        .default(6 * 60 * 60 * 1000),
      maxEntries: z.number().int().positive().default(1000),
    })
    .prefault({}),
  providers: z.record(z.string().min(1), ProviderConfigSchema),
  models: z
    .record(z.string().min(1), PolymodelSchema)
    .refine(
      (models) => Object.keys(models).length > 0,
      "Define at least one model",
    ),
});

export type Secret = z.infer<typeof SecretSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProviderType = ProviderConfig["type"];
/** What users write in their config file. */
export type PolymodelConfigInput = z.input<typeof PolymodelConfigSchema>;
/** The config after defaults are applied. */
export type PolymodelConfig = z.output<typeof PolymodelConfigSchema>;
