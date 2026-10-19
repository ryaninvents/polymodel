import { jsonSchema, type ToolSet } from "ai";
import { z } from "zod";
import { WorkerBriefSchema, WorkerReportSchema } from "#types";
import {
  REPORT_BACK_TOOL_DESCRIPTION,
  REPORT_BACK_TOOL_NAME,
  WORKER_BEE_TOOL_DESCRIPTION,
  WORKER_BEE_TOOL_NAME,
} from "./prompts.ts";

// Zod emits draft 2020-12; the AI SDK types are draft-07, which is compatible for these flat objects.
function toJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, {
    target: "draft-7",
  }) as Parameters<typeof jsonSchema>[0];
}

/**
 * Virtual tools have no `execute` and are never forwarded to the client:
 * polymodel intercepts the calls. They are declared to the model like any
 * other tool because providers reject histories that reference undeclared ones.
 */
export const workerBeeTools = {
  [WORKER_BEE_TOOL_NAME]: {
    description: WORKER_BEE_TOOL_DESCRIPTION,
    inputSchema: jsonSchema(toJsonSchema(WorkerBriefSchema)),
  },
} satisfies ToolSet;

export const reportBackTools = {
  [REPORT_BACK_TOOL_NAME]: {
    description: REPORT_BACK_TOOL_DESCRIPTION,
    inputSchema: jsonSchema(toJsonSchema(WorkerReportSchema)),
  },
} satisfies ToolSet;
