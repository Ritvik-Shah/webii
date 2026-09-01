// The island as a place: where the land is, where you can build, and what
// you can put there.
//
// Everything lives in a 0-100 coordinate space on both axes, so the screen
// can be any size and the map is still the same map. The sea and the land
// are drawn from these numbers too, which is why the plots always sit on
// grass and the beach always sits on sand.

/** The grassy part of the island, as an ellipse. */
/* The map is drawn stretched to fill its box, so these radii are chosen to
   come out roughly round on the wide panel-less area a TV gives it, rather
   than to be round in these coordinates. */
export const GRASS = { cx: 50, cy: 50, rx: 33, ry: 45 };
/** The sand ring around it. */
export const SAND = { cx: 50, cy: 51, rx: 38, ry: 50 };
/** Everyone walks the ring road; the spokes join the plots to it. */
export const RING = { cx: 50, cy: 47, rx: 21, ry: 28 };

export interface Plot {
  id: string;
  x: number;
  y: number;
  /** Where a Mii stands when visiting: just in front of the door. */
  doorY: number;
}

/**
 * Thirteen places to build. Fixed rather than free-form: a TV pointer is a
 * blunt instrument, and a town that always has the same shape is much
 * easier to read across the room than one the player has arranged.
 */
export const PLOTS: Plot[] = [
  // Laid out on two rings around the park, and checked against the grass
  // ellipse -- a plot whose doorstep falls outside the land is a building
  // no Mii can ever walk to, which is exactly what the first hand-placed
  // layout produced.
  // Far enough down that the tallest building on the island still has
  // room for its roof and its sign above it.
  { id: "p-apartments", x: 50, y: 24, doorY: 28 },
  { id: "p-townhall", x: 31.3, y: 30.1, doorY: 34.1 },
  { id: "p-foodmart", x: 68.7, y: 30.1, doorY: 34.1 },
  { id: "p-interior", x: 25.6, y: 51.2, doorY: 55.2 },
  { id: "p-clothing", x: 74.4, y: 51.2, doorY: 55.2 },
  { id: "p-park", x: 50, y: 41.9, doorY: 45.9 },
  { id: "p-cafe", x: 39, y: 43.9, doorY: 47.9 },
  { id: "p-tower", x: 61, y: 43.9, doorY: 47.9 },
  { id: "p-news", x: 30.6, y: 65.3, doorY: 69.3 },
  { id: "p-fountain", x: 69.4, y: 65.3, doorY: 69.3 },
  { id: "p-concert", x: 50, y: 64.4, doorY: 68.4 },
  { id: "p-amusement", x: 39.8, y: 76.2, doorY: 80.2 },
  { id: "p-beach", x: 61.9, y: 76, doorY: 80 },
];

export const PLOT_BY_ID = new Map(PLOTS.map((p) => [p.id, p]));

/**
 * Somebody standing or walking on the map. Kept here, with the geography,
 * rather than in the simulation: it is a position on this island, and it
 * lets the island's own state hold walkers without the movement code and
 * the rules code having to import each other.
 */
export interface Walker {
  x: number;
  y: number;
  /** Where they are headed. */
  tx: number;
  ty: number;
  /** 1 facing right, -1 facing left. */
  facing: 1 | -1;
  state: "walk" | "idle";
  /** Seconds left standing still. */
  hold: number;
  /** Building they are visiting, if any. */
  at: string | null;
  /** Island time before which they will not strike up a conversation, so
   * two Miis loitering in the same spot don't talk continuously. */
  quietUntil: number;
  /** Small per-Mii variation, so a crowd doesn't move as one. */
  pace: number;
}

export interface BuildingType {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  /** Cost to put up. Upgrades cost this again, times the new level. */
  cost: number;
  /** Wall and roof colours. */
  wall: string;
  roof: string;
  /** Which plot it goes on -- one building per plot, so the town reads the
   * same way every time. */
  plot: string;
  /** Standing there does something for a bored Mii. */
  leisure?: boolean;
  /** Requirements, all of which must be met before it can be built. */
  needsResidents?: number;
  needsBuilding?: string;
  needsLevel?: number;
  /** Present from the start -- an island with nowhere to live isn't one. */
  founding?: boolean;
  /** How tall to draw it, in px at the base zoom. */
  height?: number;
}

