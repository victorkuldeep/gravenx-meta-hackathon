/**
 * Wireframe icon set - Lucide glyphs plus two vendored brand marks.
 *
 * UI glyphs render from the `lucide-react` package (ISC, see
 * THIRD_PARTY_NOTICES.md) via static imports so bundlers tree-shake to only
 * the glyphs below. Brand marks (GitHub Octicons MIT, LinkedIn Simple Icons
 * CC0) are still vendored path data - Lucide no longer ships brand icons.
 */

export interface WireBrandEl {
  tag: "path";
  d: string;
}

export interface WireBrandDef {
  label: string;
  viewBox: string;
  els: WireBrandEl[];
}

/** Canvas icon name -> Lucide export. Kebab in the model, Pascal in code. */
export const WIRE_UI_ICONS: Record<string, { label: string; lucide: string }> = {
  menu: { label: "Menu", lucide: "Menu" },
  x: { label: "Close", lucide: "X" },
  plus: { label: "Plus", lucide: "Plus" },
  check: { label: "Check", lucide: "Check" },
  "chevron-right": { label: "Chevron right", lucide: "ChevronRight" },
  "chevron-down": { label: "Chevron down", lucide: "ChevronDown" },
  "arrow-right": { label: "Arrow right", lucide: "ArrowRight" },
  search: { label: "Search", lucide: "Search" },
  bell: { label: "Notification", lucide: "Bell" },
  user: { label: "User", lucide: "User" },
  home: { label: "Home", lucide: "Home" },
  sliders: { label: "Settings", lucide: "SlidersHorizontal" },
  trash: { label: "Delete", lucide: "Trash2" },
  eye: { label: "View", lucide: "Eye" },
  star: { label: "Star", lucide: "Star" },
  heart: { label: "Favorite", lucide: "Heart" },
  mail: { label: "Mail", lucide: "Mail" },
  book: { label: "Book", lucide: "BookOpen" },
  lock: { label: "Lock", lucide: "Lock" },
  globe: { label: "Globe", lucide: "Globe" },
  calendar: { label: "Calendar", lucide: "Calendar" },
  clock: { label: "Clock", lucide: "Clock" },
  pin: { label: "Location", lucide: "MapPin" },
  download: { label: "Download", lucide: "Download" },
  upload: { label: "Upload", lucide: "Upload" },
  filter: { label: "Filter", lucide: "Filter" },
  cart: { label: "Cart", lucide: "ShoppingCart" },
  info: { label: "Info", lucide: "Info" },
  alert: { label: "Warning", lucide: "TriangleAlert" },
  refresh: { label: "Refresh", lucide: "RefreshCw" },
};

export const WIRE_BRANDS: Record<string, WireBrandDef> = {
  github: {
    label: "GitHub",
    viewBox: "0 0 24 24",
    els: [
      {
        tag: "path",
        d: "M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943",
      },
    ],
  },
  linkedin: {
    label: "LinkedIn",
    viewBox: "0 0 34 34",
    els: [
      {
        tag: "path",
        d: "M34 2.5v29a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 0 31.5v-29A2.5 2.5 0 0 1 2.5 0h29A2.5 2.5 0 0 1 34 2.5M10 13H5v16h5zm.45-5.5a2.88 2.88 0 0 0-2.86-2.9H7.5a2.9 2.9 0 0 0 0 5.8 2.88 2.88 0 0 0 2.95-2.81zM29 19.28c0-4.81-3.06-6.68-6.1-6.68a5.7 5.7 0 0 0-5.06 2.58h-.14V13H13v16h5v-8.51a3.32 3.32 0 0 1 3-3.58h.19c1.59 0 2.77 1 2.77 3.52V29h5z",
      },
    ],
  },
};

export const WIRE_ICONS: Record<string, { label: string }> = Object.fromEntries([
  ...Object.entries(WIRE_UI_ICONS).map(([name, d]) => [name, { label: d.label }]),
  ...Object.entries(WIRE_BRANDS).map(([name, d]) => [name, { label: d.label }]),
]);

export function wireIconNames(): string[] {
  return Object.keys(WIRE_ICONS);
}

export function isWireBrand(name: string): boolean {
  return name in WIRE_BRANDS;
}

export function wireBrandDef(name: string): WireBrandDef {
  return WIRE_BRANDS[name] ?? WIRE_BRANDS.linkedin;
}
