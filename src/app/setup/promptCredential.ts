import { confirm, log, password, select, spinner, text } from "@clack/prompts";
import {
  loginWithOpenRouter,
  openBrowser,
  OpenRouterLoginError,
  type Env,
  type ProviderKind,
} from "#infra";
import type { ProviderType, Secret } from "#types";
import { assertNever } from "#util";
import { answer, required } from "./prompts.ts";

export type CredentialResult = {
  apiKey: Secret | undefined;
  /** Variables to write to credentials.env. */
  save: Readonly<Record<string, string>>;
};

export type CredentialRequest = {
  name: string;
  kind: ProviderKind<ProviderType>;
  current: Secret | undefined;
  env: Env;
  /** False when config.ts won't be rewritten, so the reference must stay as is. */
  canChangeReference: boolean;
};

type Method = "keep" | "login" | "paste" | "env" | "none";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Fixed providers use their conventional variable; others derive one from their name. */
export function apiKeyVariable(
  kind: ProviderKind<ProviderType>,
  name: string,
): string {
  if (kind.type !== "openai-compatible") return kind.apiKeyEnv;
  return `${name.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

function mask(value: string): string {
  return value.length > 8 ? `…${value.slice(-4)}` : "set";
}

function methodOptions(
  kind: ProviderKind<ProviderType>,
  existing: string | undefined,
  canChangeReference: boolean,
) {
  const options = [
    ...(existing
      ? [
          {
            value: "keep" as const,
            label: `Keep current key (${mask(existing)})`,
          },
        ]
      : []),
    ...(kind.type === "openrouter"
      ? [
          {
            value: "login" as const,
            label: "Log in with OpenRouter in the browser",
          },
        ]
      : []),
    {
      value: "paste" as const,
      label: "Paste an API key",
      hint: kind.apiKeyPageURL,
    },
    {
      value: "env" as const,
      label: "Read it from an environment variable I set myself",
    },
    ...(kind.type === "openai-compatible"
      ? [{ value: "none" as const, label: "No API key" }]
      : []),
  ];
  return canChangeReference
    ? options
    : options.filter(({ value }) => value !== "env" && value !== "none");
}

async function presentURL(url: string): Promise<void> {
  const opened = await openBrowser(url);
  log.info(
    opened
      ? `Opened your browser. If nothing appeared, visit:\n${url}`
      : `Open this URL in your browser:\n${url}`,
  );
}

/** Resolves to undefined when login fails, so the user can pick another method. */
async function loginOpenRouter(): Promise<string | undefined> {
  const progress = spinner();
  try {
    const key = await loginWithOpenRouter({
      presentAuthorizeURL: async (url) => {
        await presentURL(url);
        progress.start("Waiting for OpenRouter to authorize polymodel");
      },
    });
    progress.stop("Logged in to OpenRouter and created an API key");
    return key;
  } catch (error) {
    if (!(error instanceof OpenRouterLoginError)) throw error;
    progress.error(error.message);
    return undefined;
  }
}

async function pasteKey(kind: ProviderKind<ProviderType>): Promise<string> {
  if (
    kind.apiKeyPageURL &&
    (await answer(
      confirm({ message: `Open ${kind.apiKeyPageURL} to create a key?` }),
    ))
  ) {
    await presentURL(kind.apiKeyPageURL);
  }
  const key = await answer(
    password({ message: `${kind.label} API key`, validate: required }),
  );
  return key.trim();
}

async function chooseVariable(variable: string, env: Env): Promise<string> {
  const chosen = await answer(
    text({
      message: "Environment variable name",
      initialValue: variable,
      validate: (value) =>
        value && ENV_NAME.test(value) ? undefined : "Not a valid variable name",
    }),
  );
  if (!env.lookup(chosen)) {
    log.warn(
      `${chosen} isn't set right now. Background services (e.g. \`brew services\`) don't read your shell profile.`,
    );
  }
  return chosen;
}

export async function promptCredential(
  request: CredentialRequest,
): Promise<CredentialResult> {
  const { name, kind, current, env, canChangeReference } = request;
  const variable =
    typeof current === "object" ? current.env : apiKeyVariable(kind, name);
  const existing = typeof current === "string" ? current : env.lookup(variable);
  const method: Method = await answer(
    select({
      message: `How should polymodel authenticate to ${name}?`,
      options: methodOptions(kind, existing, canChangeReference),
    }),
  );
  switch (method) {
    case "keep":
      // Inline keys are moved into credentials.env so the config holds no secrets.
      return {
        apiKey: { env: variable },
        save: typeof current === "string" ? { [variable]: current } : {},
      };
    case "login": {
      const key = await loginOpenRouter();
      if (key === undefined) return promptCredential(request);
      return { apiKey: { env: variable }, save: { [variable]: key } };
    }
    case "paste":
      return {
        apiKey: { env: variable },
        save: { [variable]: await pasteKey(kind) },
      };
    case "env":
      return { apiKey: { env: await chooseVariable(variable, env) }, save: {} };
    case "none":
      return { apiKey: undefined, save: {} };
    default:
      return assertNever(method);
  }
}
