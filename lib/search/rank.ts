export interface Rankable {
  name: string;
  label: string;
}

/**
 * Relevance-ranked object search: an exact "Contact" query puts Contact first,
 * not ContactEncounterParticipantFeed. API-name matches outrank label matches.
 */
export function rankObjects<T extends Rankable>(
  objects: T[],
  query: string,
  limit = 500
): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return objects.slice(0, limit);

  const scored: { o: T; s: number }[] = [];
  for (const o of objects) {
    const name = o.name.toLowerCase();
    const label = o.label.toLowerCase();
    let s = -1;
    if (name === q) s = 0;
    else if (label === q) s = 1;
    else if (name.startsWith(q)) s = 2;
    else if (label.startsWith(q)) s = 3;
    else if (name.includes(q)) s = 4;
    else if (label.includes(q)) s = 5;
    else continue;
    scored.push({ o, s });
  }
  scored.sort((a, b) => a.s - b.s || a.o.label.localeCompare(b.o.label));
  return scored.slice(0, limit).map((r) => r.o);
}
