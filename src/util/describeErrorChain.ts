export type ErrorDescription = {
  name: string;
  message: string;
  details: Readonly<Record<string, unknown>>;
};

// Provider SDK errors (AI SDK, fetch wrappers) carry the useful diagnosis in
// these fields, which pino's default error serializer drops for `cause`.
const DETAIL_KEYS = [
  "code",
  "type",
  "statusCode",
  "status",
  "isRetryable",
  "url",
  "responseBody",
  "data",
] as const;

const MAX_DETAIL_CHARS = 4000;
const MAX_CHAIN_DEPTH = 8;

function bound(value: unknown): unknown {
  const text =
    typeof value === "string" ? value : (safeStringify(value) ?? undefined);
  if (text === undefined || text.length <= MAX_DETAIL_CHARS) return value;
  return `${text.slice(0, MAX_DETAIL_CHARS)}… (${text.length} chars)`;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return typeof value === "object" ? JSON.stringify(value) : undefined;
  } catch {
    return undefined;
  }
}

function describeOne(error: unknown): ErrorDescription {
  if (!(error instanceof Error))
    return { name: typeof error, message: String(error), details: {} };
  const record = error as unknown as Record<string, unknown>;
  const details = Object.fromEntries(
    DETAIL_KEYS.filter((key) => record[key] !== undefined).map((key) => [
      key,
      bound(record[key]),
    ]),
  );
  return { name: error.name, message: error.message, details };
}

/** Flattens an error and its `cause` chain, outermost first. */
export function describeErrorChain(
  error: unknown,
): ReadonlyArray<ErrorDescription> {
  const chain: Array<ErrorDescription> = [];
  let current: unknown = error;
  while (chain.length < MAX_CHAIN_DEPTH && current !== undefined) {
    chain.push(describeOne(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}
