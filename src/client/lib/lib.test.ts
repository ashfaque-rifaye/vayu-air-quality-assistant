// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { planToJson } from "../../shared/exports";
import { makePlan } from "../../test/fixtures";
import { memoryStorage, mockAi } from "../../test/ui";
import { AiRequestError, callAi } from "./api";
import { downloadText, slugify } from "./download";
import { createPlanStore, parsePlanBackup } from "./plan-store";
import { parseRoute, planHref } from "./route";

afterEach(() => vi.unstubAllGlobals());

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

  it("rejects an unexpected response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ nonsense: true }))),
    );
    await expect(callAi("interpret", { text: "x" })).rejects.toBeInstanceOf(AiRequestError);
  });
});
