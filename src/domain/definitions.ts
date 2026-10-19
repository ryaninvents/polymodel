import type { Polymodel, PolymodelConfigInput } from "#types";

/** Identity helper that gives plugin authors type-checking and inference. */
export function definePolymodel<polymodel extends Polymodel>(
  polymodel: polymodel,
): polymodel {
  return polymodel;
}

/** Identity helper for `export default defineConfig({...})` in a config file. */
export function defineConfig(
  config: PolymodelConfigInput,
): PolymodelConfigInput {
  return config;
}
