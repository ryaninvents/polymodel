import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { describeErrorChain } from "#util";
import {
  createInvalidPolymodelRequestError,
  type PolymodelService,
} from "#domain";
import {
  OpenAIChatRequestSchema,
  type OpenAIChatCompletionChunk,
} from "#types";
import { collectCompletion } from "./collectCompletion.ts";
import { encodeChunks, type ResponseMeta } from "./encodeChunks.ts";
import { hashPromptPrefix } from "./hashPromptPrefix.ts";
import { toHttpError } from "./toHttpError.ts";
import { toPolymodelRequest } from "./toPolymodelRequest.ts";

export type RouteDependencies = {
  service: PolymodelService;
  /** When set, every route except /health requires this bearer token. */
  apiKey: string | undefined;
  now?: () => number;
};

/**
 * Waits for the first event before committing to a 200 + SSE response, so
 * failures that happen immediately (bad config, upstream down) surface as real
 * HTTP errors that LiteLLM can retry or fall back on.
 */
async function startEvents<event>(
  source: AsyncIterable<event>,
): Promise<AsyncIterable<event>> {
  const iterator = source[Symbol.asyncIterator]();
  const first = await iterator.next();
  async function* resumed(): AsyncGenerator<event> {
    if (first.done) return;
    yield first.value;
    yield* { [Symbol.asyncIterator]: () => iterator };
  }
  return resumed();
}

async function* toServerSentEvents(
  chunks: AsyncIterable<OpenAIChatCompletionChunk>,
  log: FastifyBaseLogger,
): AsyncGenerator<string> {
  const startedAt = Date.now();
  let chunkCount = 0;
  try {
    for await (const chunk of chunks) {
      chunkCount += 1;
      yield `data: ${JSON.stringify(chunk)}\n\n`;
    }
    yield "data: [DONE]\n\n";
    log.debug(
      { chunks: chunkCount, streamMs: Date.now() - startedAt },
      "response stream finished",
    );
  } catch (error) {
    log.error(
      { err: error, causes: describeErrorChain(error) },
      "stream failed after headers were sent",
    );
    yield `data: ${JSON.stringify(toHttpError(error).body)}\n\n`;
  }
}

function readBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  const apiKey = request.headers["x-api-key"];
  return typeof apiKey === "string" ? apiKey : undefined;
}

export function registerRoutes(
  app: FastifyInstance,
  { service, apiKey, now = Date.now }: RouteDependencies,
) {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    // Fastify's own 4xx errors (malformed JSON, oversized body) keep their status.
    if (typeof statusCode === "number" && statusCode < 500) {
      const message = error instanceof Error ? error.message : "Bad request";
      return reply
        .status(statusCode)
        .send(toHttpError(createInvalidPolymodelRequestError(message)).body);
    }
    const http = toHttpError(error);
    if (http.status >= 500)
      request.log.error(
        { err: error, causes: describeErrorChain(error) },
        "request failed",
      );
    return reply.status(http.status).send(http.body);
  });

  if (apiKey) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/health" || readBearerToken(request) === apiKey)
        return;
      return reply.status(401).send({
        error: {
          message: "Invalid API key",
          type: "authentication_error",
          code: null,
          param: null,
        },
      });
    });
  }

  async function handleChatCompletion(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const parsed = OpenAIChatRequestSchema.safeParse(request.body);
    if (!parsed.success)
      throw createInvalidPolymodelRequestError(z.prettifyError(parsed.error));

    const { data } = parsed;
    request.log.debug(
      {
        ...(await hashPromptPrefix(data)),
        model: data.model,
        stream: data.stream ?? false,
        messages: data.messages.length,
        roles: data.messages.map((message) => message.role),
        tools: data.tools?.length ?? 0,
        toolChoice: data.tool_choice,
        maxTokens: data.max_tokens,
      },
      "chat completion request",
    );
    request.log.trace({ body: request.body }, "chat completion request body");

    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (reply.raw.writableFinished) return;
      request.log.debug("client disconnected before the response finished");
      abort.abort();
    });

    const meta: ResponseMeta = {
      id: `chatcmpl-${randomUUID()}`,
      created: Math.floor(now() / 1000),
      model: parsed.data.model,
    };
    const events = service.run(toPolymodelRequest(parsed.data), abort.signal);
    if (!parsed.data.stream) return collectCompletion(events, meta);

    const started = await startEvents(events);
    const includeUsage = parsed.data.stream_options?.include_usage ?? false;
    return reply
      .header("content-type", "text/event-stream; charset=utf-8")
      .header("cache-control", "no-cache")
      .header("x-accel-buffering", "no")
      .send(
        Readable.from(
          toServerSentEvents(
            encodeChunks(started, meta, { includeUsage }),
            request.log,
          ),
        ),
      );
  }

  function listModels() {
    return {
      object: "list",
      data: service.listModels().map(({ id }) => ({
        id,
        object: "model",
        created: 0,
        owned_by: "polymodel",
      })),
    };
  }

  app.get("/health", async () => ({ status: "ok" }));
  // LiteLLM and other clients disagree on whether api_base includes /v1, so accept both.
  for (const prefix of ["/v1", ""]) {
    app.get(`${prefix}/models`, async () => listModels());
    app.post(`${prefix}/chat/completions`, handleChatCompletion);
  }
}
