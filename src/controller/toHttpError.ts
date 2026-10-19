import { APICallError } from "ai";
import {
  InvalidPolymodelRequestError,
  PolymodelRunError,
  UnknownPolymodelError,
} from "#domain";
import type { OpenAIErrorBody } from "#types";

export type HttpError = { status: number; body: OpenAIErrorBody };

function errorBody(
  message: string,
  type: string,
  code: string | null = null,
): OpenAIErrorBody {
  return { error: { message, type, code, param: null } };
}

function upstreamStatus(cause: unknown): number {
  // Preserve rate limiting so LiteLLM can apply its own retry/fallback policy.
  if (APICallError.isInstance(cause) && cause.statusCode === 429) return 429;
  return 502;
}

/** Translates domain errors into OpenAI-style HTTP errors. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof InvalidPolymodelRequestError) {
    return {
      status: 400,
      body: errorBody(error.message, "invalid_request_error"),
    };
  }
  if (error instanceof UnknownPolymodelError) {
    return {
      status: 404,
      body: errorBody(
        error.message,
        "invalid_request_error",
        "model_not_found",
      ),
    };
  }
  if (error instanceof PolymodelRunError) {
    return {
      status: upstreamStatus(error.cause),
      body: errorBody(error.message, "upstream_error"),
    };
  }
  return {
    status: 500,
    body: errorBody("Internal server error", "server_error"),
  };
}
