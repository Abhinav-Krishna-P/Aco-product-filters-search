/**
 * Maps human color names to hex swatches so the color-swatch filter can
 * auto-detect a value's colour from its name (e.g. "beige" → #f5f5dc).
 *
 * Keys are normalised: lowercased with every non-alphanumeric character
 * stripped, so "Light Brown", "light_brown" and "light-brown" all collapse
 * to "lightbrown". Common misspellings (e.g. "burgandy") are included.
 *
 * When a value's name has no match, detection returns null and the merchant
 * picks the swatch colour manually.
 */

const SWATCH_COLORS: Record<string, string> = {
  // Neutrals
  black: "#000000",
  white: "#ffffff",
  ivory: "#fffff0",
  cream: "#fffdd0",
  offwhite: "#faf9f6",
  gray: "#808080",
  grey: "#808080",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  charcoal: "#36454f",
  silver: "#c0c0c0",
  beige: "#f5f5dc",
  tan: "#d2b48c",
  khaki: "#c3b091",
  nude: "#e3bc9a",

  // Browns
  brown: "#8b4513",
  lightbrown: "#c19a6b",
  darkbrown: "#5c4033",
  chocolate: "#7b3f00",
  coffee: "#6f4e37",
  camel: "#c19a6b",
  taupe: "#483c32",
  bronze: "#cd7f32",
  copper: "#b87333",
  rust: "#b7410e",
  caramel: "#c68e17",
  chestnut: "#954535",
  mocha: "#3c2f2f",

  // Reds / pinks
  red: "#ff0000",
  darkred: "#8b0000",
  crimson: "#dc143c",
  maroon: "#800000",
  burgundy: "#800020",
  burgandy: "#800020", // common misspelling
  wine: "#722f37",
  cherry: "#d2042d",
  scarlet: "#ff2400",
  pink: "#ffc0cb",
  hotpink: "#ff69b4",
  lightpink: "#ffb6c1",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  rose: "#ff007f",
  salmon: "#fa8072",
  coral: "#ff7f50",
  blush: "#de5d83",

  // Oranges / yellows
  orange: "#ffa500",
  darkorange: "#ff8c00",
  peach: "#ffe5b4",
  apricot: "#fbceb1",
  amber: "#ffbf00",
  gold: "#ffd700",
  golden: "#ffd700",
  yellow: "#ffff00",
  lightyellow: "#ffffe0",
  mustard: "#ffdb58",
  lemon: "#fff700",

  // Greens
  green: "#008000",
  darkgreen: "#006400",
  lightgreen: "#90ee90",
  lime: "#00ff00",
  olive: "#808000",
  forestgreen: "#228b22",
  mint: "#98ff98",
  emerald: "#50c878",
  teal: "#008080",
  sage: "#9caf88",
  khakigreen: "#728639",
  seagreen: "#2e8b57",

  // Blues
  blue: "#0000ff",
  darkblue: "#00008b",
  lightblue: "#add8e6",
  navy: "#000080",
  navyblue: "#000080",
  royalblue: "#4169e1",
  skyblue: "#87ceeb",
  babyblue: "#89cff0",
  turquoise: "#40e0d0",
  cyan: "#00ffff",
  aqua: "#00ffff",
  cobalt: "#0047ab",
  denim: "#1560bd",
  indigo: "#4b0082",
  steelblue: "#4682b4",

  // Purples
  purple: "#800080",
  violet: "#8f00ff",
  lavender: "#e6e6fa",
  lilac: "#c8a2c8",
  plum: "#8e4585",
  mauve: "#e0b0ff",
  orchid: "#da70d6",

  // Metals
  metallic: "#b8b8b8",
  platinum: "#e5e4e2",
  rosegold: "#b76e79",
  gunmetal: "#2a3439",

  // Prints / patterns → sensible neutral placeholders
  multicolor: "#cccccc",
  multicolour: "#cccccc",
  multi: "#cccccc",
  natural: "#e8dcc4",
};

/** Normalise a colour name for lookup: lowercase, strip non-alphanumerics. */
function normalizeColorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Detect a hex swatch colour from a value's name.
 * Returns a "#rrggbb" string, or null when the name is not a known colour.
 */
export function detectSwatchColor(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = normalizeColorName(name);
  if (!key) return null;
  return SWATCH_COLORS[key] ?? null;
}
