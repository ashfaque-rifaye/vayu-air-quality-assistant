import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("applies sane defaults", () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(8787);
    expect(config.TRUSTED_PROXY_HOPS).toBe(1);
    expect(config.AI_RATE_LIMIT_PER_MINUTE).toBe(20);
    expect(config.GEMINI_API_KEY).toBeUndefined();
  });

  it("reads and coerces real values", () => {
    const config = loadConfig({
      PORT: "3000",
      GEMINI_API_KEY: "  key  ",
      AI_GLOBAL_LIMIT_PER_HOUR: "100",
    });
    expect(config.PORT).toBe(3000);
    expect(config.GEMINI_API_KEY).toBe("key");
    expect(config.AI_GLOBAL_LIMIT_PER_HOUR).toBe(100);
  });

  it("falls back on an unparseable number", () => {
    expect(loadConfig({ AI_RATE_LIMIT_PER_MINUTE: "nonsense" }).AI_RATE_LIMIT_PER_MINUTE).toBe(20);
  });
});
