// @vitest-environment jsdom
/**
 * Every control a person can touch, exercised against a real plan store, so a
 * test fails if a click stops changing the plan, and not only if a render breaks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { makePlan } from "../../test/fixtures";
import { lastBody, memoryStorage, mockAi, renderPanel } from "../../test/ui";
import type { Plan } from "../../shared/schemas";
import { AnnouncerProvider } from "../lib/announcer";
import { createPlanStore, MAX_IMPORT_BYTES } from "../lib/plan-store";
import AssistantPanel from "./AssistantPanel";
import ExposurePanel from "./ExposurePanel";
import { HomePage } from "./HomePage";
import { IntakeFlow } from "./IntakeFlow";
import MeasuresPanel from "./MeasuresPanel";
import { OverviewPanel } from "./OverviewPanel";
import RoutinePanel from "./RoutinePanel";
import SwapsPanel from "./SwapsPanel";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = "";
});

function stubDownloads() {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  return vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
}

function renderIntake() {
  const store = createPlanStore(memoryStorage());
  const view = render(
    <AnnouncerProvider>
      <IntakeFlow store={store} />
    </AnnouncerProvider>,
  );
  return { ...view, store };
}

const change = (label: string | RegExp, value: string, index = 0) =>
  fireEvent.change(screen.getAllByLabelText(label)[index]!, { target: { value } });

describe("IntakeFlow: the full form", () => {
  it("captures every field into the new plan's profile", () => {
    const { store } = renderIntake();
    change("Household name", "The Khan family");
    change("City", "Lahore");
    change("Day to plan for", "2026-12-01");
    change("Language for AI advice", "ur");
    change("Person 1", "Ammi");
    change("Sensitivity", "senior");
    fireEvent.click(screen.getByRole("button", { name: /add a person/i }));
    change("Person 2", "Bilal");
    change("Sensitivity", "respiratory", 1);

    change("How airtight is it?", "leaky");
    change("Cooking fuel", "gas");
    change("Winter heating", "electric");
    change("Main room size (m²)", "18");
    fireEvent.click(screen.getByRole("checkbox", { name: /busy road/i }));
    expect(screen.queryByLabelText(/Purifier CADR/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /already have an air purifier/i }));
    change(/Purifier CADR/, "250");

    change("How do you commute?", "bus");
    change("Minutes each way", "45");
    change("Leaves home at", "08:15");
    expect(screen.queryByLabelText("Usually at")).toBeNull();
    change("Outdoor exercise", "light");
    change("Usually at", "06:30");

    for (const name of ["Children", "Sleep", "Cooking"]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    // Three is the limit: the rest lock until one is cleared.
    expect(screen.getByRole("checkbox", { name: "Budget" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Sleep" }));
    expect(screen.getByRole("checkbox", { name: "Budget" })).toBeEnabled();

    change(/Anything else Vayu should know/, "Brick kilns nearby");
    fireEvent.click(screen.getByRole("button", { name: /build my clean-air plan/i }));

    const [plan] = store.getPlans();
    expect(plan?.profile).toMatchObject({
      household: "The Khan family",
      city: "Lahore",
      date: "2026-12-01",
      language: "ur",
      home: {
        ventilation: "leaky",
        cookingFuel: "gas",
        heating: "electric",
        roomSqm: 18,
        nearRoad: true,
        hasPurifier: true,
        purifierCadr: 250,
      },
      commuteMode: "bus",
      commuteMinutes: 45,
      commuteTime: "08:15",
      outdoorActivity: "light",
      outdoorTime: "06:30",
      concerns: ["children", "cooking"],
      notes: "Brick kilns nearby",
    });
    expect(plan?.profile.members.map((m) => [m.label, m.group])).toEqual([
      ["Ammi", "senior"],
      ["Bilal", "respiratory"],
    ]);
    expect(window.location.hash).toBe(`#/plans/${plan?.id}/overview`);
  });

  it("names a single missing field and moves focus to it from the summary", async () => {
    renderIntake();
    change("Household name", "The Khan family");
    fireEvent.click(screen.getByRole("button", { name: /build my clean-air plan/i }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/fix this to continue/i)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(alert));
    fireEvent.click(within(alert).getByRole("link"));
    expect(document.activeElement?.id).toBe("profile-city");
    expect(screen.getByLabelText("City")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("IntakeFlow: describe it in your own words", () => {
  it("fills an example description from a chip", () => {
    renderIntake();
    fireEvent.click(screen.getByRole("button", { name: /try: delhi family/i }));
    const text = screen.getByLabelText(/Tell Vayu about your situation/i) as HTMLTextAreaElement;
    expect(text.value).toMatch(/family of four in Delhi/);
  });

  it("does not call the AI for a description that is too short", () => {
    const fetchMock = mockAi({});
    renderIntake();
    const text = screen.getByLabelText(/Tell Vayu about your situation/i);
    fireEvent.change(text, { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: /fill in the details/i })).toBeDisabled();
    fireEvent.submit(text.closest("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies every field the AI drafted and shows its assumptions and questions", async () => {
    mockAi({
      interpret: {
        profile: {
          household: "The Iyer family",
          city: "Chennai",
          members: [
            { label: "Appa", group: "heart" },
            { label: "Meera", group: "child" },
          ],
          home: {
            ventilation: "sealed",
            cookingFuel: "induction",
            heating: "none",
            hasPurifier: true,
            nearRoad: true,
          },
          commuteMode: "metro",
          commuteMinutes: 25,
          commuteTime: "07:45",
          outdoorActivity: "moderate",
          outdoorTime: "06:00",
          concerns: ["children", "elderly"],
          notes: "Construction next door",
        },
        assumptions: ["Assumed a typical 20 m² main room"],
        questions: ["How long is the school run?"],
        reasoning: "Read from the description.",
      },
    });
    renderIntake();
    fireEvent.change(screen.getByLabelText(/Tell Vayu about your situation/i), {
      target: { value: "Iyer family in Chennai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fill in the details with AI/i }));
    const result = await screen.findByTestId("interpret-result");
    expect(within(result).getByText("Assumed a typical 20 m² main room")).toBeTruthy();
    expect(within(result).getByText("How long is the school run?")).toBeTruthy();
    // Focus moves to the form so the person can check what was filled in.
    expect(document.activeElement?.id).toBe("details-title");

    const value = (label: string | RegExp) =>
      (screen.getByLabelText(label) as HTMLInputElement).value;
    expect(value("Household name")).toBe("The Iyer family");
    expect(value("How airtight is it?")).toBe("sealed");
    expect(value("Cooking fuel")).toBe("induction");
    expect(value("How do you commute?")).toBe("metro");
    expect(value("Minutes each way")).toBe("25");
    expect(value("Leaves home at")).toBe("07:45");
    expect(value("Usually at")).toBe("06:00");
    expect(value(/Anything else/)).toBe("Construction next door");
    expect(value("Person 2")).toBe("Meera");
    expect(screen.getByRole("checkbox", { name: /busy road/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Elderly" })).toBeChecked();
  });

  it("explains when the AI cannot be reached, and keeps the form editable", async () => {
    mockAi({});
    renderIntake();
    fireEvent.change(screen.getByLabelText(/Tell Vayu about your situation/i), {
      target: { value: "family in Delhi" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fill in the details with AI/i }));
    expect(await screen.findByText(/ran into a problem/i)).toBeTruthy();
    expect(screen.getByLabelText("City")).toBeEnabled();
  });
});

describe("HomePage", () => {
  function renderHome(plans: Plan[] = []) {
    const store = createPlanStore(memoryStorage());
    plans.forEach((plan) => store.add(plan));
    render(
      <AnnouncerProvider>
        <HomePage store={store} plans={store.getPlans()} />
      </AnnouncerProvider>,
    );
    return store;
  }

  it("keeps a plan when deletion is cancelled", () => {
    const store = renderHome([
      makePlan({ members: [{ id: "m1", label: "Me", group: "healthy" }] }),
    ]);
    expect(screen.getByText(/1\s+person/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /delete the sharma family/i }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(store.getPlans()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /delete the sharma family/i })).toBeTruthy();
  });

  it("opens the file picker from the visible import button", () => {
    renderHome();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /import backup/i }));
    expect(click).toHaveBeenCalled();
  });

  it.each([
    ["not JSON", new File(["{oops"], "x.json"), /not valid JSON/i],
    ["the wrong shape", new File(['{"plan":1}'], "x.json"), /not a valid Vayu plan/i],
    ["too large", new File(["x".repeat(MAX_IMPORT_BYTES + 1)], "x.json"), /too large/i],
  ])("rejects a backup that is %s, and imports nothing", async (_name, file, message) => {
    const store = renderHome();
    fireEvent.change(screen.getByLabelText(/import a vayu plan backup/i), {
      target: { files: [file] },
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
    expect(store.getPlans()).toHaveLength(0);
  });
});

describe("MeasuresPanel", () => {
  it("adds a measure of your own, ticks its checklist, then removes it", () => {
    const { getPlan } = renderPanel(MeasuresPanel, makePlan());
    const before = getPlan().measures.length;
    const add = screen.getByRole("button", { name: /^add$/i });
    expect(add).toBeDisabled();
    change("What will you do?", "Wet-mop instead of sweeping");
    change("Type", "cooking");
    fireEvent.click(add);
    const added = getPlan().measures.find((m) => m.label === "Wet-mop instead of sweeping");
    expect(added).toMatchObject({ category: "cooking", source: "you" });
    expect(getPlan().measures).toHaveLength(before + 1);

    const card = screen
      .getAllByTestId("measure-card")
      .find((element) => within(element).queryByText("Wet-mop instead of sweeping"))!;
    fireEvent.click(within(card).getAllByRole("checkbox")[0]!);
    expect(
      getPlan()
        .measures.find((m) => m.id === added?.id)
        ?.checks.some((c) => c.done),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /remove wet-mop instead of sweeping/i }));
    expect(getPlan().measures).toHaveLength(before);
  });

  it("only offers removal for measures you or the AI added", () => {
    renderPanel(MeasuresPanel, makePlan());
    expect(screen.queryAllByRole("button", { name: /^remove/i })).toHaveLength(0);
  });

  it("shows guidance without a warnings list when there are no red flags", async () => {
    mockAi({
      measure: { whatToLookFor: ["Fits the window"], redFlags: [], tip: "t", reasoning: "r" },
    });
    renderPanel(MeasuresPanel, makePlan());
    fireEvent.click(screen.getAllByRole("button", { name: /tailored guidance/i })[0]!);
    const guide = await screen.findByTestId("measure-guide");
    expect(within(guide).queryByText(/watch out for/i)).toBeNull();
    expect(screen.getByRole("button", { name: /guidance again/i })).toBeTruthy();
  });

  it("explains when guidance cannot be fetched", async () => {
    mockAi({});
    renderPanel(MeasuresPanel, makePlan());
    fireEvent.click(screen.getAllByRole("button", { name: /tailored guidance/i })[0]!);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

const SWAP = {
  title: "Metro on red days",
  description: "Leave the car at home when AQI passes 200.",
  category: "Commute",
  co2eKgPerWeek: 12,
  exposureReductionPerDay: 300,
  why: "Cars trap traffic fumes inside.",
};

describe("SwapsPanel", () => {
  it("sends the steer and the swaps to exclude, then saves and unsaves one", async () => {
    const fetchMock = mockAi({ swaps: { swaps: [SWAP], reasoning: "r" } });
    const { getPlan } = renderPanel(SwapsPanel, makePlan());
    change(/Steer the swaps/, "things that cost nothing");
    fireEvent.click(screen.getByRole("button", { name: /suggest swaps/i }));
    await screen.findByTestId("swap-card");
    expect(lastBody(fetchMock)).toMatchObject({ steer: "things that cost nothing", exclude: [] });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(getPlan().swaps[0]?.saved).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^saved$/i }));
    expect(getPlan().swaps[0]?.saved).toBe(false);

    // Asking again excludes what is already on screen, so ideas do not repeat.
    fireEvent.click(screen.getByRole("button", { name: /fresh ideas/i }));
    await waitFor(() => expect(lastBody(fetchMock)).toMatchObject({ exclude: [SWAP.title] }));
  });

  it("offers a retry when swaps cannot be fetched", async () => {
    const fetchMock = mockAi({});
    renderPanel(SwapsPanel, makePlan());
    fireEvent.click(screen.getByRole("button", { name: /suggest swaps/i }));
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("RoutinePanel", () => {
  it("adds a reminder at a chosen time and removes one", () => {
    const { getPlan } = renderPanel(RoutinePanel, makePlan());
    change("Time", "16:30");
    change(/add your own reminder/i, "Mask on for the school run");
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    const item = getPlan().routine.find((i) => i.title === "Mask on for the school run");
    expect(item?.time).toBe("16:30");

    fireEvent.click(screen.getByRole("button", { name: /remove mask on for the school run/i }));
    expect(getPlan().routine.some((i) => i.title === "Mask on for the school run")).toBe(false);
  });

  it("sends the wake time and lists day-sheet items with and without notes", async () => {
    const fetchMock = mockAi({
      daysheet: {
        items: [
          { time: "06:15", title: "Check the AQI", note: "" },
          { time: "07:00", title: "Purifier on high", note: "Before the morning peak" },
        ],
        reasoning: "r",
      },
    });
    renderPanel(RoutinePanel, makePlan());
    change("You wake at", "06:15");
    fireEvent.click(screen.getByRole("button", { name: /write it/i }));
    const sheet = await screen.findByTestId("daysheet");
    expect(lastBody(fetchMock)).toMatchObject({ wakeTime: "06:15" });
    expect(within(sheet).getByText(/Before the morning peak/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /again/i })).toBeTruthy();
  });

  it("offers a retry when the day-sheet cannot be written", async () => {
    const fetchMock = mockAi({});
    renderPanel(RoutinePanel, makePlan());
    fireEvent.click(screen.getByRole("button", { name: /write it/i }));
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("says so when there is no routine", () => {
    renderPanel(RoutinePanel, { ...makePlan(), routine: [] });
    expect(screen.getByText(/no routine items yet/i)).toBeTruthy();
  });
});

describe("AssistantPanel", () => {
  it("sends a typed question with recent history, then applies and dismisses proposals", async () => {
    const fetchMock = mockAi({
      chat: {
        reply: "Two changes would help.",
        reasoning: "r",
        proposals: [
          { type: "addMeasure", label: "Seal the balcony door", category: "sealing", why: "w" },
          {
            type: "addRoutineItem",
            time: "18:00",
            title: "Close up before the evening peak",
            why: "w",
            category: "sealing",
          },
          { type: "adoptMeasure", measureId: "not-a-measure", why: "w" },
        ],
      },
    });
    const { getPlan } = renderPanel(AssistantPanel, makePlan());
    const send = screen.getByRole("button", { name: /^send$/i });
    expect(send).toBeDisabled();
    change("Your question", "  What helps tonight?  ");
    fireEvent.click(send);
    await screen.findByTestId("chat-assistant");
    expect(lastBody(fetchMock)).toMatchObject({ message: "What helps tonight?", history: [] });
    expect((screen.getByLabelText("Your question") as HTMLInputElement).value).toBe("");

    const proposals = screen.getAllByTestId("proposal");
    expect(proposals.map((p) => p.querySelector("p")?.textContent)).toEqual([
      "Suggested change: Add measure: Seal the balcony door",
      "Suggested change: Add reminder at 18:00: Close up before the evening peak",
      "Suggested change: Mark done: a measure",
    ]);

    fireEvent.click(within(proposals[1]!).getByRole("button", { name: /^apply/i }));
    expect(getPlan().routine.some((i) => i.title === "Close up before the evening peak")).toBe(
      true,
    );
    fireEvent.click(
      within(screen.getAllByTestId("proposal")[0]!).getByRole("button", { name: /^dismiss/i }),
    );
    expect(getPlan().measures.some((m) => m.label === "Seal the balcony door")).toBe(false);
    expect(screen.getAllByTestId("proposal")).toHaveLength(1);
  });

  it("does not send an empty question", () => {
    const fetchMock = mockAi({});
    renderPanel(AssistantPanel, makePlan());
    fireEvent.submit(screen.getByLabelText("Your question").closest("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when the built-in planner answered, and why", async () => {
    mockAi(
      { chat: { reply: "Keep windows shut.", reasoning: "r", proposals: [] } },
      { source: "fallback", fallbackReason: "provider-error" },
    );
    renderPanel(AssistantPanel, makePlan());
    fireEvent.click(screen.getAllByRole("button", { name: /first today/i })[0]!);
    expect(await screen.findByText(/AI model was unavailable/i)).toBeTruthy();
  });

  it("says when input was sanitised before it reached the model", async () => {
    mockAi(
      { chat: { reply: "ok", reasoning: "r", proposals: [] } },
      { sanitized: true, cached: true },
    );
    renderPanel(AssistantPanel, makePlan());
    fireEvent.click(screen.getAllByRole("button", { name: /first today/i })[0]!);
    expect(await screen.findByTestId("ai-sanitized")).toBeTruthy();
    expect(screen.getByText(/instant repeat/i)).toBeTruthy();
  });

  it("shows an error when the assistant cannot be reached", async () => {
    mockAi({});
    renderPanel(AssistantPanel, makePlan());
    fireEvent.click(screen.getAllByRole("button", { name: /first today/i })[0]!);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("ExposurePanel", () => {
  it("exports the exposure table as CSV", () => {
    const click = stubDownloads();
    renderPanel(ExposurePanel, makePlan());
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(click).toHaveBeenCalled();
  });

  it.each([
    ["blank", ""],
    ["negative", "-5"],
  ])("ignores a %s PM2.5 value", (_name, value) => {
    const { getPlan } = renderPanel(ExposurePanel, makePlan());
    const before = getPlan().air.averagePm25;
    const input = screen.getByLabelText(/Set today's average PM2.5/i);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(getPlan().air.averagePm25).toBe(before);
    expect((input as HTMLInputElement).value).toBe(String(before));
  });

  it("does nothing on blur when the value was not edited", () => {
    const { getPlan } = renderPanel(ExposurePanel, makePlan());
    fireEvent.blur(screen.getByLabelText(/Set today's average PM2.5/i));
    expect(getPlan().air.source).toBe("model");
  });

  it("offers a retry when the review cannot be fetched", async () => {
    const fetchMock = mockAi({});
    renderPanel(ExposurePanel, makePlan());
    fireEvent.click(screen.getByRole("button", { name: /review my exposure/i }));
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("OverviewPanel", () => {
  it("prints the plan", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    renderPanel(OverviewPanel, makePlan());
    fireEvent.click(screen.getByRole("button", { name: /print this page/i }));
    expect(print).toHaveBeenCalled();
  });

  it("celebrates when every measure is adopted", () => {
    const plan = makePlan();
    renderPanel(OverviewPanel, {
      ...plan,
      measures: plan.measures.map((m) => ({ ...m, status: "done" as const })),
    });
    expect(screen.getByText(/every measure in your plan is adopted/i)).toBeTruthy();
  });

  it("shows the tailoring progress and failure states", () => {
    const onRetry = vi.fn();
    render(
      <AnnouncerProvider>
        <OverviewPanel
          plan={makePlan()}
          today="2026-11-22"
          dispatch={() => {}}
          personalizing
          personalizeError="Vayu ran into a problem."
          onRetry={onRetry}
        />
      </AnnouncerProvider>,
    );
    expect(screen.getByText(/tailoring your plan/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
