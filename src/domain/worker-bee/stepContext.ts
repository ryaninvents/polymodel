import type { PolymodelContext, PolymodelRequest } from "#types";
import type { ResolvedWorkerBeeOptions } from "./options.ts";
import type { TurnSession } from "./turnSession.ts";

export type StepContext = {
  key: string;
  request: PolymodelRequest;
  context: PolymodelContext;
  options: ResolvedWorkerBeeOptions;
  turn: TurnSession;
};
