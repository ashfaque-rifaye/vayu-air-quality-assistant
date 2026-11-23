// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { planToJson } from "../../shared/exports";
import { makePlan } from "../../test/fixtures";
import { memoryStorage, mockAi } from "../../test/ui";
import { AiRequestError, callAi } from "./api";
import { downloadText, slugify } from "./download";
import {
  createBrowserStorage,
  createPlanStore,
  MAX_IMPORT_BYTES,
  parsePlanBackup,
} from "./plan-store";
import { parseRoute, planHref } from "./route";
import { useAi } from "./use-ai";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("routing", () => {
  it("parses plan routes and defaults the tab", () => {
    expect(parseRoute("#/plans/abc/exposure")).toEqual({
      name: "plan",
      planId: "abc",
      tab: "exposure",
    });
    expect(parseRoute("#/plans/abc")).toEqual({ name: "plan", planId: "abc", tab: "overview" });
    expect(parseRoute("#/plans/abc/nonsense")).toMatchObject({ name: "plan", tab: "overview" });
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(planHref("abc", "measures")).toBe("#/plans/abc/measures");
  });
});

describe("plan store", () => {
  it("adds, reads, dispatches and removes", () => {
    const store = createPlanStore(memoryStorage());
    const plan = makePlan();
    store.add(plan);
    expect(store.getPlan(plan.id)?.profile.city).toBe("Delhi");
    store.dispatch(plan.id, { type: "setAirAverage", amount: 60 });
    expect(store.getPlan(plan.id)?.air.averagePm25).toBe(60);
    store.remove(plan.id);
    expect(store.getPlans()).toHaveLength(0);
  });

  it("persists on flush and re-validates on read", () => {
    const storage = memoryStorage();
    const store = createPlanStore(storage);
    store.add(makePlan());
    store.flush();
    expect(createPlanStore(storage).getPlans()).toHaveLength(1);

    const corrupt = memoryStorage('[{"not":"a plan"}]');
    expect(createPlanStore(corrupt).getPlans()).toHaveLength(0);
  });

  it("validates an imported backup", () => {
    const ok = parsePlanBackup(planToJson(makePlan()));
    expect(ok.ok).toBe(true);
    expect(parsePlanBackup("{not json").ok).toBe(false);
    expect(parsePlanBackup('{"version":99}').ok).toBe(false);
    expect(parsePlanBackup(" ".repeat(MAX_IMPORT_BYTES + 1))).toEqual({
      ok: false,
      error: "That file is too large to be a Vayu backup.",
    });
  });

  it("treats storage that is not a list, or not JSON, as empty", () => {
    expect(createPlanStore(memoryStorage('{"a":1}')).getPlans()).toEqual([]);
    expect(createPlanStore(memoryStorage("{oops")).getPlans()).toEqual([]);
  });

  it("debounces writes, and a flush with nothing pending writes nothing", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const store = createPlanStore(storage);
      store.flush();
      expect(storage.saved()).toBeNull();
      store.add(makePlan());
      store.dispatch("plan-1", { type: "setAirAverage", amount: 80 });
      expect(storage.saved()).toBeNull();
      vi.advanceTimersByTime(300);
      expect(JSON.parse(storage.saved() ?? "[]")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves other plans alone when one changes", () => {
    const store = createPlanStore(memoryStorage());
    const other = { ...makePlan(), id: "plan-2" };
    store.add(makePlan());
    store.add(other);
    store.dispatch("plan-1", { type: "setAirAverage", amount: 90 });
    expect(store.getPlan("plan-2")).toBe(other);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const store = createPlanStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.add(makePlan());
    unsubscribe();
    store.remove("plan-1");
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("browser storage", () => {
  it("uses localStorage when it works", () => {
    const storage = createBrowserStorage();
    storage.setItem("vayu.test", "1");
    expect(storage.getItem("vayu.test")).toBe("1");
    window.localStorage.removeItem("vayu.test");
  });

  it("falls back to memory when localStorage throws, as in some private windows", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const storage = createBrowserStorage();
    expect(storage.getItem("vayu.plans.v1")).toBeNull();
    storage.setItem("vayu.plans.v1", "[]");
    expect(storage.getItem("vayu.plans.v1")).toBe("[]");
    vi.restoreAllMocks();
  });
});

describe("useAi", () => {
  it("reports an unexpected failure with a generic message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    // An AbortError the hook did not cause is still a failure to the person.
    const { result } = renderHook(() => useAi("interpret"));
    await act(() => result.current.run({ text: "family in Delhi" }));
    expect(result.current.state).toEqual({
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  });

  it("drops a slower, older answer when a newer request supersedes it", async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            pending.push(resolve);
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const { result } = renderHook(() => useAi("interpret"));
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.run({ text: "first request" });
    });
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      second = result.current.run({ text: "second request" });
    });
    expect(await first).toBeNull();
    const reply = {
      source: "gemini",
      sanitized: false,
      cached: false,
      data: { profile: { city: "Pune" }, assumptions: [], questions: [], reasoning: "r" },
    };
    await act(async () => {
      pending[1]?.(new Response(JSON.stringify(reply)));
      await second;
    });
    expect(result.current.state).toMatchObject({ status: "success" });
  });

  it("ignores a reply that lands after the screen was left", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve))),
    );
    const { result, unmount } = renderHook(() => useAi("interpret"));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.run({ text: "family in Delhi" });
    });
    unmount();
    resolveFetch(new Response("{}", { status: 500 }));
    expect(await pending).toBeNull();
  });
});

describe("download helpers", () => {
  it("slugifies text safely", () => {
    expect(slugify("The Sharma Family!")).toBe("the-sharma-family");
    expect(slugify("   ")).toBe("event");
  });

  it("creates and revokes an object URL", () => {
    const create = vi.fn(() => "blob:x");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadText("a.txt", "hi", "text/plain");
    expect(create).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalled();
    click.mockRestore();
  });
});

describe("callAi", () => {
  it("validates and returns the envelope", async () => {
    mockAi({
      interpret: { profile: { city: "Delhi" }, assumptions: [], questions: [], reasoning: "r" },
    });
    const envelope = await callAi("interpret", { text: "we live in Delhi" });
    expect(envelope.data.profile.city).toBe("Delhi");
  });

  it("raises a friendly error on a server failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(callAi("interpret", { text: "x" })).rejects.toBeInstanceOf(AiRequestError);
  });

  it("explains a network failure in plain words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(callAi("interpret", { text: "x" })).rejects.toThrow(/check your connection/i);
  });

  it("lets a cancellation through untouched, so callers can ignore it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const controller = new AbortController();
    const error = await callAi("interpret", { text: "x" }, controller.signal).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DOMException);
  });

  it("distinguishes input the server rejected from a server fault", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 400 })),
    );
    await expect(callAi("interpret", { text: "x" })).rejects.toThrow(/could not read that/i);
  });

  it("treats a rate-limited reply as an answer, since it carries the offline result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              source: "fallback",
              sanitized: false,
              cached: false,
              fallbackReason: "rate-limited",
              data: { profile: {}, assumptions: [], questions: [], reasoning: "r" },
            }),
            { status: 429 },
          ),
      ),
    );
    const envelope = await callAi("interpret", { text: "x" });
    expect(envelope.source).toBe("fallback");
  });

  it("rejects a reply that is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>")),
    );
    await expect(callAi("interpret", { text: "x" })).rejects.toThrow(/unexpected reply/i);
  });

  it("rejects an unexpected response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ nonsense: true }))),
    );
    await expect(callAi("interpret", { text: "x" })).rejects.toBeInstanceOf(AiRequestError);
  });
});
