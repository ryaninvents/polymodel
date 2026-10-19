import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { cancel, intro, log, note, outro, select } from "@clack/prompts";
import { PROVIDER_CATALOG, writeCredentialsFile, type Env } from "#infra";
import type { PolymodelConfig, ProviderConfig } from "#types";
import { assertNever } from "#util";
import {
  detectInstall,
  readModelDefaults,
  type Install,
} from "./existingInstall.ts";
import { promptCredential } from "./promptCredential.ts";
import { promptModel } from "./promptModel.ts";
import { promptProviders } from "./promptProviders.ts";
import { answer, SetupCancelledError } from "./prompts.ts";
import { renderConfig } from "./renderConfig.ts";

export type SetupOptions = { env: Env; configPath?: string };

type Plan = {
  credentials: Readonly<Record<string, string>>;
  /** Undefined when config.ts is left untouched. */
  config: string | undefined;
};

const DEFAULT_SERVER: PolymodelConfig["server"] = {
  host: "127.0.0.1",
  port: 4100,
};

function describeInstall({ configPath, existing }: Install): void {
  switch (existing.status) {
    case "missing":
      return log.info(`No config yet; setup will create ${configPath}`);
    case "loaded":
      return log.info(`Updating the existing config at ${configPath}`);
    case "invalid":
      return log.warn(
        `${configPath} exists but doesn't load, so setup will replace it (a backup is kept):\n${existing.error.message}`,
      );
    default:
      return assertNever(existing);
  }
}

async function chooseScope(install: Install): Promise<"full" | "credentials"> {
  if (install.existing.status !== "loaded") return "full";
  return answer(
    select({
      message: "What do you want to update?",
      options: [
        {
          value: "full" as const,
          label: "Providers, credentials, and models",
          hint: "rewrites the config; the old one is kept as .bak",
        },
        {
          value: "credentials" as const,
          label: "Credentials only",
          hint: "leaves the config file untouched",
        },
      ],
    }),
  );
}

async function planCredentialUpdate(
  providers: Readonly<Record<string, ProviderConfig>>,
  install: Install,
  env: Env,
): Promise<Plan> {
  let credentials = { ...install.credentials };
  for (const [name, config] of Object.entries(providers)) {
    if (typeof config.apiKey !== "object") {
      log.info(
        `${name}: key is ${config.apiKey ? "inline in the config" : "not configured"}; skipping`,
      );
      continue;
    }
    const { save } = await promptCredential({
      name,
      kind: PROVIDER_CATALOG[config.type],
      current: config.apiKey,
      env,
      canChangeReference: false,
    });
    credentials = { ...credentials, ...save };
  }
  return { credentials, config: undefined };
}

async function planFullSetup(install: Install, env: Env): Promise<Plan> {
  const loaded =
    install.existing.status === "loaded" ? install.existing : undefined;
  const configured = await promptProviders(loaded?.config.providers ?? {}, env);
  const providers = Object.fromEntries(
    configured.map(({ name, config }) => [name, config]),
  );
  const model = await promptModel(
    providers,
    loaded ? readModelDefaults(loaded.source) : {},
  );
  return {
    credentials: Object.assign(
      {},
      install.credentials,
      ...configured.map(({ save }) => save),
    ),
    config: renderConfig({
      server: loaded?.config.server ?? DEFAULT_SERVER,
      providers,
      model,
    }),
  };
}

function applyPlan(install: Install, plan: Plan): Array<string> {
  const written: Array<string> = [];
  if (!isDeepStrictEqual(plan.credentials, install.credentials)) {
    writeCredentialsFile(install.credentialsPath, plan.credentials);
    written.push(install.credentialsPath);
  }
  if (plan.config !== undefined) {
    if (existsSync(install.configPath)) {
      copyFileSync(install.configPath, `${install.configPath}.bak`);
      written.push(`${install.configPath}.bak`);
    }
    mkdirSync(dirname(install.configPath), { recursive: true });
    writeFileSync(install.configPath, plan.config);
    written.push(install.configPath);
  }
  return written;
}

const NEXT_STEPS = `polymodel models           # check the config loads
polymodel                  # serve http://127.0.0.1:4100/v1
brew services restart polymodel   # if it runs as a Homebrew service`;

/**
 * Interactive first-time setup and later updates. Nothing is written until
 * every prompt is answered, so cancelling leaves the install as it was.
 */
export async function runSetup({
  env,
  configPath,
}: SetupOptions): Promise<void> {
  intro("polymodel setup");
  try {
    const install = await detectInstall(env, configPath);
    describeInstall(install);
    const scope = await chooseScope(install);
    const plan =
      scope === "credentials" && install.existing.status === "loaded"
        ? await planCredentialUpdate(
            install.existing.config.providers,
            install,
            env,
          )
        : await planFullSetup(install, env);
    const written = applyPlan(install, plan);
    log.success(
      written.length ? `Wrote:\n${written.join("\n")}` : "Nothing to change",
    );
    note(NEXT_STEPS, "Next");
    outro("Done");
  } catch (error) {
    if (!(error instanceof SetupCancelledError)) throw error;
    cancel(error.message);
    process.exitCode = 130;
  }
}
