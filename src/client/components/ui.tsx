/**
 * Small shared UI pieces. The provenance badge and the "Why" note are the two
 * places the AI explains itself, and every AI output in the app uses them.
 */
import type { ReactNode } from "react";
import { Cpu, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { textDirection } from "../../shared/languages";
import type { AiEnvelopeMeta, AiFeatureName } from "../../shared/contracts";
import type { AiSource, Language } from "../../shared/schemas";
import type { AiState } from "../lib/use-ai";

const SOURCE_LABEL: Record<AiSource, string> = {
  gemini: "AI · Gemini",
  fireworks: "AI · Fireworks",
  fallback: "Offline planner",
};

const FALLBACK_REASON: Record<NonNullable<AiEnvelopeMeta["fallbackReason"]>, string> = {
  "not-configured": "No AI key is configured, so the built-in planner answered.",
  "rate-limited": "You hit the AI usage limit for now, so the built-in planner answered.",
  "provider-error": "The AI model was unavailable, so the built-in planner answered.",
};

/** Names who actually answered, so the AI/rules split is visible, not asserted. */
export function AiBadge({
  meta,
}: {
  meta: Pick<AiEnvelopeMeta, "source"> & Partial<AiEnvelopeMeta>;
}) {
  const isAi = meta.source !== "fallback";
  return (
    <span className="badge-row">
      <span className={`badge ${isAi ? "badge-ai" : "badge-offline"}`} data-testid="ai-source">
        {isAi ? <Sparkles aria-hidden="true" size={14} /> : <Cpu aria-hidden="true" size={14} />}
        {SOURCE_LABEL[meta.source]}
      </span>
      {meta.sanitized ? (
        <span className="badge badge-shield" data-testid="ai-sanitized">
          <ShieldCheck aria-hidden="true" size={14} />
          Input sanitised
        </span>
      ) : null}
      {meta.cached ? <span className="badge badge-muted">Instant repeat</span> : null}
      {meta.fallbackReason ? (
        <span className="badge-note">{FALLBACK_REASON[meta.fallbackReason]}</span>
      ) : null}
    </span>
  );
}

export function Why({ text, language }: { text: string; language?: Language }) {
  return (
    <p className="why" {...(language ? { lang: language, dir: textDirection(language) } : {})}>
      <strong>Why: </strong>
      {text}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled select over a fixed set of values, each shown by its human label. */
export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  labels,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  labels: Readonly<Record<T, string>>;
  onChange: (value: T) => void;
  hint?: string;
}) {
  return (
    <Field id={id} label={label} {...(hint ? { hint } : {})}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        {...describedBy(id, { hint: Boolean(hint) })}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** ARIA wiring for an input inside {@link Field}. */
export function describedBy(id: string, options: { hint?: boolean; error?: string | undefined }) {
  const ids = [options.hint ? `${id}-hint` : "", options.error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    ...(ids ? { "aria-describedby": ids } : {}),
    ...(options.error ? { "aria-invalid": true as const } : {}),
  };
}

export function ProgressBar({
  value,
  label,
  tone = "default",
}: {
  value: number;
  label: string;
  tone?: "default" | "danger";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`progress${tone === "danger" ? " progress-danger" : ""}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="progress-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** A single value on a ring: one number, so the ring reads as progress, not parts. */
export function ProgressRing({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className="ring"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="ring-track" cx="60" cy="60" r={radius} />
        <circle
          className="ring-fill"
          cx="60"
          cy="60"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <span className="ring-value" aria-hidden="true">
        {Math.round(clamped)}
        <small>%</small>
      </span>
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="stat">
      <dt>
        {Icon ? <Icon aria-hidden="true" size={15} /> : null}
        {label}
      </dt>
      <dd>
        <span className="stat-value">{value}</span>
        {detail ? <span className="stat-detail">{detail}</span> : null}
      </dd>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="callout callout-danger" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * The state of one AI request, in a polite live region: a spinner while it runs,
 * the error (with a retry when one is offered), and who answered once it has.
 */
export function AiStatus<F extends AiFeatureName>({
  state,
  loading,
  onRetry,
  showSource = true,
}: {
  state: AiState<F>;
  loading: string;
  onRetry?: () => void;
  showSource?: boolean;
}) {
  return (
    <div aria-live="polite">
      {state.status === "loading" ? <Loading>{loading}</Loading> : null}
      {state.status === "error" ? (
        <ErrorNote message={state.message} {...(onRetry ? { onRetry } : {})} />
      ) : null}
      {showSource && state.status === "success" ? <AiBadge meta={state.envelope} /> : null}
    </div>
  );
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  );
}

const AQI_LEVEL_TONE: Record<string, string> = {
  good: "good",
  moderate: "moderate",
  sensitive: "sensitive",
  unhealthy: "unhealthy",
  "very-unhealthy": "very-unhealthy",
  hazardous: "hazardous",
};

/** A coloured pill showing an AQI value and its band, used across the app. */
export function AqiPill({ aqi, level, label }: { aqi: number; level: string; label: string }) {
  return (
    <span className={`aqi-pill aqi-${AQI_LEVEL_TONE[level] ?? "moderate"}`} data-testid="aqi-pill">
      <strong>AQI {aqi}</strong>
      <span>{label}</span>
    </span>
  );
}
