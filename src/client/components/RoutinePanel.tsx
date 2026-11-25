import { useState, type FormEvent } from "react";
import { CalendarPlus, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { buildAirContext, profileForAi } from "../../shared/plan-context";
import { groupRoutine } from "../../shared/routine";
import { routineToIcs } from "../../shared/exports";
import { MEASURE_SHORT_LABELS } from "../../shared/knowledge";
import type { Language, RoutineItem } from "../../shared/schemas";
import { useAnnounce } from "../lib/announcer";
import { downloadText, slugify } from "../lib/download";
import { useAi } from "../lib/use-ai";
import type { PanelProps } from "./PlanWorkspace";
import { AiStatus, Field, Why } from "./ui";

function RoutineRow({
  item,
  language,
  onRemove,
}: {
  item: RoutineItem;
  language: Language;
  onRemove: () => void;
}) {
  return (
    <li className="routine-item">
      <span className="routine-time">{item.time}</span>
      <div className="routine-body">
        <p>
          <span className={`chip-tag chip-${item.category}`}>
            {MEASURE_SHORT_LABELS[item.category]}
          </span>
          <strong lang={item.source === "auto" ? undefined : language}>{item.title}</strong>
        </p>
        {item.why ? <p className="muted">{item.why}</p> : null}
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${item.title}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" size={16} />
      </button>
    </li>
  );
}

/** A reminder of your own, at a time you choose. */
function AddReminder({ onAdd }: { onAdd: (time: string, title: string) => void }) {
  const [time, setTime] = useState("12:00");
  const [title, setTitle] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd(time, title);
    setTitle("");
  }

  return (
    <form className="inline-form routine-add" onSubmit={submit}>
      <Field id="routine-new-time" label="Time">
        <input
          id="routine-new-time"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </Field>
      <Field id="routine-new-title" label="Add your own reminder">
        <input
          id="routine-new-title"
          type="text"
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <button type="submit" className="button" disabled={!title.trim()}>
        <Plus aria-hidden="true" size={16} /> Add
      </button>
    </form>
  );
}

/** The routine built from today's forecast, by part of the day. */
function RoutineCard({ plan, dispatch }: Pick<PanelProps, "plan" | "dispatch">) {
  const announce = useAnnounce();
  const groups = groupRoutine(plan.routine);

  function exportCalendar(): void {
    downloadText(
      `${slugify(plan.profile.household)}-routine.ics`,
      routineToIcs(plan, new Date().toISOString()),
      "text/calendar",
    );
    announce("Calendar downloaded");
  }

  return (
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
          <button type="button" className="button" onClick={exportCalendar}>
            <CalendarPlus aria-hidden="true" size={16} /> Add to calendar
          </button>
        </div>
      </div>
      <p className="muted">
        Built from today&apos;s hour-by-hour smog forecast and your routine. Rebuild after you
        change the air or your habits.
      </p>

      {groups.length === 0 ? (
        <p className="empty-note">No routine items yet. Rebuild to generate them.</p>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="routine-group">
            <h4>{group.label}</h4>
            <ul className="routine-list">
              {group.items.map((item) => (
                <RoutineRow
                  key={item.id}
                  item={item}
                  language={plan.profile.language}
                  onRemove={() => {
                    dispatch({ type: "removeRoutineItem", id: item.id });
                    announce("Reminder removed");
                  }}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      <AddReminder
        onAdd={(time, title) => {
          dispatch({ type: "addRoutineItem", time, title, source: "you" });
          announce(`Added reminder at ${time}`);
        }}
      />
    </section>
  );
}

/** An AI-written, hour-by-hour sheet for the day, starting from when you wake. */
function DaySheetCard({ plan, dispatch }: Pick<PanelProps, "plan" | "dispatch">) {
  const announce = useAnnounce();
  const { state, run } = useAi("daysheet");
  const [wakeTime, setWakeTime] = useState("07:00");
  const { language } = plan.profile;

  async function makeDaySheet(): Promise<void> {
    const envelope = await run({
      profile: profileForAi(plan.profile),
      air: buildAirContext(plan.air),
      wakeTime,
    });
    if (!envelope) return;
    dispatch({ type: "setDaySheet", items: envelope.data.items });
    announce("Day-sheet ready");
  }

  return (
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
      <AiStatus
        state={state}
        loading="Vayu is writing your day-sheet…"
        onRetry={() => void makeDaySheet()}
      />
      {plan.daySheet.length > 0 ? (
        <div data-testid="daysheet">
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
    </section>
  );
}

export default function RoutinePanel({ plan, dispatch }: PanelProps) {
  return (
    <div className="stack">
      <h2 className="sr-only">Routine</h2>
      <RoutineCard plan={plan} dispatch={dispatch} />
      <DaySheetCard plan={plan} dispatch={dispatch} />
    </div>
  );
}
