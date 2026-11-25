import { lazy, Suspense, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { ArrowLeft, ShieldCheck, Wind } from "lucide-react";
import { AnnouncerProvider } from "./lib/announcer";
import { parseRoute, type Route } from "./lib/route";
import type { PlanStore } from "./lib/plan-store";
import type { Plan } from "../shared/schemas";
import { HomePage } from "./components/HomePage";

// The workspace is most of the UI code, so the first screen does not pay for it.
const PlanWorkspace = lazy(() =>
  import("./components/PlanWorkspace").then((module) => ({ default: module.PlanWorkspace })),
);

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function PlanNotFound() {
  return (
    <div className="empty-state container">
      <h1>We could not find that plan</h1>
      <p>Plans are stored in the browser where they were made. It may be in another one.</p>
      <a className="button button-primary" href="#/">
        Back to home
      </a>
    </div>
  );
}

/** What the current route shows: home, a plan, or an explanation when the plan is missing. */
function Screen({
  route,
  plan,
  plans,
  store,
}: {
  route: Route;
  plan: Plan | undefined;
  plans: readonly Plan[];
  store: PlanStore;
}) {
  if (route.name === "home") return <HomePage store={store} plans={plans} />;
  if (!plan) return <PlanNotFound />;
  return (
    <Suspense fallback={<p role="status">Opening your plan…</p>}>
      <PlanWorkspace plan={plan} tab={route.tab} store={store} />
    </Suspense>
  );
}

export function App({ store }: { store: PlanStore }) {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  const route = useMemo(() => parseRoute(hash), [hash]);
  const plans = useSyncExternalStore(store.subscribe, store.getPlans);
  const plan =
    route.name === "plan" ? plans.find((candidate) => candidate.id === route.planId) : undefined;
  const mainRef = useRef<HTMLElement>(null);
  const screen = route.name === "plan" ? route.planId : "home";

  useEffect(() => {
    document.title = plan ? `${plan.profile.household} | Vayu` : "Vayu, your clean-air assistant";
  }, [plan]);

  // A hash change is invisible to assistive tech, so move focus to the new screen
  // (but not on first load, where the browser's default is right).
  const previousScreen = useRef(screen);
  useEffect(() => {
    if (previousScreen.current !== screen) {
      previousScreen.current = screen;
      mainRef.current?.focus();
      window.scrollTo?.(0, 0);
    }
  }, [screen]);

  return (
    <AnnouncerProvider>
      <a className="skip-link" href="#main" onClick={() => mainRef.current?.focus()}>
        Skip to main content
      </a>
      <header className="site-header">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            <Wind size={18} />
          </span>
          <span>Vayu</span>
        </a>
        <p className="site-tagline">Breathe through the smog</p>
        {route.name === "plan" ? (
          <a className="button button-quiet header-link" href="#/">
            <ArrowLeft aria-hidden="true" size={16} />
            All households
          </a>
        ) : null}
      </header>
      <main id="main" ref={mainRef} tabIndex={-1} className="site-main">
        <Screen route={route} plan={plan} plans={plans} store={store} />
      </main>
      <footer className="site-footer">
        <p>
          <ShieldCheck aria-hidden="true" size={16} />
          Your plan stays in this browser. Vayu only sends the AI what it needs, and never your
          household members&apos; names.
        </p>
      </footer>
    </AnnouncerProvider>
  );
}
