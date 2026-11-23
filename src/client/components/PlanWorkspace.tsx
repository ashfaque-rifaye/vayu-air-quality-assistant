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
  const { state: personalizeState, run: personalize } = useAi("personalize");

  // Every new plan gets one AI pass that layers household-specific measures and
  // routine items over the deterministic skeleton. The plan is already usable
  // while this runs. A re-run supersedes the previous request, and it is cached.
  const tailorPlan = useCallback(() => {
    void personalize({ profile: profileForAi(plan.profile), air: buildAirContext(plan.air) }).then(
      (envelope) => {
        if (!envelope) return;
        const { summary, reasoning, measures, routine } = envelope.data;
        dispatch({
          type: "applyPersonalization",
          payload: { summary, reasoning, source: envelope.source, measures, routine },
        });
      },
    );
  }, [plan.profile, plan.air, personalize, dispatch]);

  useEffect(() => {
    if (!plan.personalization) tailorPlan();
  }, [plan.personalization, tailorPlan]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const index = PLAN_TABS.findIndex((candidate) => candidate.id === tab);
    const last = PLAN_TABS.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const next = PLAN_TABS[target];
    if (!next) return;
    event.preventDefault();
    navigate(planHref(plan.id, next.id));
    tabRefs.current.get(next.id)?.focus();
  }

  const { profile, air } = plan;
  const band = pm25Band(air.averagePm25);
  const protection = computeProtection(plan);

  return (
    <div className="workspace" data-level={band.level}>
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
                {profile.members.length} {profile.members.length === 1 ? "person" : "people"}
              </li>
            </ul>
          </div>
          <div className="plan-hero-score">
            <ProgressRing
              value={protection.score}
              label={`Protection score: ${protection.score} of 100`}
            />
            <span>{scoreLabel(protection.score)}</span>
          </div>
        </div>
      </div>

      <div className="tabs-bar no-print">
        <div className="container">
          <div className="tabs" role="tablist" aria-label="Plan sections">
            {PLAN_TABS.map(({ id, label }) => {
              const Icon = TAB_ICONS[id];
              return (
                <button
                  key={id}
                  ref={(element) => {
                    if (element) tabRefs.current.set(id, element);
                    else tabRefs.current.delete(id);
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`panel-${id}`}
                  tabIndex={tab === id ? 0 : -1}
                  className="tab"
                  onClick={() => navigate(planHref(plan.id, id))}
                  onKeyDown={onTabKeyDown}
                >
                  <Icon aria-hidden="true" size={17} />
                  {label}
                </button>
              );
            })}
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