export const BUILDINGS: BuildingType[] = [
  {
    id: "apartments",
    name: "Mii Apartments",
    icon: "🏢",
    blurb: "Everyone lives here. Upgrading adds rooms.",
    cost: 220,
    wall: "#f2e3c8",
    roof: "#c0563f",
    plot: "p-apartments",
    founding: true,
    height: 96,
  },
  {
    id: "townhall",
    name: "Town Hall",
    icon: "🏛️",
    blurb: "Who lives here, and how the island is doing.",
    cost: 180,
    wall: "#eceff4",
    roof: "#5b7fa6",
    plot: "p-townhall",
    founding: true,
    height: 74,
  },
  {
    id: "foodmart",
    name: "Food Mart",
    icon: "🛒",
    blurb: "Stocks the pantry. Cheaper as it grows.",
    cost: 90,
    wall: "#fdf3dd",
    roof: "#3f8f5c",
    plot: "p-foodmart",
    height: 62,
  },
  {
    id: "park",
    name: "The Park",
    icon: "🌳",
    blurb: "Somewhere to be bored in comfort.",
    cost: 70,
    wall: "#cfe8bf",
    roof: "#4a8f3c",
    plot: "p-park",
    leisure: true,
    height: 40,
  },
  {
    id: "clothing",
    name: "Clothing Shop",
    icon: "👕",
    blurb: "Something new to wear.",
    cost: 130,
    wall: "#fbe6ef",
    roof: "#c0508f",
    plot: "p-clothing",
    needsResidents: 2,
    height: 64,
  },
  {
    id: "interior",
    name: "Interior Shop",
    icon: "🛋️",
    blurb: "Wallpaper, mostly.",
    cost: 150,
    wall: "#efe6f7",
    roof: "#7a5bb0",
    plot: "p-interior",
    needsBuilding: "foodmart",
    height: 64,
  },
  {
    id: "cafe",
    name: "Café",
    icon: "☕",
    blurb: "Two Miis, one small table.",
    cost: 170,
    wall: "#f7e9d8",
    roof: "#8a5a35",
    plot: "p-cafe",
    needsBuilding: "park",
    leisure: true,
    height: 58,
  },
  {
    id: "tower",
    name: "Observation Tower",
    icon: "🗼",
    blurb: "See who gets on with whom.",
    cost: 210,
    wall: "#e6ecf2",
    roof: "#c94f3d",
    plot: "p-tower",
    needsResidents: 4,
    leisure: true,
    height: 108,
  },
  {
    id: "concert",
    name: "Concert Hall",
    icon: "🎤",
    blurb: "A Mii sings the song you taught them.",
    cost: 260,
    wall: "#f0e4f7",
    roof: "#6b3fa0",
    plot: "p-concert",
    needsLevel: 3,
    height: 82,
  },
  {
    id: "news",
    name: "Mii News",
    icon: "📰",
    blurb: "What happened while you were out.",
    cost: 160,
    wall: "#eef1f5",
    roof: "#41586e",
    plot: "p-news",
    needsBuilding: "townhall",
    height: 60,
  },
  {
    id: "fountain",
    name: "Wishing Fountain",
    icon: "⛲",
    blurb: "Throw a coin. Hear a wish.",
    cost: 110,
    wall: "#dcecf5",
    roof: "#5f9fc4",
    plot: "p-fountain",
    leisure: true,
    height: 44,
  },
  {
    id: "amusement",
    name: "Amusement Park",
    icon: "🎡",
    blurb: "Lucky bags, and no refunds.",
    cost: 320,
    wall: "#fdeee2",
    roof: "#e0762c",
    plot: "p-amusement",
    needsResidents: 6,
    leisure: true,
    height: 96,
  },
  {
    id: "beach",
    name: "The Beach",
    icon: "🏖️",
    blurb: "Nothing to do, done well.",
    cost: 60,
    wall: "#f7e9c8",
    roof: "#e8b95c",
    plot: "p-beach",
    leisure: true,
    height: 40,
  },
];

export const BUILDING_BY_ID = new Map(BUILDINGS.map((b) => [b.id, b]));
export const BUILDING_BY_PLOT = new Map(BUILDINGS.map((b) => [b.plot, b]));

/** Buildings stop growing here; three sizes is enough to read at a glance. */
export const MAX_BUILDING_LEVEL = 3;

/** How many Miis the apartments hold at each level. Ten from the start so a
 * full room of players always has somewhere to live; the islanders and any
 * children need you to build up. */
export function capacityAt(level: number): number {
  return 10 + 4 * Math.max(0, level - 1);
}

/** Upgrading costs more than putting it up did. */
export function upgradeCost(type: BuildingType, currentLevel: number): number {
  return Math.round(type.cost * (currentLevel + 1) * 0.8);
}

/** A point on the grass that isn't inside anything, for aimless wandering. */
export function wanderPoint(seed: number): { x: number; y: number } {
  const angle = seed * Math.PI * 2;
  const radius = 0.45 + ((seed * 7919) % 1) * 0.45;
  return {
    x: GRASS.cx + Math.cos(angle) * GRASS.rx * radius,
    y: GRASS.cy + Math.sin(angle) * GRASS.ry * radius,
  };
}

/** True if the point is on land -- used to keep wanderers out of the sea. */
export function onLand(x: number, y: number): boolean {
  const dx = (x - GRASS.cx) / GRASS.rx;
  const dy = (y - GRASS.cy) / GRASS.ry;
  return dx * dx + dy * dy <= 1;
}
