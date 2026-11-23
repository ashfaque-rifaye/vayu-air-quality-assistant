import { describe, expect, it, vi } from "vitest";
import { createApp, clientKey } from "./app.js";
import { InvalidInputError, type AiService } from "./ai/service.js";

const envelope = {
  data: { profile: {}, assumptions: [], questions: [], reasoning: "x" },
  source: "gemini" as const,
  sanitized: false,
  cached: false,
};

function appWith(run: AiService["run"]) {
  return createApp({ ai: { run }, aiConfigured: true, trustedProxyHops: 1 });
}

const okAi = appWith((async () => ({ envelope })) as unknown as AiService["run"]);
const json = { "content-type": "application/json" };

describe("clientKey", () => {
  it("counts back from the right by the number of trusted proxies", () => {
    expect(clientKey("1.1.1.1, 2.2.2.2, 3.3.3.3", 1)).toBe("3.3.3.3");
    expect(clientKey("1.1.1.1, 2.2.2.2", 2)).toBe("1.1.1.1");
    expect(clientKey(undefined, 1)).toBe("direct");
    expect(clientKey("1.1.1.1", 0)).toBe("direct");
  });
});

describe("the HTTP surface", () => {
  it("reports health", async () => {
    const res = await okAi.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", aiConfigured: true });
  });

  it("sets a strict CSP on every response", async () => {
    const res = await okAi.request("/api/health");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers a valid request with the envelope", async () => {
    const res = await okAi.request("/api/ai/interpret", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ text: "Delhi" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: "gemini" });
  });

  it("rejects an unknown feature", async () => {
    const res = await okAi.request("/api/ai/bogus", { method: "POST", headers: json, body: "{}" });
    expect(res.status).toBe(404);
  });

  it("requires JSON", async () => {
    const res = await okAi.request("/api/ai/interpret", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(res.status).toBe(415);
  });

  it("rejects malformed JSON", async () => {
    const res = await okAi.request("/api/ai/interpret", {
      method: "POST",
      headers: json,
      body: "{",
    });
    expect(res.status).toBe(400);
  });

  it("refuses a cross-origin request", async () => {
    const res = await okAi.request("/api/ai/interpret", {
      method: "POST",
      headers: { ...json, origin: "https://evil.example", host: "vayu.app" },
      body: JSON.stringify({ text: "Delhi" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an over-large body", async () => {
    const big = JSON.stringify({ text: "x".repeat(70_000) });
    const res = await okAi.request("/api/ai/interpret", {
      method: "POST",
      headers: json,
      body: big,
    });
    expect(res.status).toBe(413);
  });

  it("passes a rate-limit through as 429 with Retry-After", async () => {
    const limited = appWith((async () => ({
      envelope,
      retryAfterSeconds: 30,
    })) as unknown as AiService["run"]);
    const res = await limited.request("/api/ai/interpret", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ text: "Delhi" }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("turns invalid input into a 400 with the offending fields", async () => {
    const bad = appWith((async () => {
      throw new InvalidInputError(["text"]);
    }) as unknown as AiService["run"]);
    const res = await bad.request("/api/ai/interpret", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ text: "" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ fields: ["text"] });
  });

  it("hides the details of an unexpected failure from the response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = appWith((async () => {
      throw new Error("secret internal detail");
    }) as unknown as AiService["run"]);
    const res = await broken.request("/api/ai/interpret", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ text: "Delhi" }),
    });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).not.toContain("secret internal detail");
    expect(error).toHaveBeenCalledWith("[app] Error");
    error.mockRestore();
  });

  it("refuses a malformed Origin header as cross-origin", async () => {
    const res = await okAi.request("http://localhost/api/ai/interpret", {
      method: "POST",
      headers: { ...json, origin: "not a url", host: "localhost" },
      body: JSON.stringify({ text: "Delhi" }),
    });
    expect(res.status).toBe(403);
  });

  it("accepts a same-origin browser request", async () => {
    const res = await okAi.request("http://localhost/api/ai/interpret", {
      method: "POST",
      headers: { ...json, origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({ text: "Delhi" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("clientKey edge cases", () => {
  it("falls back to the nearest entry when fewer proxies appended than trusted", () => {
    expect(clientKey("9.9.9.9", 3)).toBe("9.9.9.9");
    expect(clientKey(" , ", 1)).toBe("direct");
  });
});
