/**
 * Take the plan elsewhere: calendar (.ics) for the routine and spreadsheet (.csv)
 * for the exposure breakdown.
 *
 * Both formats are injection surfaces when they contain user or model text, so
 * this module escapes them properly rather than joining strings. Pure, returning
 * text that the UI turns into a download.
 */
import { planExposure } from "./exposure.js";
import type { Plan } from "./schemas.js";

/** RFC 5545 text escaping. */
function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 requires lines of at most 75 octets, folded with a leading space. */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (size + width > 73) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}${pad(total % 60)}00`;
}

/** A timed calendar reminder for each routine item on the plan's day. */
export function routineToIcs(plan: Plan, stamp: string): string {
  const dtstamp = `${stamp.replace(/[-:]/g, "").slice(0, 15)}Z`;
  const date = plan.profile.date.replace(/-/g, "");
  const event = (item: Plan["routine"][number]): string[] => [
    "BEGIN:VEVENT",
    `UID:${plan.id}-${item.id}@vayu.app`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${date}T${item.time.replace(":", "")}00`,
    `DTEND:${date}T${addMinutes(item.time, 15)}`,
    `SUMMARY:${icsText(item.title)}`,
    ...(item.why ? [`DESCRIPTION:${icsText(item.why)}`] : []),
    "END:VEVENT",
  ];

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vayu//Air Quality Assistant//EN",
    "CALSCALE:GREGORIAN",
    ...[...plan.routine].sort((a, b) => a.time.localeCompare(b.time)).flatMap(event),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/**
 * Quote a CSV cell and defuse spreadsheet formula injection: a cell beginning
 * with = + - or @ would run as a formula when opened in Excel or Sheets.
 */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The daily exposure breakdown, segment by segment, with totals. */
export function exposureToCsv(plan: Plan): string {
  const summary = planExposure(plan);
  const rows: (string | number)[][] = [
    [
      "Segment",
      "Place",
      "Hours",
      "Outdoor PM2.5 (ug/m3)",
      "Breathed PM2.5 (ug/m3)",
      "Dose (ug/m3-h)",
    ],
    ...summary.segments.map((s) => [
      s.label,
      s.place,
      s.hours,
      s.outdoorPm25,
      s.effectivePm25,
      s.dose,
    ]),
    ["Total (now)", "", "", "", "", summary.totalDose],
    ["Doing nothing", "", "", "", "", summary.baselineDose],
    ["Fully protected", "", "", "", "", summary.protectedDose],
    ["Safe target", "", "", "", "", summary.targetDose],
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function planToJson(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}
