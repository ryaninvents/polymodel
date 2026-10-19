import { describe, expect, it, vi } from "vitest";
import { loginWithOpenRouter } from "./openRouterLogin.ts";

function redirectBack(params: (authorize: URL) => Record<string, string>) {
  return async (url: string) => {
    const authorize = new URL(url);
    const callback = new URL(authorize.searchParams.get("callback_url")!);
    callback.search = new URLSearchParams(params(authorize)).toString();
    await fetch(callback);
  };
}

function keyExchange(response: Response) {
  return vi.fn<typeof fetch>(async () => response);
}

describe("loginWithOpenRouter", () => {
  it("exchanges the callback code for a key using the PKCE verifier", async () => {
    const exchange = keyExchange(Response.json({ key: "sk-or-test" }));
    const key = await loginWithOpenRouter({
      fetch: exchange,
      presentAuthorizeURL: redirectBack((authorize) => ({
        code: "auth-code",
        state: authorize.searchParams.get("state")!,
      })),
    });

    expect(key).toBe("sk-or-test");
    const [url, init] = exchange.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      code: "auth-code",
      code_challenge_method: "S256",
    });
    expect(body.code_verifier).toMatch(/^[\w-]{43}$/);
  });

  it("rejects a callback with the wrong state", async () => {
    const exchange = keyExchange(Response.json({ key: "unused" }));
    await expect(
      loginWithOpenRouter({
        fetch: exchange,
        presentAuthorizeURL: redirectBack(() => ({
          code: "auth-code",
          state: "forged",
        })),
      }),
    ).rejects.toThrow(/state mismatch/);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("surfaces a rejected exchange", async () => {
    await expect(
      loginWithOpenRouter({
        fetch: keyExchange(new Response("bad code", { status: 403 })),
        presentAuthorizeURL: redirectBack((authorize) => ({
          code: "auth-code",
          state: authorize.searchParams.get("state")!,
        })),
      }),
    ).rejects.toThrow(/HTTP 403/);
  });
});
