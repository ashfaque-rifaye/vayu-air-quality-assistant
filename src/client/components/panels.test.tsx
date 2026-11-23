// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makePlan } from "../../test/fixtures";
import { a11yViolations, memoryStorage, mockAi, renderPanel } from "../../test/ui";
import { AnnouncerProvider } from "../lib/announcer";
import { createPlanStore } from "../lib/plan-store";
import { IntakeFlow } from "./IntakeFlow";
import { OverviewPanel } from "./OverviewPanel";
import AssistantPanel from "./AssistantPanel";
import ExposurePanel from "./ExposurePanel";
import MeasuresPanel from "./MeasuresPanel";
import RoutinePanel from "./RoutinePanel";
import SwapsPanel from "./SwapsPanel";

afterEach(() => vi.unstubAllGlobals());

describe("IntakeFlow", () => {
  it("shows an error summary when required fields are empty", async () => {
    const store = createPlanStore(memoryStorage());
    render(
      <AnnouncerProvider>
        <IntakeFlow store={store} />
      </AnnouncerProvider>,
    );
    // Clear the pre-filled member name is not needed; household and city are empty.
    fireEvent.click(screen.getByRole("button", { name: /build my clean-air plan/i }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/to continue/i)).toBeTruthy();
  });

  it("has no axe violations", async () => {
    const store = createPlanStore(memoryStorage());
    const { container } = render(
      <AnnouncerProvider>
        <IntakeFlow store={store} />
      </AnnouncerProvider>,
    );
    expect(await a11yViolations(container)).toEqual([]);
  });
});

describe("OverviewPanel", () => {
  it("renders the protection score and risks, with no axe violations", async () => {
    const { container } = renderPanel(OverviewPanel, makePlan());
    expect(screen.getByText(/Protection:/i)).toBeTruthy();
    expect(await a11yViolations(container)).toEqual([]);
  });
});

describe("MeasuresPanel", () => {
  it("fetches tailored guidance for a measure", async () => {
    mockAi({
      measure: {
        whatToLookFor: ["True-HEPA sized to the room"],
        redFlags: ["Ozone generators"],
        tip: "Run it on the bedroom",
        reasoning: "r",
      },
    });
    renderPanel(MeasuresPanel, makePlan());
    const buttons = screen.getAllByRole("button", { name: /tailored guidance/i });
    fireEvent.click(buttons[0]!);
    expect(await screen.findByTestId("measure-guide")).toBeTruthy();
    expect(screen.getByText(/True-HEPA sized/i)).toBeTruthy();
  });

  it("marking a measure done raises the protection count", async () => {
    const { getPlan } = renderPanel(MeasuresPanel, makePlan());
    const before = getPlan().measures.filter((m) => m.status === "done").length;
    const selects = screen.getAllByLabelText("Status");
    await userEvent.selectOptions(selects[0]!, "done");
    expect(getPlan().measures.filter((m) => m.status === "done").length).toBe(before + 1);
  });
});

describe("ExposurePanel", () => {
  it("shows the exposure review from the AI", async () => {
    mockAi({
      review: {
        advice: [{ title: "Seal the bedroom first", detail: "It gates everything else." }],
        moves: [],
        reasoning: "r",
      },
    });
    renderPanel(ExposurePanel, makePlan());
    expect(screen.getByTestId("aqi-pill")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /review my exposure/i }));
    expect(await screen.findByTestId("exposure-review")).toBeTruthy();
    expect(screen.getByText(/Seal the bedroom first/i)).toBeTruthy();
  });
});

describe("SwapsPanel", () => {
  it("suggests swaps with their impact", async () => {
    mockAi({
      swaps: {
        swaps: [
          {
            title: "Metro on red days",
            description: "d",
            category: "Commute",
            co2eKgPerWeek: 12,
            exposureReductionPerDay: 300,
            why: "w",
          },
        ],
        reasoning: "r",
      },
    });
    renderPanel(SwapsPanel, makePlan());
    fireEvent.click(screen.getByRole("button", { name: /suggest swaps/i }));
    expect(await screen.findByTestId("swap-card")).toBeTruthy();
    expect(screen.getByText(/Metro on red days/i)).toBeTruthy();
  });
});

describe("RoutinePanel", () => {
  it("writes an AI day-sheet", async () => {
    mockAi({
      daysheet: {
        items: [{ time: "07:00", title: "Check the air", note: "AQI high" }],
        reasoning: "r",
      },
    });
    renderPanel(RoutinePanel, makePlan());
    fireEvent.click(screen.getByRole("button", { name: /write it/i }));
    expect(await screen.findByTestId("daysheet")).toBeTruthy();
  });
});

describe("AssistantPanel", () => {
  it("answers a question and records the exchange", async () => {
    mockAi({
      chat: {
        reply: "Keep the windows shut during the evening peak.",
        reasoning: "r",
        proposals: [],
      },
    });
    renderPanel(AssistantPanel, makePlan());
    fireEvent.click(screen.getAllByRole("button", { name: /first today/i })[0]!);
    expect(await screen.findByTestId("chat-assistant")).toBeTruthy();
    expect(screen.getByText(/windows shut/i)).toBeTruthy();
  });
});
