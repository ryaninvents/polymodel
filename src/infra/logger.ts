import { pino } from "pino";
import type { PolymodelEnvValues } from "./env.ts";

export function createLogger(level: PolymodelEnvValues["POLYMODEL_LOG_LEVEL"]) {
  return pino({ level, base: { name: "polymodel" } });
}

export type Logger = ReturnType<typeof createLogger>;
