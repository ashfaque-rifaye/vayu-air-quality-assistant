// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { planToJson } from "../../shared/exports";
import { makePlan } from "../../test/fixtures";
import { a11yViolations, memoryStorage, mockAi, renderPanel } from "../../test/ui";
import { AnnouncerProvider } from "../lib/announcer";
import { createPlanStore } from "../lib/plan-store";
import { HomePage } from "./HomePage";
import { IntakeFlow } from "./IntakeFlow";
import { OverviewPanel } from "./OverviewPanel";
import AssistantPanel from "./AssistantPanel";
import ExposurePanel from "./ExposurePanel";
import RoutinePanel from "./RoutinePanel";

afterEach(() => vi.unstubAllGlobals());

function stubBlobUrls() {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
}

describe("IntakeFlow end to end", () => {
  it("drafts from a description then creates a plan", async () => {
    mockAi({
      interpret: {
        profile: {
          household: "Test home",
          city: "Delhi",
          members: [{ label: "Me", group: "healthy" }],
        },
        assumptions: ["Assumed winter smog"],
        questions: [],
        reasoning: "parsed",
      },
    });
    const store = createPlanStore(memoryStorage());
    render(
      <AnnouncerProvider>
        <IntakeFlow store={store} />
      </AnnouncerProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Tell Vayu about your situation/i), {
      target: { value: "family in Delhi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fill in the details with AI/i }));
    await screen.findByTestId("interpret-result");
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Delhi");
    fireEvent.click(screen.getByRole("button", { name: /build my clean-air plan/i }));
    expect(store.getPlans()).toHaveLength(1);
  });

  it("adds and removes a household member", () => {
    const store = createPlanStore(memoryStorage());
    render(
      <AnnouncerProvider>
        <IntakeFlow store={store} />
      </AnnouncerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a person/i }));
    const removes = screen.getAllByRole("button", { name: /remove/i });
    expect(removes.length).toBeGreaterThan(0);
    fireEvent.click(removes[0]!);
  });
});

describe("HomePage", () => {
  it("lists a saved plan and deletes it with confirmation", async () => {
    const store = createPlanStore(memoryStorage());
    store.add(makePlan());
    const { container } = render(
      <AnnouncerProvider>
        <HomePage store={store} plans={store.getPlans()} />
      </AnnouncerProvider>,
    );
    expect(screen.getByText("The Sharma family")).toBeTruthy();
    expect(await a11yViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /delete the sharma family/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete the sharma family$/i }));
    expect(store.getPlans()).toHaveLength(0);
  });

  it("imports a valid backup file", async () => {
    const store = createPlanStore(memoryStorage());
    render(
      <AnnouncerProvider>
        <HomePage store={store} plans={[]} />
      </AnnouncerProvider>,
    );
    const input = screen.getByLabelText(/import a vayu plan backup/i);
    const file = new File([planToJson(makePlan())], "backup.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(store.getPlans()).toHaveLength(1));
  });
});

describe("ExposurePanel interactions", () => {
  it("sets a manual PM2.5 and applies a review move", async () => {
    mockAi({
      review: {
        advice: [{ title: "Adopt the top measure", detail: "d" }],
        moves: [{ measureId: "measure-1", why: "biggest win" }],
        reasoning: "r",
      },
    });
    const { getPlan } = renderPanel(ExposurePanel, makePlan());

    const input = screen.getByLabelText(/Set today's average PM2.5/i);
    fireEvent.change(input, { target: { value: "70" } });
    fireEvent.blur(input);
    expect(getPlan().air.averagePm25).toBe(70);
    expect(getPlan().air.source).toBe("manual");
    fireEvent.click(screen.getByRole("button", { name: /reset to model/i }));
    expect(getPlan().air.source).toBe("model");

    fireEvent.click(screen.getByRole("button", { name: /review my exposure/i }));
    await screen.findByTestId("exposure-review");
    fireEvent.click(screen.getByRole("button", { name: /mark this done/i }));
    expect(getPlan().measures.find((m) => m.id === "measure-1")?.status).toBe("done");
  });
});

describe("RoutinePanel interactions", () => {
  it("adds a custom reminder, rebuilds and exports", () => {
    stubBlobUrls();
    const { getPlan } = renderPanel(RoutinePanel, makePlan());
    fireEvent.change(screen.getByLabelText(/add your own reminder/i), {
      target: { value: "School pickup" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(getPlan().routine.some((i) => i.title === "School pickup")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /rebuild/i }));
    fireEvent.click(screen.getByRole("button", { name: /add to calendar/i }));
  });
});

describe("OverviewPanel interactions", () => {
  it("marks the biggest win done and downloads a backup", () => {
    stubBlobUrls();
    const { getPlan } = renderPanel(OverviewPanel, makePlan());
    const before = getPlan().measures.filter((m) => m.status === "done").length;
    fireEvent.click(screen.getAllByRole("button", { name: /mark done/i })[0]!);
    expect(getPlan().measures.filter((m) => m.status === "done").length).toBe(before + 1);
    fireEvent.click(screen.getByRole("button", { name: /download backup/i }));
  });
});

describe("AssistantPanel proposals", () => {
  it("applies an adoptMeasure proposal from the assistant", async () => {
    mockAi({
      chat: {
        reply: "Mark the purifier done.",
        reasoning: "r",
        proposals: [{ type: "adoptMeasure", measureId: "measure-1", why: "biggest win" }],
      },
    });
    const { getPlan } = renderPanel(AssistantPanel, makePlan());
    fireEvent.click(screen.getAllByRole("button", { name: /first today/i })[0]!);
    await screen.findByTestId("proposal");
    fireEvent.click(
      within(screen.getByTestId("proposal")).getByRole("button", { name: /^apply/i }),
    );
    expect(getPlan().measures.find((m) => m.id === "measure-1")?.status).toBe("done");
  });
});

describe("commute defaults", () => {
  it("gives a chosen commute a typical duration so it counts toward exposure", () => {
    const store = createPlanStore(memoryStorage());
    render(
      <AnnouncerProvider>
        <IntakeFlow store={store} />
      </AnnouncerProvider>,
    );
    fireEvent.change(screen.getByLabelText("How do you commute?"), { target: { value: "car" } });
    expect((screen.getByLabelText("Minutes each way") as HTMLInputElement).value).toBe("30");
  });
});
