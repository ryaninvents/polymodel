import type { LanguageModel } from "ai";
import { fastify, type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { registerRoutes } from "#controller";
import { createMemoryStore } from "#data";
import { createPolymodelService } from "#domain";
import {
  createEnv,
  createLogger,
  createModelResolver,
  findConfigFile,
  loadConfigFile,
  parseConfig,
  registerPackageAlias,
  type Env,
  type Logger,
} from "#infra";
import type { PolymodelConfig } from "#types";
import { createDefaultConfig } from "./defaultConfig.ts";

export type PolymodelServerOptions = {
  config: PolymodelConfig;
  env: Env;
  logger: Logger;
  /** Overrides upstream model resolution (tests, embedding). */
  resolveModel?: (reference: string) => LanguageModel;
};

// Long agent conversations (and inline images) easily exceed Fastify's 1 MiB default.
const BODY_LIMIT_BYTES = 64 * 1024 * 1024;

export function createPolymodelServer({
  config,
  env,
  logger,
  resolveModel,
}: PolymodelServerOptions): FastifyInstance {
  // Widen pino's logger type so the app is a plain FastifyInstance.
  const loggerInstance: FastifyBaseLogger = logger;
  const app = fastify({ loggerInstance, bodyLimit: BODY_LIMIT_BYTES });
  const service = createPolymodelService({
    models: config.models,
    resolveModel: resolveModel ?? createModelResolver(config.providers, env),
    createStateStore: () => createMemoryStore(config.state),
    logger,
  });
  registerRoutes(app, {
    service,
    apiKey:
      config.server.apiKey === undefined
        ? undefined
        : env.resolveSecret(config.server.apiKey),
  });
  return app;
}

export type LoadedConfig = {
  config: PolymodelConfig;
  source: string;
  env: Env;
  logger: Logger;
};

export async function loadPolymodelConfig(
  configPath?: string,
): Promise<LoadedConfig> {
  const env = createEnv(process.env);
  const logger = createLogger(env.values.POLYMODEL_LOG_LEVEL);
  registerPackageAlias();
  const path = findConfigFile(env, configPath);
  const config = path
    ? await loadConfigFile(path)
    : parseConfig(createDefaultConfig(env), "(built-in default)");
  return { config, source: path ?? "(built-in default)", env, logger };
}

export type StartOptions = {
  configPath?: string;
  host?: string;
  port?: number;
};

export async function startPolymodel({
  configPath,
  host,
  port,
}: StartOptions = {}): Promise<FastifyInstance> {
  const { config, source, env, logger } = await loadPolymodelConfig(configPath);
  const app = createPolymodelServer({ config, env, logger });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logger.info({ signal }, "shutting down");
      void app.close();
    });
  }

  await app.listen({
    host: host ?? env.values.POLYMODEL_HOST ?? config.server.host,
    port: port ?? env.values.POLYMODEL_PORT ?? config.server.port,
  });
  logger.info(
    { config: source, models: Object.keys(config.models) },
    "polymodel ready",
  );
  return app;
}
