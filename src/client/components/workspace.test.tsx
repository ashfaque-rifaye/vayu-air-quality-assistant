// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { makePlan } from "../../test/fixtures";
import { a11yViolations, memoryStorage, mockAi } from "../../test/ui";
import type { PlanTab } from "../../shared/insights";
import type { Plan } from "../../shared/schemas";
import { AnnouncerProvider } from "../lib/announcer";
import { createPlanStore } from "../lib/plan-store";
import { PLAN_TABS } from "../lib/route";
import { PlanWorkspace } from "./PlanWorkspace";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const TAILORED = {
  summary: "Your son's asthma sets the bar: seal the bedroom first.",
  measures: [
    // A new idea with no seeded category, so it is added...
    { label: "Wet-mop floors instead of sweeping", category: null, why: "Asthma" },
    // ...and a repeat of a seeded category, which the reducer must drop.
    { label: "Buy another purifier", category: "purifier" as const, why: "Duplicate" },
  ],
  routine: [
    {
      time: "21:00",
      title: "Close bedroom windows",
      why: "Evening peak",
      category: "sealing" as const,
    },
  ],
  reasoning: "A child with asthma and a roadside home.",
};

function renderWorkspace(tab: PlanTab, plan: Plan = makePlan()) {
  const store = createPlanStore(memoryStorage());
  store.add(plan);
  const view = render(
    <AnnouncerProvider>
      <main>
        <PlanWorkspace plan={store.getPlan(plan.id) as Plan} tab={tab} store={store} />
      </main>
    </AnnouncerProvider>,
  );
  return { ...view, store };
}

describe("PlanWorkspace", () => {
  it("tailors a new plan once and shows what the AI added, with no axe violations", async () => {
    const fetchMock = mockAi({ personalize: TAILORED });
    const { store, container } = renderWorkspace("overview");
    await waitFor(() =>
      expect(store.getPlan("plan-1")?.personalization?.summary).toBe(TAILORED.summary),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const plan = store.getPlan("plan-1") as Plan;
    expect(plan.measures.some((m) => m.label === "Wet-mop floors instead of sweeping")).toBe(true);
    expect(plan.measures.some((m) => m.label === "Buy another purifier")).toBe(false);
    expect(plan.routine.some((r) => r.title === "Close bedroom windows")).toBe(true);
    expect(await a11yViolations(container)).toEqual([]);
  });

  it("shows the tailored additions on the overview once applied", async () => {
    mockAi({ personalize: TAILORED });
    const { store } = renderWorkspace("overview");
    await waitFor(() => expect(store.getPlan("plan-1")?.personalization).toBeTruthy());
    // Re-render with the tailored plan, the way the app does after the store changes.
    const plan = store.getPlan("plan-1") as Plan;
    render(
      <AnnouncerProvider>
        <PlanWorkspace plan={plan} tab="overview" store={store} />
      </AnnouncerProvider>,
    );
    const tailored = screen.getByTestId("personalization");
    expect(within(tailored).getByText("Wet-mop floors instead of sweeping")).toBeTruthy();
    expect(within(tailored).getByText("Close bedroom windows")).toBeTruthy();
    expect(within(tailored).getByText(/Routine, 21:00/)).toBeTruthy();
  });

  it("offers a retry when tailoring fails, and the plan stays usable", async () => {
    const fetchMock = mockAi({});
    renderWorkspace("overview");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/ran into a problem/i)).toBeTruthy();
    expect(screen.getByText(/Protection:/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not re-tailor a plan that is already tailored", () => {
    const fetchMock = mockAi({ personalize: TAILORED });
    const plan = {
      ...makePlan(),
      personalization: { summary: "s", reasoning: "r", source: "gemini" as const },
    };
    renderWorkspace("overview", plan);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(PLAN_TABS.filter((t) => t.id !== "overview").map((t) => [t.id, t.label]))(
    "lazy-loads the %s panel",
    async (id) => {
      mockAi({ personalize: TAILORED });
      renderWorkspace(id as PlanTab);
      const panel = screen.getByRole("tabpanel");
      expect(panel.id).toBe(`panel-${id}`);
      // Each panel renders its own level-2 heading once its chunk has loaded.
      await waitFor(() => expect(within(panel).getAllByRole("heading").length).toBeGreaterThan(1));
    },
  );

  it("marks only the current tab as selected and in the tab order", () => {
    mockAi({ personalize: TAILORED });
    renderWorkspace("routine");
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(PLAN_TABS.length);
    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected.map((tab) => tab.textContent)).toEqual(["Routine"]);
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it.each([
    ["overview", "ArrowRight", "exposure"],
    ["assistant", "ArrowRight", "overview"],
    ["exposure", "ArrowLeft", "overview"],
    ["overview", "ArrowLeft", "assistant"],
    ["swaps", "Home", "overview"],
    ["overview", "End", "assistant"],
  ] as const)("on %s, %s moves to %s (ARIA tabs pattern)", (from, key, to) => {
    mockAi({ personalize: TAILORED });
    renderWorkspace(from);
    const current = screen.getByRole("tab", { selected: true });
    fireEvent.keyDown(current, { key });
    expect(window.location.hash).toBe(`#/plans/plan-1/${to}`);
    expect(document.activeElement?.id).toBe(`tab-${to}`);
  });

  it("ignores keys that are not tab navigation", () => {
    mockAi({ personalize: TAILORED });
    renderWorkspace("overview");
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "a" });
    expect(window.location.hash).toBe("");
  });

  it("navigates when a tab is clicked", () => {
    mockAi({ personalize: TAILORED });
    renderWorkspace("overview");
    fireEvent.click(screen.getByRole("tab", { name: "Measures" }));
    expect(window.location.hash).toBe("#/plans/plan-1/measures");
  });

  it("uses the singular for a one-person household", () => {
    mockAi({ personalize: TAILORED });
    renderWorkspace(
      "overview",
      makePlan({ members: [{ id: "m1", label: "Me", group: "healthy" }], concerns: [] }),
    );
    expect(screen.getByText(/1 person$/)).toBeTruthy();
  });
});
