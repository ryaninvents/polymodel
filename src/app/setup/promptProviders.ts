import { log, multiselect, text } from "@clack/prompts";
import {
  PROVIDER_CATALOG,
  PROVIDER_TYPES,
  type Env,
  type ProviderKind,
} from "#infra";
import type { ProviderConfig, ProviderType } from "#types";
import { promptCredential } from "./promptCredential.ts";
import { answer, required } from "./prompts.ts";

export type ConfiguredProvider = {
  name: string;
  config: ProviderConfig;
  save: Readonly<Record<string, string>>;
};

type Choice =
  | { status: "existing"; name: string; config: ProviderConfig }
  | { status: "new"; type: ProviderType };

const DEFAULT_COMPATIBLE_BASE_URL = "http://127.0.0.1:4000/v1";
const PROVIDER_NAME = /^[A-Za-z0-9_-]+$/;

function choiceKey(choice: Choice): string {
  return choice.status === "existing"
    ? `existing:${choice.name}`
    : `new:${choice.type}`;
}

function listChoices(
  existing: Readonly<Record<string, ProviderConfig>>,
): Array<Choice> {
  const configured = Object.entries(existing).map(([name, config]): Choice => ({
    status: "existing",
    name,
    config,
  }));
  const usedTypes = new Set(Object.values(existing).map(({ type }) => type));
  // Several OpenAI-compatible endpoints can coexist, so it's always offered.
  const additions = PROVIDER_TYPES.filter(
    (type) => type === "openai-compatible" || !usedTypes.has(type),
  ).map((type): Choice => ({ status: "new", type }));
  return [...configured, ...additions];
}

function choiceLabel(choice: Choice): string {
  if (choice.status === "new") return PROVIDER_CATALOG[choice.type].label;
  return `${choice.name} (${PROVIDER_CATALOG[choice.config.type].label}, configured)`;
}

async function promptName(
  kind: ProviderKind<ProviderType>,
  taken: ReadonlySet<string>,
): Promise<string> {
  if (kind.type !== "openai-compatible" && !taken.has(kind.defaultName))
    return kind.defaultName;
  return answer(
    text({
      message: `Name for this ${kind.label} provider (used as "<name>:<model>")`,
      initialValue: taken.has(kind.defaultName) ? "" : kind.defaultName,
      validate: (value) => {
        if (!value || !PROVIDER_NAME.test(value))
          return "Use letters, digits, - and _";
        return taken.has(value) ? "Already in use" : undefined;
      },
    }),
  );
}

async function promptBaseURL(current: string | undefined): Promise<string> {
  return answer(
    text({
      message: "Base URL (including /v1)",
      initialValue: current ?? DEFAULT_COMPATIBLE_BASE_URL,
      validate: (value) =>
        required(value) ?? (URL.canParse(value!) ? undefined : "Not a URL"),
    }),
  );
}

async function configureChoice(
  choice: Choice,
  taken: ReadonlySet<string>,
  env: Env,
): Promise<ConfiguredProvider> {
  const current = choice.status === "existing" ? choice.config : undefined;
  const type = choice.status === "existing" ? choice.config.type : choice.type;
  const kind: ProviderKind<ProviderType> = PROVIDER_CATALOG[type];
  const name =
    choice.status === "existing" ? choice.name : await promptName(kind, taken);
  log.step(`${name}: ${kind.label}`);
  const baseURL =
    type === "openai-compatible"
      ? await promptBaseURL(current?.baseURL)
      : current?.baseURL;
  const { apiKey, save } = await promptCredential({
    name,
    kind,
    current: current?.apiKey,
    env,
    canChangeReference: true,
  });
  const config: ProviderConfig =
    type === "openai-compatible"
      ? {
          type,
          baseURL: baseURL!,
          apiKey,
          headers: current?.type === type ? current.headers : undefined,
        }
      : { type, baseURL, apiKey };
  return { name, config, save };
}

/** Asks which providers to use (at least one) and how to authenticate to each. */
export async function promptProviders(
  existing: Readonly<Record<string, ProviderConfig>>,
  env: Env,
): Promise<Array<ConfiguredProvider>> {
  const choices = listChoices(existing);
  const selected = await answer(
    multiselect({
      message: "Which providers should polymodel use?",
      options: choices.map((choice) => ({
        value: choiceKey(choice),
        label: choiceLabel(choice),
      })),
      initialValues: choices
        .filter(({ status }) => status === "existing")
        .map(choiceKey),
      required: true,
    }),
  );
  const providers: Array<ConfiguredProvider> = [];
  for (const choice of choices.filter((c) => selected.includes(choiceKey(c)))) {
    const taken = new Set([
      ...Object.keys(existing),
      ...providers.map(({ name }) => name),
    ]);
    providers.push(await configureChoice(choice, taken, env));
  }
  return providers;
}
