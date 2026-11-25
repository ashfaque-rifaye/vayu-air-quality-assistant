import { lazy, Suspense, useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import {
  Clock3,
  Gauge,
  LayoutDashboard,
  Leaf,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { pm25Band, pm25ToAqi } from "../../shared/aqi";
import { todayIso } from "../../shared/dates";
import { computeProtection, scoreLabel, type PlanTab } from "../../shared/insights";
import { buildAirContext, profileForAi } from "../../shared/plan-context";
import type { PlanAction } from "../../shared/plan";
import type { Plan } from "../../shared/schemas";
import type { PlanStore } from "../lib/plan-store";
import { navigate, PLAN_TABS, planHref } from "../lib/route";
import { useAi } from "../lib/use-ai";
import { OverviewPanel } from "./OverviewPanel";
import { AqiPill, ProgressRing } from "./ui";

const TAB_ICONS: Record<PlanTab, LucideIcon> = {
  overview: LayoutDashboard,
  exposure: Gauge,
  routine: Clock3,
  measures: ShieldCheck,
  swaps: Leaf,
  assistant: MessageCircle,
};

const ExposurePanel = lazy(() => import("./ExposurePanel"));
const RoutinePanel = lazy(() => import("./RoutinePanel"));
const MeasuresPanel = lazy(() => import("./MeasuresPanel"));
const SwapsPanel = lazy(() => import("./SwapsPanel"));
const AssistantPanel = lazy(() => import("./AssistantPanel"));

export interface PanelProps {
  plan: Plan;
  today: string;
  dispatch: (action: PlanAction) => void;
}

/**
 * The ARIA tabs keyboard pattern: arrows move and wrap, Home and End jump to the
 * ends. Returns -1 for any other key.
 */
export function tabIndexForKey(key: string, index: number, count: number): number {
  const moves: Record<string, number> = {
    ArrowRight: (index + 1) % count,
    ArrowLeft: (index - 1 + count) % count,
    Home: 0,
    End: count - 1,
  };
  return moves[key] ?? -1;
}

function renderDetailPanel(tab: Exclude<PlanTab, "overview">, props: PanelProps) {
  switch (tab) {
    case "exposure":
      return <ExposurePanel {...props} />;
    case "routine":
      return <RoutinePanel {...props} />;
    case "measures":
      return <MeasuresPanel {...props} />;
    case "swaps":
      return <SwapsPanel {...props} />;
    case "assistant":
      return <AssistantPanel {...props} />;
  }
}

/** The household, today's air and the protection score, at a glance. */
function PlanHero({ plan }: { plan: Plan }) {
  const { profile, air } = plan;
  const band = pm25Band(air.averagePm25);
  const { score } = computeProtection(plan);
  const people = profile.members.length;
  return (
    <div className="plan-hero">
      <div className="container plan-hero-inner">
        <div>
          <p className="hero-eyebrow">
            <MapPin aria-hidden="true" size={16} />
            {profile.city}
          </p>
          <h1>{profile.household}</h1>
          <ul className="plan-facts">
            <li>
              <AqiPill aqi={pm25ToAqi(air.averagePm25)} level={band.level} label={band.label} />
            </li>
            <li>
              <Users aria-hidden="true" size={16} />
              {people} {people === 1 ? "person" : "people"}
            </li>
          </ul>
        </div>
        <div className="plan-hero-score">
          <ProgressRing value={score} label={`Protection score: ${score} of 100`} />
          <span>{scoreLabel(score)}</span>
        </div>
      </div>
    </div>
  );
}

/** One tab. Only the selected tab is in the tab order; arrows move between them. */
function TabButton({
  id,
  label,
  selected,
  register,
  onSelect,
  onKeyDown,
}: {
  id: PlanTab;
  label: string;
  selected: boolean;
  register: (element: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const Icon = TAB_ICONS[id];
  return (
    <button
      ref={register}
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      tabIndex={selected ? 0 : -1}
      className="tab"
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <Icon aria-hidden="true" size={17} />
      {label}
    </button>
  );
}

/**
 * Every new plan gets one AI pass that layers household-specific measures and
 * routine items over the deterministic skeleton. The plan is already usable while
 * this runs. A re-run supersedes the previous request, and it is cached.
 */
function usePersonalization(plan: Plan, dispatch: (action: PlanAction) => void) {
  const { state, run } = useAi("personalize");

  const retry = useCallback(() => {
    void run({ profile: profileForAi(plan.profile), air: buildAirContext(plan.air) }).then(
      (envelope) => {
        if (!envelope) return;
        const { summary, reasoning, measures, routine } = envelope.data;
        dispatch({
          type: "applyPersonalization",
          payload: { summary, reasoning, source: envelope.source, measures, routine },
        });
      },
    );
  }, [plan.profile, plan.air, run, dispatch]);

  useEffect(() => {
    if (!plan.personalization) retry();
  }, [plan.personalization, retry]);

  return { state, retry };
}

export function PlanWorkspace({
  plan,
  tab,
  store,
}: {
  plan: Plan;
  tab: PlanTab;
  store: PlanStore;
}) {
  const today = todayIso();
  const dispatch = useCallback(
    (action: PlanAction) => store.dispatch(plan.id, action),
    [store, plan.id],
  );
  const tabRefs = useRef(new Map<PlanTab, HTMLButtonElement>());
  const { state: personalizeState, retry: tailorPlan } = usePersonalization(plan, dispatch);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const index = PLAN_TABS.findIndex((candidate) => candidate.id === tab);
    const next = PLAN_TABS[tabIndexForKey(event.key, index, PLAN_TABS.length)];
    if (!next) return;
    event.preventDefault();
    navigate(planHref(plan.id, next.id));
    tabRefs.current.get(next.id)?.focus();
  }

  return (
    <div className="workspace" data-level={pm25Band(plan.air.averagePm25).level}>
      <PlanHero plan={plan} />
      <div className="tabs-bar no-print">
        <div className="container">
          <div className="tabs" role="tablist" aria-label="Plan sections">
            {PLAN_TABS.map(({ id, label }) => (
              <TabButton
                key={id}
                id={id}
                label={label}
                selected={tab === id}
                register={(element) => {
                  if (element) tabRefs.current.set(id, element);
                  else tabRefs.current.delete(id);
                }}
                onSelect={() => navigate(planHref(plan.id, id))}
                onKeyDown={onTabKeyDown}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        key={tab}
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="panel container"
      >
        <Suspense fallback={<p role="status">Loading…</p>}>
          {tab === "overview" ? (
            <OverviewPanel
              plan={plan}
              today={today}
              dispatch={dispatch}
              personalizing={personalizeState.status === "loading"}
              personalizeError={
                personalizeState.status === "error" ? personalizeState.message : null
              }
              onRetry={tailorPlan}
            />
          ) : (
            renderDetailPanel(tab, { plan, today, dispatch })
          )}
        </Suspense>
      </div>
    </div>
  );
}
