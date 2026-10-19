import { isCancel } from "@clack/prompts";

export class SetupCancelledError extends Error {
  readonly code = "SETUP_CANCELLED" as const;
  constructor() {
    super("Setup cancelled; nothing was written");
    this.name = "SetupCancelledError";
  }
}

/** Unwraps a clack prompt, turning Ctrl-C into an error so callers stay linear. */
export async function answer<value>(
  prompt: Promise<value>,
): Promise<Exclude<value, symbol>> {
  const result = await prompt;
  if (isCancel(result)) throw new SetupCancelledError();
  return result as Exclude<value, symbol>;
}

export function required(value: string | undefined): string | undefined {
  return value?.trim() ? undefined : "Required";
}
