/**
 * The browser's only door to the server. Responses are validated against the
 * shared contract before the UI sees them, and the 429 fallback is treated as an
 * answer, because the server still sends something useful with it.
 */
import {
  aiContracts,
  aiEnvelopeMeta,
  type AiEnvelope,
  type AiFeatureName,
  type AiInput,
} from "../../shared/contracts";

export class AiRequestError extends Error {
  override readonly name = "AiRequestError";
}

/** Send the request. A cancellation passes through untouched, so callers can ignore it. */
async function post(path: string, input: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AiRequestError("Could not reach Vayu. Check your connection and try again.");
  }
}

/** A 429 still carries the offline planner's answer, so only other failures throw. */
function assertUsable(response: Response): void {
  if (response.ok || response.status === 429) return;
  throw new AiRequestError(
    response.status === 400
      ? "Vayu could not read that. Check the details and try again."
      : "Vayu ran into a problem. Please try again.",
  );
}

/**
 * Check the envelope and the feature's own output separately, so each schema
 * keeps its exact type.
 */
async function readEnvelope<F extends AiFeatureName>(
  feature: F,
  response: Response,
): Promise<AiEnvelope<F>> {
  const body: unknown = await response.json().catch(() => null);
  const meta = aiEnvelopeMeta.safeParse(body);
  const data = aiContracts[feature].output.safeParse((body as { data?: unknown } | null)?.data);
  if (!meta.success || !data.success) {
    throw new AiRequestError("Vayu sent an unexpected reply. Please try again.");
  }
  return { ...meta.data, data: data.data } as AiEnvelope<F>;
}

export async function callAi<F extends AiFeatureName>(
  feature: F,
  input: AiInput<F>,
  signal?: AbortSignal,
): Promise<AiEnvelope<F>> {
  const response = await post(`/api/ai/${feature}`, input, signal);
  assertUsable(response);
  return readEnvelope(feature, response);
}
