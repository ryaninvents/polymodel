import { select, text } from "@clack/prompts";
import { PROVIDER_CATALOG } from "#infra";
import type { ProviderConfig } from "#types";
import { answer, required } from "./prompts.ts";

export type ModelChoice = { id: string; planner: string; worker: string };

type Role = "planner" | "worker";
type Providers = Readonly<Record<string, ProviderConfig>>;

const OTHER = "\0other";
const ROLE_DESCRIPTION = {
  planner: "Planner (strong model that leads the work and delegates)",
  worker: "Worker (fast model that carries out delegated tasks)",
} as const satisfies Record<Role, string>;

function providerOf(reference: string): string {
  return reference.slice(0, Math.max(reference.indexOf(":"), 0));
}

function validateReference(providers: Providers) {
  return (value: string | undefined) => {
    const provider = providerOf(value ?? "");
    if (!provider || value!.length <= provider.length + 1)
      return 'Use "<provider>:<model>"';
    return provider in providers
      ? undefined
      : `Unknown provider; choose from ${Object.keys(providers).join(", ")}`;
  };
}

async function promptReference(
  role: Role,
  providers: Providers,
  previous: string | undefined,
): Promise<string> {
  const suggestions = Object.entries(providers).map(
    ([name, { type }]) =>
      `${name}:${PROVIDER_CATALOG[type].suggestedModels[role]}`,
  );
  const usablePrevious =
    previous && providerOf(previous) in providers ? [previous] : [];
  const references = [...new Set([...usablePrevious, ...suggestions])];
  const picked = await answer(
    select({
      message: ROLE_DESCRIPTION[role],
      options: [
        ...references.map((value) => ({ value, label: value })),
        { value: OTHER, label: "Other…" },
      ],
    }),
  );
  if (picked !== OTHER) return picked;
  return answer(
    text({
      message: `${role} model reference`,
      placeholder: references[0],
      validate: validateReference(providers),
    }),
  );
}

/** Asks for the default worker-bee polymodel's id and models. */
export async function promptModel(
  providers: Providers,
  previous: Partial<ModelChoice>,
): Promise<ModelChoice> {
  const id = await answer(
    text({
      message: "Model id clients will request",
      initialValue: previous.id ?? "worker-bee",
      validate: required,
    }),
  );
  return {
    id,
    planner: await promptReference("planner", providers, previous.planner),
    worker: await promptReference("worker", providers, previous.worker),
  };
}
