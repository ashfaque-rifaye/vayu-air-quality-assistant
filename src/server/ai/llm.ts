/**
 * LLM client with layered failover.
 *
 *   provider chain   Gemini -> Fireworks        (different credentials and quota)
 *     model chain    primary -> fallback -> reserve (same provider, different model)
 *       retry        one short, jittered retry of a model that answered 5xx (busy)
 *
 * The `parse` callback runs inside the chain, so output that fails schema
 * validation counts as a failed attempt and moves on to the next model, rather
 * than dropping straight to the offline planner.
 *
 * `fetch` is injected, so the whole failover path is tested without a network.
 * The Gemini key travels in a header rather than the URL, so it cannot end up in
 * an error message or an access log.
 */
import {
  configuredProviders,
  isProviderFatalStatus,
  isTransientStatus,
  modelChain,
  type LlmEnv,
  type LlmProvider,
} from "./llm-policy.js";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

interface LlmResult<T> {
  value: T;
  /** The provider that actually answered, which drives the honest UI badge. */
  provider: LlmProvider;
  model: string;
}

export interface LlmClient {
  readonly configured: boolean;
  complete<T>(request: LlmRequest, parse: (text: string) => T): Promise<LlmResult<T>>;
}

export class LlmUnavailableError extends Error {
  override readonly name = "LlmUnavailableError";
}

/** A failure that another model on the same provider will not fix. */
class ProviderFatalError extends Error {}

export interface LlmClientOptions {
  fetch?: typeof fetch;
  /** Per-attempt timeout, so one hung model cannot stall the chain. */
  attemptTimeoutMs?: number;
  /** Ceiling across all attempts, so the user is never left waiting. */
  totalTimeoutMs?: number;
  /** Pause before retrying a model that answered "busy" (5xx). */
  retryDelayMs?: number;
}

/** A busy-server failure: the same model is worth one more try. */
class TransientError extends Error {}

// A healthy answer takes 1.3 to 4 s (measured on the live service). Under load a
// model can hang rather than refuse, so each attempt is cut off well before the
// person gives up, and the offline planner answers within 15 s at worst.
const DEFAULT_ATTEMPT_TIMEOUT_MS = 8_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 400;
const MAX_TRANSIENT_RETRIES = 1;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ProviderAdapter {
  apiKey(env: LlmEnv): string | undefined;
  buildRequest(
    model: string,
    request: LlmRequest,
    apiKey: string,
  ): { url: string; headers: Record<string, string>; body: unknown };
  readText(json: unknown): string | undefined;
}

const ADAPTERS: Record<LlmProvider, ProviderAdapter> = {
  gemini: {
    apiKey: (env) => env.GEMINI_API_KEY,
    buildRequest: (model, request, apiKey) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: request.temperature,
          maxOutputTokens: request.maxTokens,
          responseMimeType: "application/json",
        },
      },
    }),
    readText: (json) => {
      const data = json as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      return parts
        .filter((part) => !part.thought)
        .map((part) => part.text ?? "")
        .join("");
    },
  },
  fireworks: {
    apiKey: (env) => env.FIREWORKS_API_KEY,
    buildRequest: (model, request, apiKey) => ({
      url: "https://api.fireworks.ai/inference/v1/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      },
    }),
    readText: (json) => {
      const data = json as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content;
    },
  },
};

export function createLlmClient(env: LlmEnv, options: LlmClientOptions = {}): LlmClient {
  const doFetch = options.fetch ?? fetch;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const providers = configuredProviders(env);

  async function attempt(
    provider: LlmProvider,
    model: string,
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<string> {
    const adapter = ADAPTERS[provider];
    const { url, headers, body } = adapter.buildRequest(model, request, adapter.apiKey(env) ?? "");
    const response = await doFetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // The response body is intentionally not logged: providers may echo input.
      const message = `HTTP ${response.status}`;
      if (isProviderFatalStatus(response.status)) throw new ProviderFatalError(message);
      throw isTransientStatus(response.status) ? new TransientError(message) : new Error(message);
    }
    const text = adapter.readText(await response.json());
    if (!text) throw new Error("empty completion");
    return text;
  }

  /** One run through the chain: shared deadline, request, parser and failure log. */
  interface Run<T> {
    request: LlmRequest;
    parse: (text: string) => T;
    deadline: AbortSignal;
    failures: string[];
  }

  /**
   * Try one model, with one short retry if it answers "busy". The result is the
   * answer, or where the chain should go next.
   */
  async function tryModel<T>(
    run: Run<T>,
    provider: LlmProvider,
    model: string,
  ): Promise<LlmResult<T> | "next-model" | "next-provider"> {
    for (let retry = 0; retry <= MAX_TRANSIENT_RETRIES && !run.deadline.aborted; retry++) {
      try {
        const signal = AbortSignal.any([run.deadline, AbortSignal.timeout(attemptTimeoutMs)]);
        const text = await attempt(provider, model, run.request, signal);
        return { value: run.parse(text), provider, model };
      } catch (error) {
        run.failures.push(`${provider}/${model}: ${describeFailure(error)}`);
        if (error instanceof ProviderFatalError) return "next-provider";
        if (!(error instanceof TransientError) || retry === MAX_TRANSIENT_RETRIES) break;
        // A busy model often answers a moment later; jitter spreads out retries.
        await sleep(retryDelayMs * (1 + Math.random() / 2));
      }
    }
    return "next-model";
  }

  /** Walk one provider's model chain; null means move on to the next provider. */
  async function tryProvider<T>(run: Run<T>, provider: LlmProvider): Promise<LlmResult<T> | null> {
    for (const model of modelChain(provider, env)) {
      if (run.deadline.aborted) return null;
      const outcome = await tryModel(run, provider, model);
      if (outcome === "next-provider") return null;
      if (outcome !== "next-model") return outcome;
    }
    return null;
  }

  return {
    configured: providers.length > 0,

    async complete(request, parse) {
      if (providers.length === 0) throw new LlmUnavailableError("no provider configured");
      const run = { request, parse, deadline: AbortSignal.timeout(totalTimeoutMs), failures: [] };
      for (const provider of providers) {
        if (run.deadline.aborted) break;
        const result = await tryProvider(run, provider);
        if (result) return result;
      }
      throw new LlmUnavailableError(run.failures.join(" | ") || "deadline exceeded");
    },
  };
}

/** Name the failure without echoing content, which could contain user text. */
function describeFailure(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid JSON";
  if (error instanceof Error && /^(HTTP \d+|empty completion)$/.test(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return "invalid output";
}

/** Best-effort extraction of a JSON object from model text (handles code fences). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate);
}
