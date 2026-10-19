import type { ModelMessage } from "ai";
import type { DelegationReport, WorkerBrief } from "#types";
import type { z } from "zod";
import { RECOVERED_TASK_GOAL } from "./prompts.ts";
import { stretchOf } from "./ownership.ts";

const FILE_EDITING_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "apply_patch",
]);
const MAX_OUTPUT_LINES = 20;
const MAX_CALL_CHARS = 200;

export function renderBrief(brief: WorkerBrief): string {
  return [
    `Goal: ${brief.goal}`,
    `Context: ${brief.context}`,
    `Files: ${brief.files.length > 0 ? brief.files.join(", ") : "none (read-only)"}`,
    `Decisions (already made, do not revisit): ${brief.decisions}`,
    `Done when: ${brief.done_when}`,
    ...(brief.out_of_scope ? [`Out of scope: ${brief.out_of_scope}`] : []),
  ].join("\n\n");
}

/** Stands in for a brief lost with the server's state. */
export function recoveredBrief(): WorkerBrief {
  return {
    goal: RECOVERED_TASK_GOAL,
    context: "",
    files: [],
    decisions: "",
    done_when: "The task shown in your previous tool calls is complete.",
  };
}

/** Deterministic: collapsed stretches must replay to the same bytes for prompt caching. */
export function renderReport(report: DelegationReport): string {
  return [
    `status: ${report.status}`,
    `summary: ${report.summary}`,
    `files_changed: ${report.files_changed.join(", ") || "none"}`,
    ...(report.notes ? [`notes: ${report.notes}`] : []),
  ].join("\n");
}

export function formatBriefIssues(error: z.ZodError): string {
  const fields = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return `Invalid brief, nothing was delegated. Fix these fields: ${fields}`;
}

function changedFiles(stretch: ReadonlyArray<ModelMessage>): Array<string> {
  const files = new Set<string>();
  for (const message of stretch) {
    if (message.role !== "assistant" || typeof message.content === "string")
      continue;
    for (const part of message.content) {
      if (
        part.type !== "tool-call" ||
        !FILE_EDITING_TOOLS.has(part.toolName.toLowerCase())
      )
        continue;
      const input = part.input as Record<string, unknown> | null;
      const path = input?.path ?? input?.file_path ?? input?.filePath;
      if (typeof path === "string") files.add(path);
    }
  }
  return [...files];
}

function describeOutput(output: { type: string; value?: unknown }): string {
  return typeof output.value === "string"
    ? output.value
    : JSON.stringify(output.value ?? output.type);
}

function lastCallNote(
  stretch: ReadonlyArray<ModelMessage>,
): string | undefined {
  const call = stretch
    .flatMap((message) =>
      message.role === "assistant" && typeof message.content !== "string"
        ? message.content
        : [],
    )
    .findLast((part) => part.type === "tool-call");
  if (call?.type !== "tool-call") return undefined;
  const result = stretch
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .findLast(
      (part) =>
        part.type === "tool-result" && part.toolCallId === call.toolCallId,
    );
  const input = JSON.stringify(call.input).slice(0, MAX_CALL_CHARS);
  const output =
    result?.type === "tool-result"
      ? describeOutput(result.output)
          .split("\n")
          .slice(0, MAX_OUTPUT_LINES)
          .join("\n")
      : "(no result)";
  return `Last tool call: ${call.toolName}(${input}) → ${output}`;
}

/** Built by polymodel, not the model: the worker never got to say anything useful. */
export function syntheticReport(
  status: "exhausted" | "failed",
  summary: string,
  messages: ReadonlyArray<ModelMessage>,
  taskId: string,
): DelegationReport {
  const stretch = stretchOf(messages, taskId);
  const notes = lastCallNote(stretch);
  return {
    status,
    summary,
    files_changed: changedFiles(stretch),
    ...(notes && { notes }),
  };
}
