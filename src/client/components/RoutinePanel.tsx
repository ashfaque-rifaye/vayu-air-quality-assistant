import { useState, type FormEvent } from "react";
import { CalendarPlus, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { buildAirContext, profileForAi } from "../../shared/plan-context";
import { groupRoutine } from "../../shared/routine";
import { routineToIcs } from "../../shared/exports";
import { MEASURE_SHORT_LABELS } from "../../shared/knowledge";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiBadge, ErrorNote, Field, Loading, Why } from "./ui";

export default function RoutinePanel({ plan, dispatch }: PanelProps) {
  const announce = useAnnounce();
  const { state, run } = useAi("daysheet");
  const [wakeTime, setWakeTime] = useState("07:00");
  const [newTime, setNewTime] = useState("12:00");
  const [newTitle, setNewTitle] = useState("");
  const groups = groupRoutine(plan.routine);
  const { language } = plan.profile;

  async function makeDaySheet(): Promise<void> {
    const envelope = await run({
      profile: profileForAi(plan.profile),
      air: buildAirContext(plan.air),
      wakeTime,
    });
    if (envelope) {
      dispatch({ type: "setDaySheet", items: envelope.data.items });
      announce("Day-sheet ready");
    }
  }

  function addItem(event: FormEvent): void {
    event.preventDefault();
    if (!newTitle.trim()) return;
    dispatch({ type: "addRoutineItem", time: newTime, title: newTitle, source: "you" });
    announce(`Added reminder at ${newTime}`);
    setNewTitle("");
  }

  return (
    <div className="stack">
      <h2 className="sr-only">Routine</h2>

      <section className="card" aria-labelledby="routine-title">
        <div className="card-heading">
          <h3 id="routine-title">Your low-emission day</h3>
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => {
                dispatch({ type: "regenerateRoutine" });
                announce("Routine rebuilt from the forecast");
              }}
            >
              <RefreshCw aria-hidden="true" size={16} /> Rebuild
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                downloadText(
                  `${slugify(plan.profile.household)}-routine.ics`,
                  routineToIcs(plan, new Date().toISOString()),
                  "text/calendar",
                );
                announce("Calendar downloaded");
              }}
            >
              <CalendarPlus aria-hidden="true" size={16} /> Add to calendar
            </button>
          </div>
        </div>
        <p className="muted">
          Built from today's hour-by-hour smog forecast and your routine. Rebuild after you change
          the air or your habits.
        </p>

        {groups.length === 0 ? (
          <p className="empty-note">No routine items yet. Rebuild to generate them.</p>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="routine-group">
              <h4>{group.label}</h4>
              <ul className="routine-list">
                {group.items.map((item) => (
                  <li key={item.id} className="routine-item">
                    <span className="routine-time">{item.time}</span>
                    <div className="routine-body">
                      <p>
                        <span className={`chip-tag chip-${item.category}`}>
                          {MEASURE_SHORT_LABELS[item.category]}
                        </span>
                        <strong lang={item.source === "auto" ? undefined : language}>
                          {item.title}
                        </strong>
                      </p>
                      {item.why ? <p className="muted">{item.why}</p> : null}
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${item.title}`}
                      onClick={() => {
                        dispatch({ type: "removeRoutineItem", id: item.id });
                        announce("Reminder removed");
                      }}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        <form className="inline-form routine-add" onSubmit={addItem}>
          <Field id="routine-new-time" label="Time">
            <input
              id="routine-new-time"
              type="time"
              value={newTime}
              onChange={(event) => setNewTime(event.target.value)}
            />
          </Field>
          <Field id="routine-new-title" label="Add your own reminder">
            <input
              id="routine-new-title"
              type="text"
              maxLength={160}
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
            />
          </Field>
          <button type="submit" className="button" disabled={!newTitle.trim()}>
            <Plus aria-hidden="true" size={16} /> Add
          </button>
        </form>
      </section>

      <section className="card card-ai" aria-labelledby="daysheet-title">
        <div className="card-heading">
          <h3 id="daysheet-title">
            <Sparkles aria-hidden="true" size={18} /> AI smog day-sheet
          </h3>
          <div className="inline-form">
            <Field id="wake-time" label="You wake at">
              <input
                id="wake-time"
                type="time"
                value={wakeTime}
                onChange={(event) => setWakeTime(event.target.value)}
              />
            </Field>
            <button
              type="button"
              className="button button-primary"
              disabled={state.status === "loading"}
              onClick={() => void makeDaySheet()}
            >
              <Sparkles aria-hidden="true" size={16} />{" "}
              {plan.daySheet.length > 0 ? "Again" : "Write it"}
            </button>
          </div>
        </div>
        <div aria-live="polite">
          {state.status === "loading" ? <Loading>Vayu is writing your day-sheet…</Loading> : null}
          {state.status === "error" ? (
            <ErrorNote message={state.message} onRetry={() => void makeDaySheet()} />
          ) : null}
          {plan.daySheet.length > 0 ? (
            <div data-testid="daysheet">
              {state.status === "success" ? <AiBadge meta={state.envelope} /> : null}
              {state.status === "success" ? (
                <Why text={state.envelope.data.reasoning} language={language} />
              ) : null}
              <ol className="daysheet-list">
                {plan.daySheet.map((item) => (
                  <li key={`${item.time}-${item.title}`}>
                    <span className="routine-time">{item.time}</span>
                    <div>
                      <strong lang={language}>{item.title}</strong>
                      {item.note ? <span className="muted"> — {item.note}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
