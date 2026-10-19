import { fastify } from "fastify";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createPolymodelService, workerBee } from "#domain";
import {
  createMapStateStore,
  createMockModel,
  textResponse,
  toolCallResponse,
} from "../domain/testing/mockModels.ts";
import { registerRoutes } from "./registerRoutes.ts";

type Models = Record<string, MockLanguageModelV4>;

function createTestApp(models: Models, apiKey?: string) {
  const app = fastify();
  const service = createPolymodelService({
    models: {
      "opus-haiku": workerBee({ planner: "p:big", worker: "p:small" }),
    },
    resolveModel: (reference) => {
      const model = models[reference];
      if (!model) throw new Error(`no mock for ${reference}`);
      return model;
    },
    createStateStore: () => createMapStateStore(),
    logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
  });
  registerRoutes(app, { service, apiKey, now: () => 1_700_000_000_000 });
  return app;
}

function chatBody(overrides: object = {}) {
  return {
    model: "opus-haiku",
    messages: [
      { role: "system", content: "Be terse." },
      { role: "user", content: "Hi" },
    ],
    ...overrides,
  };
}

function parseSse(payload: string): Array<unknown> {
  return payload
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .map((data) => (data === "[DONE]" ? data : JSON.parse(data)));
}

describe("POST /v1/chat/completions", () => {
  it("streams the planner's answer as one message", async () => {
    const app = createTestApp({
      "p:big": createMockModel([textResponse("Hello!")]),
      "p:small": createMockModel([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody({
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const events = parseSse(response.body);
    expect(events.at(-1)).toBe("[DONE]");
    const chunks = events.slice(0, -1) as Array<{
      id: string;
      model: string;
      choices: Array<{ delta: object; finish_reason: string | null }>;
      usage?: { total_tokens: number };
    }>;
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
    expect(chunks.every((chunk) => chunk.model === "opus-haiku")).toBe(true);
    expect(chunks.map((chunk) => chunk.choices[0]?.delta)).toEqual([
      { role: "assistant", content: "" },
      { content: "Hello!" },
      {},
      undefined,
    ]);
    expect(chunks.at(-2)?.choices[0]?.finish_reason).toBe("stop");
    expect(chunks.at(-1)?.usage?.total_tokens).toBe(15);
  });

  it("returns planner tool calls in a non-streaming response", async () => {
    const app = createTestApp({
      "p:big": createMockModel([
        toolCallResponse("call_1", "bash", { cmd: "ls" }),
      ]),
      "p:small": createMockModel([]),
    });

    const response = await app.inject({
      method: "POST",
      url: "/chat/completions",
      payload: chatBody({
        tools: [
          {
            type: "function",
            function: { name: "bash", parameters: { type: "object" } },
          },
        ],
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().choices[0]).toMatchObject({
      finish_reason: "tool_calls",
      message: {
        content: null,
        tool_calls: [
          {
            id: "call_1",
            function: { name: "bash", arguments: '{"cmd":"ls"}' },
          },
        ],
      },
    });
  });

  it("reports upstream failures before streaming as HTTP errors", async () => {
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("connection refused");
      },
    });
    const app = createTestApp({ "p:big": failing, "p:small": failing });

    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody({ stream: true }),
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.message).toContain("connection refused");
  });

  it("rejects unknown models and malformed requests", async () => {
    const app = createTestApp({});
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: chatBody({ model: "nope" }),
    });
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "opus-haiku", messages: [] },
    });

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("model_not_found");
    expect(malformed.statusCode).toBe(400);
  });

  it("requires the API key when one is configured", async () => {
    const app = createTestApp({}, "secret");
    const denied = await app.inject({ method: "GET", url: "/v1/models" });
    const allowed = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer secret" },
    });
    const health = await app.inject({ method: "GET", url: "/health" });

    expect(denied.statusCode).toBe(401);
    expect(allowed.json().data).toEqual([
      { id: "opus-haiku", object: "model", created: 0, owned_by: "polymodel" },
    ]);
    expect(health.statusCode).toBe(200);
  });
});
