// Services / extra charges on sales orders and offers. The name is free text; these are only suggestions.
// Old rows (made before names became free text) hold one of the legacy codes below.
const LEGACY: Record<string, string> = {
  STEEL: "أعمال حديد",
  ELECTRIC: "أعمال كهرباء",
  INSTALL: "تركيب",
  MOVING: "نقل وتحميل",
};

export const DEFAULT_SERVICES = ["توصيل", "تركيب", "صيانة", "ضمان ممتد", "تغليف", "تدريب", "استشارة", "رسوم إضافية"];

export const serviceLabel = (name: string): string => LEGACY[name] ?? name;

/** Suggestions = names already used on existing rows (newest habits first) + the defaults. */
export function serviceSuggestions(used: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const name of used) {
    const label = serviceLabel(name).trim();
    if (label) seen.add(label);
  }
  for (const name of DEFAULT_SERVICES) seen.add(name);
  return [...seen];
}
