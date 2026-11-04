/**
 * Diagram Studio themes (Phase 1): deliverable framing, not renderer
 * surgery. Each theme sets the PNG background + studio chrome while the
 * Sequence/System renderers keep their own proven palettes. Renderer-level
 * recoloring is a later phase; themes never reach into renderer internals.
 */

export interface StudioTheme {
  id: string;
  name: string;
  blurb: string;
  /** PNG export background. */
  background: string;
  /** Studio card chrome around previews. */
  card: string;
  accentText: string;
}

export const STUDIO_THEMES: StudioTheme[] = [
  {
    id: "premium-light",
    name: "Premium light",
    blurb: "Warm paper background for client decks",
    background: "#FFFFFF",
    card: "bg-white",
    accentText: "text-[#9A7653]",
  },
  {
    id: "studio-cream",
    name: "Studio cream",
    blurb: "GRAVENX canvas tone, soft on projectors",
    background: "#FAF8F2",
    card: "bg-[#FAF8F2]",
    accentText: "text-[#9A7653]",
  },
  {
    id: "ink",
    name: "Ink",
    blurb: "Dark frame for architecture reviews",
    background: "#27241F",
    card: "bg-[#27241F]",
    accentText: "text-[#C9A86A]",
  },
];

export function studioTheme(id: string): StudioTheme {
  return STUDIO_THEMES.find((t) => t.id === id) ?? STUDIO_THEMES[0];
}
