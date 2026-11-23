import type { Language } from "./schemas.js";

/** Display names, also used to instruct the model which language to write in. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  hi: "Hindi",
  ur: "Urdu",
  bn: "Bengali",
  ta: "Tamil",
  pa: "Punjabi",
};

/** Urdu is written right-to-left; the rest of the supported set is left-to-right. */
export function textDirection(language: Language): "ltr" | "rtl" {
  return language === "ur" ? "rtl" : "ltr";
}
