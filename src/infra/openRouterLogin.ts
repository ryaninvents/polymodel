import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";

const AUTHORIZE_URL = "https://openrouter.ai/auth";
const KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
// OpenRouter's authorization codes expire after 10 minutes.
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const KeyExchangeResponseSchema = z.object({ key: z.string().min(1) });

export class OpenRouterLoginError extends Error {
  readonly code = "OPENROUTER_LOGIN_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterLoginError";
  }
}

export type OpenRouterLoginOptions = {
  /** Shows the authorization URL to the user (open a browser, print it, …). */
  presentAuthorizeURL: (url: string) => Promise<void> | void;
  keyLabel?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

type Callback = { code: string; state: string };

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
}

function waitForCallback(server: Server, timeoutMs: number): Promise<Callback> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new OpenRouterLoginError("Timed out waiting for login")),
      timeoutMs,
    );
    timer.unref();
    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const code = url.searchParams.get("code");
      if (url.pathname !== "/callback" || !code) {
        response.writeHead(404).end();
        return;
      }
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(
          "<!doctype html><title>Polymodel</title><p>Logged in to OpenRouter. You can close this tab and return to the terminal.</p>",
        );
      clearTimeout(timer);
      resolve({ code, state: url.searchParams.get("state") ?? "" });
    });
  });
}

async function exchangeCode(
  fetchImpl: typeof fetch,
  code: string,
  verifier: string,
): Promise<string> {
  const response = await fetchImpl(KEY_EXCHANGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: "S256",
    }),
  });
  if (!response.ok) {
    throw new OpenRouterLoginError(
      `OpenRouter rejected the login (HTTP ${response.status}): ${await response.text()}`,
    );
  }
  const parsed = KeyExchangeResponseSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new OpenRouterLoginError("OpenRouter returned no API key");
  return parsed.data.key;
}

/**
 * OpenRouter's OAuth PKCE flow, which mints a regular API key. No AI SDK
 * package implements it, so it lives here. A loopback server receives the
 * redirect; see https://openrouter.ai/docs/guides/overview/auth/oauth.
 */
export async function loginWithOpenRouter({
  presentAuthorizeURL,
  keyLabel = "polymodel",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetch: fetchImpl = fetch,
}: OpenRouterLoginOptions): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const server = createServer();
  try {
    const port = await listen(server);
    const authorizeURL = new URL(AUTHORIZE_URL);
    authorizeURL.search = new URLSearchParams({
      callback_url: `http://localhost:${port}/callback`,
      code_challenge: challenge,
      code_challenge_method: "S256",
      key_label: keyLabel,
      state,
    }).toString();
    const callback = waitForCallback(server, timeoutMs);
    // Awaited below; this only keeps a failure in presentAuthorizeURL from
    // also surfacing the pending timeout as an unhandled rejection.
    callback.catch(() => undefined);
    await presentAuthorizeURL(authorizeURL.href);
    const { code, state: returnedState } = await callback;
    if (returnedState !== state)
      throw new OpenRouterLoginError("Login state mismatch; try again");
    return await exchangeCode(fetchImpl, code, verifier);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
