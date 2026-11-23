// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { makePlan } from "../test/fixtures";
import { lastBody, memoryStorage, mockAi } from "../test/ui";
import { App } from "./App";
import { createPlanStore } from "./lib/plan-store";
import { planHref } from "./lib/route";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function go(href: string): void {
  act(() => {
    window.location.hash = href;
    window.dispatchEvent(new Event("hashchange"));
  });
}

describe("App routing", () => {
  it("shows the home hero by default", () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    expect(screen.getByText(/clear the plan/i)).toBeTruthy();
  });

  it("opens a saved plan's workspace and tailors it without sending names", async () => {
    const fetchMock = mockAi({
      personalize: { summary: "s", measures: [], routine: [], reasoning: "r" },
    });
    const store = createPlanStore(memoryStorage());
    const plan = makePlan();
    store.add(plan);
    render(<App store={store} />);
    go(planHref(plan.id));
    expect(await screen.findByRole("heading", { name: plan.profile.household })).toBeTruthy();

    // The real request body: who is vulnerable goes to the AI, who they are does not.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = JSON.stringify(lastBody(fetchMock));
    expect(sent).toContain('"group":"child"');
    expect(sent).not.toContain("Aarav");
    expect(sent).not.toContain("Dadi");
  });

  it("explains when a plan id is unknown", async () => {
    render(<App store={createPlanStore(memoryStorage())} />);
    go(planHref("does-not-exist"));
    await waitFor(() => expect(screen.getByText(/could not find that plan/i)).toBeTruthy());
  });
});
