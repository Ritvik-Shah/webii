import type { Mii } from "../../mii/Mii";
import { BUILDS, EYEBROW_STYLES, EYE_STYLES, HAIR_STYLES, HEIGHTS, MOUTH_STYLES } from "../../mii/Mii";
import {
  BUILDINGS,
  BUILDING_BY_ID,
  MAX_BUILDING_LEVEL,
  capacityAt,
  upgradeCost,
  type BuildingType,
  type Walker,
} from "./map";
import {
  CATCHPHRASES,
  FOODS,
  FOOD_BY_ID,
  FRIENDLY_SCENES,
  GIFTS,
  INTERIORS,
  INTERIOR_BY_ID,
  NEWS_FILLER,
  OUTFITS,
  OUTFIT_BY_ID,
  QUARREL_SCENES,
  REACTION_HAPPINESS,
  REACTION_LINES,
  ROMANTIC_SCENES,
  SOLO_SCENES,
  SONGS,
  WISHES,
  fill,
  pick,
  type Reaction,
} from "./content";

// The island itself: who lives here, how they feel about their lunch, and
// how they feel about each other. Deliberately free of React so the whole
// thing can be stepped and asserted on in a plain node script -- every rule
// in this file is exercised that way before it ever reaches a TV.
//
// The model follows Tomodachi Life's shape: a Mii's look decides their
// personality, personality decides who they get along with, food and clothes
// and rooms fill a happiness bar, a full bar is a level and a level is a
// reward, and relationships climb from strangers all the way to a family --
// with the player only ever being asked, never in control.

// ---------------------------------------------------------------------------
// Deterministic hashing. A Mii's tastes must be the same every time the
// island is opened, so preferences are derived, never rolled and stored.
// ---------------------------------------------------------------------------

export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/** Same hash, as a 0..1 number. */
export function unit(...parts: (string | number)[]): number {
  return hash(...parts) / 4294967296;
}

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------

export type PersonalityCategory = "Outgoing" | "Easygoing" | "Confident" | "Independent";

/** The four sub-types under each category, in the order the game lists them. */
export const CATEGORY_TYPES: Record<PersonalityCategory, string[]> = {
  Outgoing: ["Trendsetter", "Entertainer", "Charmer", "Leader"],
  Easygoing: ["Softie", "Optimist", "Buddy", "Dreamer"],
  Confident: ["Designer", "Adventurer", "Brainiac", "Go-Getter"],
  Independent: ["Free Spirit", "Artist", "Lone Wolf", "Thinker"],
};

export const TYPE_BLURBS: Record<string, string> = {
  Trendsetter: "Wants to be looked at, and will make sure of it.",
  Entertainer: "Runs at one speed. That speed is loud.",
  Charmer: "Falls in love constantly and sincerely every time.",
  Leader: "Organises everyone, invited or not.",
  Softie: "Cries at adverts. Would help anyone.",
  Optimist: "Cheerful past the point of reason. Levels up fast.",
  Buddy: "Gets on with absolutely everybody.",
  Dreamer: "Somewhere else, mostly. Happy there.",
  Designer: "Has views on your curtains.",
  Adventurer: "Bored easily, which is how the trouble starts.",
  Brainiac: "Will explain it to you. At length.",
  "Go-Getter": "Decides what they want and goes and gets it.",
  "Free Spirit": "No pattern. None. Do not look for one.",
  Artist: "Moody, and needs the room to match.",
  "Lone Wolf": "Will decline. Politely, the first time.",
  Thinker: "Slow to warm up, then never cools down.",
};

/** The five sliders a Mii's face and build feed into, each 0-4. */
export interface Personality {
  category: PersonalityCategory;
  type: string;
  movement: number;
  speech: number;
  expression: number;
  attitude: number;
  overall: number;
}

function slot(options: string[], value: string, scale = 4): number {
  const index = Math.max(0, options.indexOf(value));
  return Math.round((index / Math.max(1, options.length - 1)) * scale);
}

/**
 * A Mii's personality, derived entirely from how they were made -- the same
 * bargain the real game strikes, where the choices in the editor quietly
 * decide who this person turns out to be.
 */
export function personalityFor(mii: Mii): Personality {
  const movement = Math.round((slot(BUILDS, mii.build) + slot(HEIGHTS, mii.height)) / 2);
  const speech = slot(MOUTH_STYLES, mii.mouthStyle);
  const expression = Math.round((slot(EYE_STYLES, mii.eyeStyle) + slot(EYEBROW_STYLES, mii.eyebrowStyle)) / 2);
  const attitude = slot(HAIR_STYLES, mii.hairStyle);
  const overall = Math.floor(unit("overall", mii.id, mii.name) * 5);

  const social = movement + speech;
  const assertive = attitude + expression;
  const category: PersonalityCategory =
    social >= 4 ? (assertive >= 4 ? "Confident" : "Outgoing") : assertive >= 4 ? "Independent" : "Easygoing";

  return {
    category,
    type: CATEGORY_TYPES[category][overall % 4],
    movement,
    speech,
    expression,
    attitude,
    overall,
  };
}

/** How well two personality categories rub along, 0-1. Opposites in
 * temperament clash; the flexible ones get on with everybody. */
const CATEGORY_FIT: Record<PersonalityCategory, Record<PersonalityCategory, number>> = {
  Outgoing: { Outgoing: 0.8, Easygoing: 0.9, Confident: 0.7, Independent: 0.45 },
  Easygoing: { Outgoing: 0.9, Easygoing: 0.85, Confident: 0.6, Independent: 0.7 },
  Confident: { Outgoing: 0.7, Easygoing: 0.6, Confident: 0.4, Independent: 0.35 },
  Independent: { Outgoing: 0.45, Easygoing: 0.7, Confident: 0.35, Independent: 0.5 },
};

/** 0-1 compatibility for a specific pair: their temperaments, plus a stable
 * per-pair spark so two Leaders aren't doomed to the same story every time. */
export function compatibility(a: Resident, b: Resident): number {
  const fit = CATEGORY_FIT[personalityFor(a.mii).category][personalityFor(b.mii).category];
  const [x, y] = [a.id, b.id].sort();
  const spark = unit("spark", x, y);
  return Math.min(1, Math.max(0, fit * 0.7 + spark * 0.3));
}

// ---------------------------------------------------------------------------
// Tastes
// ---------------------------------------------------------------------------

const FLAVOUR_BIAS: Record<PersonalityCategory, string> = {
  Outgoing: "sweet",
  Easygoing: "hearty",
  Confident: "savoury",
  Independent: "odd",
};

/**
 * What this Mii thinks of that food. Every resident has exactly one Super
 * All-Time Favourite and exactly one Worst Food Ever, both fixed for life,
 * which is the fact the whole feeding loop hangs off.
 */
export function reactionTo(resident: Resident, foodId: string): Reaction {
  const best = FOODS[hash("best", resident.id) % FOODS.length];
  if (best.id === foodId) return "Super All-Time Favourite";
  let worstIndex = hash("worst", resident.id) % FOODS.length;
  if (FOODS[worstIndex].id === best.id) worstIndex = (worstIndex + 1) % FOODS.length;
  if (FOODS[worstIndex].id === foodId) return "Worst Food Ever";

  const food = FOOD_BY_ID.get(foodId);
  if (!food) return "So-So";
  const liked = FLAVOUR_BIAS[personalityFor(resident.mii).category];
  const roll = unit("taste", resident.id, foodId) + (food.flavour === liked ? 0.18 : 0);
  if (roll > 0.82) return "All-Time Favourite";
  if (roll > 0.45) return "Likes It";
  if (roll > 0.16) return "So-So";
  return "Doesn't Like It";
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RomanceStatus = "none" | "crush" | "sweethearts" | "married";

export interface Resident {
  id: string;
  mii: Mii;
  /** Player number who brought them, or 0 for an islander nobody owns. */
  owner: number;
  level: number;
  /** 0-100 within the current level. */
  happiness: number;
  hunger: number;
  boredom: number;
  styleWear: number;
  outfit: string | null;
  interior: string;
  gifts: string[];
  songs: string[];
  catchphrase: string | null;
  /** Island time of the last redecoration, for the cooldown. */
  redecoratedAt?: number;
  /** Tastes you have actually found out by feeding them. */
  discovered: Record<string, Reaction>;
  /** Set while a scene about them is on screen, so the room can react. */
  mood: "happy" | "sad" | "angry" | "love" | "neutral";
  /** Parents, for Miis born on the island. */
  parents?: [string, string];
  child?: boolean;
}

export interface Bond {
  a: string;
  b: string;
  /** 0-100. */
  friendship: number;
  /** 0-100, only climbs once they're friends and there's a spark. */
  romance: number;
  status: RomanceStatus;
  quarrel: boolean;
}

export type RequestKind =
  | "hungry"
  | "clothes"
  | "interior"
  | "bored"
  | "levelup"
  | "confess"
  | "propose"
  | "quarrel";

export interface IslandRequest {
  id: string;
  kind: RequestKind;
  resident: string;
  other?: string;
  /** Whose phone this lands on. 0 means "whoever is holding the island". */
  owner: number;
  text: string;
  at: number;
}

export interface IslandEvent {
  id: string;
  at: number;
  text: string;
  actors: string[];
  kind: "friendly" | "romance" | "quarrel" | "solo" | "milestone" | "meal" | "news";
}

export interface Island {
  version: number;
  coins: number;
  /** Built structures, by building id, holding their level. A building that
   * is not here has not been put up yet. */
  buildings: Record<string, number>;
  /** Where everybody is standing, by resident id. */
  walkers: Record<string, Walker>;
  residents: Resident[];
  bonds: Bond[];
  /** Food bought ahead of time, by food id. */
  pantry: Record<string, number>;
  wardrobe: string[];
  interiors: string[];
  problemsSolved: number;
  requests: IslandRequest[];
  events: IslandEvent[];
  /** Seconds of island time elapsed. */
  clock: number;
  nextId: number;
}

export const SAVE_VERSION = 4;
/** The most the apartments will ever hold, at their top level. The real
 * thing holds a hundred; a TV holds eighteen legibly. */
export const MAX_RESIDENTS = 18;

/** How many Miis this island has room for right now. */
export function capacity(island: Island): number {
  return Math.min(MAX_RESIDENTS, capacityAt(island.buildings.apartments ?? 1));
}

export function createIsland(): Island {
  return {
    version: SAVE_VERSION,
    coins: 300,
    // You start with somewhere to live and somewhere to sign the forms.
    // Everything else is yours to build.
    buildings: { apartments: 1, townhall: 1 },
    walkers: {},
    residents: [],
    bonds: [],
    pantry: {},
    wardrobe: [],
    interiors: ["starter"],
    problemsSolved: 0,
    requests: [],
    events: [],
    clock: 0,
    nextId: 1,
  };
}

function nextId(island: Island, prefix: string): string {
  island.nextId += 1;
  return `${prefix}${island.nextId}`;
}

export function residentById(island: Island, id: string): Resident | undefined {
  return island.residents.find((r) => r.id === id);
}

export function nameOf(island: Island, id: string): string {
  return residentById(island, id)?.mii.name ?? "Someone";
}

// ---------------------------------------------------------------------------
// Moving in
// ---------------------------------------------------------------------------

export function addResident(island: Island, mii: Mii, owner: number): Resident | null {
  if (island.residents.length >= capacity(island)) return null;
  if (island.residents.some((r) => r.mii.id === mii.id)) return null;

  const resident: Resident = {
    id: `r-${mii.id}`,
    mii,
    owner,
    level: 1,
    happiness: 0,
    // Arriving peckish, but not all equally so. Everyone starting on the
    // same number meant the whole island got hungry within a minute of each
    // other and the player's phone was buried in identical requests before
    // they had looked at anything.
    hunger: 40 + unit("appetite", mii.id) * 35,
    boredom: 10,
    styleWear: 0,
    outfit: null,
    interior: "starter",
    gifts: [],
    songs: [],
    catchphrase: null,
    discovered: {},
    mood: "neutral",
  };
  island.residents.push(resident);
  for (const other of island.residents) {
    if (other.id === resident.id) continue;
    island.bonds.push({ a: other.id, b: resident.id, friendship: 0, romance: 0, status: "none", quarrel: false });
  }
  logEvent(island, "milestone", `${mii.name} moved into the apartments.`, [resident.id]);
  return resident;
}

export function removeResident(island: Island, id: string) {
  island.residents = island.residents.filter((r) => r.id !== id);
  island.bonds = island.bonds.filter((b) => b.a !== id && b.b !== id);
  island.requests = island.requests.filter((r) => r.resident !== id && r.other !== id);
}

export function bondBetween(island: Island, a: string, b: string): Bond | undefined {
  return island.bonds.find((bond) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a));
}

export function friendshipLabel(value: number): string {
  if (value >= 85) return "Best Friends";
  if (value >= 65) return "Good Friends";
  if (value >= 40) return "Friends";
  if (value >= 18) return "Acquaintances";
  return "Strangers";
}

// ---------------------------------------------------------------------------
// Happiness and levels
// ---------------------------------------------------------------------------

export function addHappiness(island: Island, resident: Resident, amount: number) {
  resident.happiness += amount;
  if (resident.happiness < 0) resident.happiness = 0;
  while (resident.happiness >= 100) {
    resident.happiness -= 100;
    resident.level += 1;
    // A levelling Mii hands you a little money, and asks for a present.
    const tip = 30 + resident.level * 4;
    island.coins += tip;
    logEvent(island, "milestone", `${resident.mii.name} reached level ${resident.level}!`, [resident.id]);
    raise(island, {
      kind: "levelup",
      resident: resident.id,
      text: `${resident.mii.name} levelled up and would like something.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Requests: the only way the player is ever involved
// ---------------------------------------------------------------------------

function raise(island: Island, req: Omit<IslandRequest, "id" | "owner" | "at">) {
  const already = island.requests.some(
    (r) => r.kind === req.kind && r.resident === req.resident && r.other === req.other,
  );
  if (already) return;
  const resident = residentById(island, req.resident);
  island.requests.push({
    ...req,
    id: nextId(island, "q"),
    owner: resident?.owner ?? 0,
    at: island.clock,
  });
}

export function requestsFor(island: Island, player: number, isHost: boolean): IslandRequest[] {
  return island.requests.filter((r) => r.owner === player || (isHost && r.owner === 0));
}

/**
 * Book a problem as solved, and take the thank-you that comes with it.
 *
 * The island has to pay for itself: food, clothes and wallpaper all cost
 * coins, and if helping a Mii brought nothing back the whole place went
 * bankrupt and quietly starved -- which a ninety-minute unattended run is
 * what showed. A grateful Mii hands over a little, and hands over more as
 * they grow, so the loop funds itself the same way the real one does.
 */
export function solved(island: Island, residentId: string) {
  island.problemsSolved += 1;
  const resident = residentById(island, residentId);
  island.coins += 8 + 2 * (resident?.level ?? 1);
}

function drop(island: Island, requestId: string) {
  const request = island.requests.find((r) => r.id === requestId);
  island.requests = island.requests.filter((r) => r.id !== requestId);
  if (request) solved(island, request.resident);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export interface ActionResult {
  ok: boolean;
  /** What to say on the TV. */
  message: string;
  reaction?: Reaction;
  resident?: string;
  building?: string;
}

/** Below this much hunger a Mii will not be fed again. A meal takes 60 off,
 * and a Mii asks at 75, so this works out at one meal per hunger cycle.
 * Without it feeding has no rhythm at all -- a level costs a few mouthfuls
 * and pays coins, and the two run away from each other: ninety minutes of
 * automated play reached level 706 and two million coins before this
 * existed. */
const FULL_ENOUGH = 45;
/** Likewise for clothes: they have to have got bored of the last outfit. */
const WORN_ENOUGH = 35;
/** ...and a room can't be redecorated twice in five minutes. */
const REDECORATE_COOLDOWN = 300;

export function priceOf(island: Island, foodId: string): number {
  if ((island.pantry[foodId] ?? 0) > 0) return 0;
  const base = FOOD_BY_ID.get(foodId)?.price ?? 0;
  return Math.max(1, Math.round(base * foodDiscount(island)));
}

export function feed(island: Island, residentId: string, foodId: string): ActionResult {
  const resident = residentById(island, residentId);
  const food = FOOD_BY_ID.get(foodId);
  if (!resident || !food) return { ok: false, message: "Nothing to feed." };

  if (resident.hunger < FULL_ENOUGH) {
    return { ok: false, message: `${resident.mii.name} is full.`, resident: resident.id };
  }

  const stocked = (island.pantry[foodId] ?? 0) > 0;
  const price = priceOf(island, foodId);
  if (!stocked) {
    if (island.coins < price) return { ok: false, message: "Not enough coins for that." };
    island.coins -= price;
  } else {
    island.pantry[foodId] -= 1;
    if (island.pantry[foodId] <= 0) delete island.pantry[foodId];
  }

  const reaction = reactionTo(resident, foodId);
  resident.discovered[foodId] = reaction;
  const gain = REACTION_HAPPINESS[reaction] + Math.round(food.price / 8);
  resident.hunger = Math.max(0, resident.hunger - 60);
  resident.mood = gain > 20 ? "happy" : gain < 0 ? "sad" : "neutral";
  addHappiness(island, resident, gain);

  const line = pick(REACTION_LINES[reaction], unit("line", resident.id, foodId, island.clock));
  logEvent(island, "meal", `${resident.mii.name}: “${line}”`, [resident.id]);
  return { ok: true, message: `${reaction} — “${line}”`, reaction, resident: resident.id };
}

export function buyFood(island: Island, foodId: string): ActionResult {
  const food = FOOD_BY_ID.get(foodId);
  if (!food) return { ok: false, message: "No such thing." };
  if (island.coins < food.price) return { ok: false, message: "Not enough coins." };
  island.coins -= food.price;
  island.pantry[foodId] = (island.pantry[foodId] ?? 0) + 1;
  return { ok: true, message: `${food.name} added to the pantry.` };
}

export function dress(island: Island, residentId: string, outfitId: string): ActionResult {
  const resident = residentById(island, residentId);
  const outfit = OUTFIT_BY_ID.get(outfitId);
  if (!resident || !outfit) return { ok: false, message: "Nothing to wear." };

  if (!island.wardrobe.includes(outfitId)) {
    if (island.coins < outfit.price) return { ok: false, message: "Not enough coins for that outfit." };
    island.coins -= outfit.price;
    island.wardrobe.push(outfitId);
  }
  if (resident.outfit === outfitId) return { ok: false, message: "Already wearing that." };
  if (resident.outfit && resident.styleWear < WORN_ENOUGH) {
    return { ok: false, message: `${resident.mii.name} is happy in what they've got on.`, resident: resident.id };
  }

  resident.outfit = outfitId;
  resident.styleWear = 0;
  // Whether it suits them is decided by their own eye, not yours.
  const taste = unit("outfit", resident.id, outfitId);
  const loves = taste > 0.75;
  const gain = loves ? 40 : taste > 0.3 ? 18 : 5;
  resident.mood = loves ? "happy" : "neutral";
  addHappiness(island, resident, gain);
  logEvent(
    island,
    "milestone",
    loves ? `${resident.mii.name} loves the ${outfit.name}.` : `${resident.mii.name} put on the ${outfit.name}.`,
    [resident.id],
  );
  return { ok: true, message: loves ? "They love it!" : "They'll wear it.", resident: resident.id };
}

export function decorate(island: Island, residentId: string, interiorId: string): ActionResult {
  const resident = residentById(island, residentId);
  const interior = INTERIOR_BY_ID.get(interiorId);
  if (!resident || !interior) return { ok: false, message: "No such room." };

  if (!island.interiors.includes(interiorId)) {
    if (island.coins < interior.price) return { ok: false, message: "Not enough coins for that room." };
    island.coins -= interior.price;
    island.interiors.push(interiorId);
  }
  if (resident.interior === interiorId) return { ok: false, message: "That's already their room." };
  if (island.clock - (resident.redecoratedAt ?? -REDECORATE_COOLDOWN) < REDECORATE_COOLDOWN) {
    return { ok: false, message: "They've only just settled in.", resident: resident.id };
  }

  resident.interior = interiorId;
  resident.redecoratedAt = island.clock;
  const taste = unit("interior", resident.id, interiorId);
  const loves = taste > 0.7;
  addHappiness(island, resident, loves ? 45 : 20);
  resident.mood = loves ? "happy" : "neutral";
  logEvent(island, "milestone", `${resident.mii.name}'s room is now the ${interior.name}.`, [resident.id]);
  return { ok: true, message: loves ? "A perfect fit for them." : "Redecorated.", resident: resident.id };
}

/** Level-up rewards. `choice` is one of `gift:<id>`, `song:<id>`,
 * `phrase:<n>`, `interior:<id>` or `coins`. */
export function claimReward(island: Island, residentId: string, choice: string): ActionResult {
  const resident = residentById(island, residentId);
  if (!resident) return { ok: false, message: "Nobody there." };
  const [kind, value] = choice.split(":");

  if (kind === "gift") {
    const gift = GIFTS.find((g) => g.id === value);
    if (!gift) return { ok: false, message: "No such gift." };
    if (!resident.gifts.includes(gift.id)) resident.gifts.push(gift.id);
    // Eight is all a room will hold.
    if (resident.gifts.length > 8) resident.gifts.shift();
    addHappiness(island, resident, 12);
    return { ok: true, message: `${resident.mii.name} got the ${gift.name}.`, resident: resident.id };
  }
  if (kind === "song") {
    const song = SONGS.find((s) => s.id === value);
    if (!song) return { ok: false, message: "No such song." };
    if (!resident.songs.includes(song.id)) resident.songs.push(song.id);
    addHappiness(island, resident, 12);
    return { ok: true, message: `${resident.mii.name} learnt “${song.title}”.`, resident: resident.id };
  }
  if (kind === "phrase") {
    const phrase = CATCHPHRASES[Number(value) % CATCHPHRASES.length];
    resident.catchphrase = phrase;
    addHappiness(island, resident, 10);
    return { ok: true, message: `${resident.mii.name} now says “${phrase}”`, resident: resident.id };
  }
  if (kind === "interior") {
    return decorate(island, residentId, value);
  }
  if (kind === "coins") {
    // Pocket money, unlocked once they're doing well enough to have any.
    const amount = resident.level >= 10 ? 60 : 25;
    island.coins += amount;
    return { ok: true, message: `${resident.mii.name} handed over ${amount} coins.`, resident: resident.id };
  }
  return { ok: false, message: "Nothing happened." };
}

/** The reward menu offered at a level-up. Grows with the Mii's level, the
 * way the real one does. */
export function rewardChoices(island: Island, resident: Resident): { id: string; label: string }[] {
  const roll = hash("reward", resident.id, resident.level);
  // Unsigned shifts: `hash` fills all 32 bits, and a signed shift here
  // turns the top half of that range into negative indices.
  const gift = GIFTS[roll % GIFTS.length];
  const song = SONGS[(roll >>> 3) % SONGS.length];
  const phrase = (roll >>> 6) % CATCHPHRASES.length;
  const interior = INTERIORS[(roll >>> 9) % INTERIORS.length];

  const choices = [
    { id: `gift:${gift.id}`, label: `${gift.icon} ${gift.name}` },
    { id: `song:${song.id}`, label: `🎵 ${song.title}` },
    { id: `phrase:${phrase}`, label: `💬 “${CATCHPHRASES[phrase]}”` },
  ];
  if (!island.interiors.includes(interior.id)) {
    choices.push({ id: `interior:${interior.id}`, label: `🏠 ${interior.name}` });
  }
  // Money only starts being an option once they have some to spare.
  if (resident.level >= 10) choices.push({ id: "coins", label: "🪙 Pocket money" });
  return choices;
}

// ---------------------------------------------------------------------------
// Relationship decisions
// ---------------------------------------------------------------------------

export function answerConfession(island: Island, requestId: string, yes: boolean): ActionResult {
  const request = island.requests.find((r) => r.id === requestId);
  if (!request || !request.other) return { ok: false, message: "That moment has passed." };
  const a = residentById(island, request.resident);
  const b = residentById(island, request.other);
  const bond = bondBetween(island, request.resident, request.other);
  if (!a || !b || !bond) return { ok: false, message: "That moment has passed." };
  drop(island, requestId);

  if (!yes) {
    bond.romance = Math.max(0, bond.romance - 25);
    a.mood = "sad";
    addHappiness(island, a, -6);
    logEvent(island, "romance", `${a.mii.name} decided not to say anything. Yet.`, [a.id, b.id]);
    return { ok: true, message: "They kept it to themselves.", resident: a.id };
  }

  // Whether it lands is up to the pair, not the player -- the player only
  // ever gets to say "go on then".
  const chance = compatibility(a, b) * 0.6 + bond.friendship / 250;
  const accepted = unit("confess", a.id, b.id, bond.romance) < chance;
  if (accepted) {
    bond.status = "sweethearts";
    bond.romance = Math.max(bond.romance, 65);
    bond.friendship = Math.min(100, bond.friendship + 10);
    a.mood = "love";
    b.mood = "love";
    addHappiness(island, a, 45);
    addHappiness(island, b, 45);
    logEvent(island, "romance", `${a.mii.name} and ${b.mii.name} are together!`, [a.id, b.id]);
    return { ok: true, message: `${b.mii.name} said yes!`, resident: a.id };
  }
  bond.romance = Math.max(0, bond.romance - 40);
  bond.friendship = Math.max(0, bond.friendship - 5);
  a.mood = "sad";
  addHappiness(island, a, -18);
  logEvent(island, "romance", `${b.mii.name} turned ${a.mii.name} down. Gently.`, [a.id, b.id]);
  return { ok: true, message: `${b.mii.name} said no.`, resident: a.id };
}

export function answerProposal(island: Island, requestId: string, yes: boolean): ActionResult {
  const request = island.requests.find((r) => r.id === requestId);
  if (!request || !request.other) return { ok: false, message: "That moment has passed." };
  const a = residentById(island, request.resident);
  const b = residentById(island, request.other);
  const bond = bondBetween(island, request.resident, request.other);
  if (!a || !b || !bond) return { ok: false, message: "That moment has passed." };
  drop(island, requestId);

  if (!yes) {
    bond.romance = Math.max(0, bond.romance - 15);
    logEvent(island, "romance", `${a.mii.name} is going to wait a while longer.`, [a.id, b.id]);
    return { ok: true, message: "Not yet, then.", resident: a.id };
  }
  bond.status = "married";
  bond.romance = 100;
  bond.friendship = 100;
  a.mood = "love";
  b.mood = "love";
  addHappiness(island, a, 70);
  addHappiness(island, b, 70);
  island.coins += 50;
  logEvent(island, "romance", `${a.mii.name} and ${b.mii.name} got married. The whole island came.`, [a.id, b.id]);
  return { ok: true, message: "They're married!", resident: a.id };
}

export function settleQuarrel(island: Island, requestId: string, how: "talk" | "gift" | "leave"): ActionResult {
  const request = island.requests.find((r) => r.id === requestId);
  if (!request || !request.other) return { ok: false, message: "They sorted it out themselves." };
  const a = residentById(island, request.resident);
  const b = residentById(island, request.other);
  const bond = bondBetween(island, request.resident, request.other);
  if (!a || !b || !bond) return { ok: false, message: "They sorted it out themselves." };
  drop(island, requestId);

  if (how === "leave") {
    // Left alone, most fights fizzle out; some don't.
    const healed = unit("fizzle", a.id, b.id, island.clock) > 0.4;
    bond.quarrel = !healed;
    bond.friendship = Math.max(0, bond.friendship + (healed ? 4 : -10));
    logEvent(
      island,
      "quarrel",
      healed ? `${a.mii.name} and ${b.mii.name} got over it.` : `${a.mii.name} and ${b.mii.name} are still not speaking.`,
      [a.id, b.id],
    );
    return { ok: true, message: healed ? "They worked it out." : "That did not help.", resident: a.id };
  }

  if (how === "gift") {
    const cost = 20;
    if (island.coins < cost) return { ok: false, message: "Not enough coins to smooth that over." };
    island.coins -= cost;
    bond.quarrel = false;
    bond.friendship = Math.min(100, bond.friendship + 12);
    addHappiness(island, a, 15);
    addHappiness(island, b, 15);
    logEvent(island, "quarrel", `A peace offering fixed things between ${a.mii.name} and ${b.mii.name}.`, [a.id, b.id]);
    return { ok: true, message: "Bought off. Effective.", resident: a.id };
  }

  const worked = unit("mediate", a.id, b.id, island.clock) < 0.35 + compatibility(a, b) * 0.5;
  bond.quarrel = !worked;
  bond.friendship = Math.min(100, Math.max(0, bond.friendship + (worked ? 15 : -6)));
  a.mood = worked ? "happy" : "angry";
  b.mood = worked ? "happy" : "angry";
  if (worked) {
    addHappiness(island, a, 20);
    addHappiness(island, b, 20);
  }
  logEvent(
    island,
    "quarrel",
    worked ? `${a.mii.name} and ${b.mii.name} talked it out.` : `Talking made it worse. Well done.`,
    [a.id, b.id],
  );
  return { ok: true, message: worked ? "They shook on it." : "That went badly.", resident: a.id };
}

export function cheerUp(island: Island, residentId: string, activity: string): ActionResult {
  const resident = residentById(island, residentId);
  if (!resident) return { ok: false, message: "Nobody there." };
  resident.boredom = 0;
  addHappiness(island, resident, 18);
  resident.mood = "happy";
  island.requests = island.requests.filter((r) => !(r.kind === "bored" && r.resident === residentId));
  solved(island, residentId);
  logEvent(island, "solo", `${resident.mii.name} went to the ${activity}.`, [resident.id]);
  return { ok: true, message: `Off to the ${activity}.`, resident: resident.id };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

export function logEvent(island: Island, kind: IslandEvent["kind"], text: string, actors: string[]) {
  island.events.unshift({ id: nextId(island, "e"), at: island.clock, text, actors, kind });
  if (island.events.length > 40) island.events.length = 40;
}

/** Needs creep up in real time. Rates are per minute. */
const HUNGER_RATE = 16;
const BOREDOM_RATE = 9;
const STYLE_RATE = 5;

/**
 * How long a Mii will keep asking before giving up on it.
 *
 * Without this the island can deadlock: a Mii asks for clothes you cannot
 * afford, answering fails, and the request sits at the front of every
 * phone's queue forever -- deferring only sends it to the back and it comes
 * straight round again. Level-ups are exempt: choosing a present costs
 * nothing, so it can always be resolved and is worth keeping.
 */
const REQUEST_PATIENCE = 180;

export function tickNeeds(island: Island, seconds: number) {
  island.clock += seconds;

  for (const request of island.requests) {
    if (request.kind === "levelup") continue;
    if (island.clock - request.at < REQUEST_PATIENCE) continue;
    const resident = residentById(island, request.resident);
    if (resident) {
      resident.mood = "sad";
      addHappiness(island, resident, -5);
      logEvent(island, "solo", `${resident.mii.name} gave up waiting and sorted themselves out.`, [resident.id]);
    }
    island.requests = island.requests.filter((r) => r.id !== request.id);
  }

  const minutes = seconds / 60;
  for (const resident of island.residents) {
    resident.hunger = Math.min(140, resident.hunger + HUNGER_RATE * minutes);
    resident.boredom = Math.min(140, resident.boredom + BOREDOM_RATE * minutes);
    resident.styleWear = Math.min(140, resident.styleWear + STYLE_RATE * minutes);

    if (resident.hunger >= 75) {
      raise(island, { kind: "hungry", resident: resident.id, text: `${resident.mii.name} is hungry.` });
    }
    // Only ask if there is somewhere to send them. An island with nothing
    // built has no answer to "I'm bored", and the request then sat at the
    // front of the queue forever -- deferring it just brought it straight
    // back round. What a bored Mii means on an empty island is that you
    // should go and build something, and `nextGoal` says so.
    if (resident.boredom >= 85 && leisureBuildings(island).length > 0) {
      raise(island, { kind: "bored", resident: resident.id, text: `${resident.mii.name} is bored senseless.` });
    }
    if (resident.styleWear >= 95) {
      raise(island, { kind: "clothes", resident: resident.id, text: `${resident.mii.name} wants something new to wear.` });
    }
    // Ignored long enough, a Mii starts sliding backwards.
    if (resident.hunger >= 120 || resident.boredom >= 130) {
      resident.mood = "sad";
      resident.happiness = Math.max(0, resident.happiness - 2 * minutes * 60);
    }
  }
}

/**
 * Two Miis have ended up standing next to each other. Whatever happens
 * between them happens here.
 *
 * They used to be drawn out of a hat. Now the walking simulation decides
 * who is near whom, so the friendships that form are the ones you can watch
 * forming -- which is the whole point of putting them on a map.
 */
export function meet(island: Island, aId: string, bId: string, roll = Math.random()): IslandEvent | null {
  const a = residentById(island, aId);
  const b = residentById(island, bId);
  if (!a || !b || a.id === b.id) return null;
  const bond = bondBetween(island, a.id, b.id);
  if (!bond) return null;

  const fit = compatibility(a, b);
  const seed = unit("beat", a.id, b.id, Math.floor(island.clock)) * 0.7 + roll * 0.3;

  // A bad match, left to its own devices, eventually goes wrong.
  if (!bond.quarrel && bond.status !== "married" && seed > 0.88 && fit < 0.5) {
    bond.quarrel = true;
    bond.friendship = Math.max(0, bond.friendship - 15);
    a.mood = "angry";
    b.mood = "angry";
    const text = fill(pick(QUARREL_SCENES, seed), a.mii.name, b.mii.name);
    logEvent(island, "quarrel", text, [a.id, b.id]);
    raise(island, {
      kind: "quarrel",
      resident: a.id,
      other: b.id,
      text: `${a.mii.name} and ${b.mii.name} have fallen out.`,
    });
    return island.events[0];
  }

  // Nothing good happens while they're at war.
  if (bond.quarrel) return null;

  bond.friendship = Math.min(100, bond.friendship + fit * 6);
  addHappiness(island, a, 2);
  addHappiness(island, b, 1);

  // Romance only ever grows out of a real friendship, and only if the pair
  // actually have a spark.
  const spark = unit("attract", [a.id, b.id].sort().join("|"));
  const bothFree = isSingle(island, a.id) && isSingle(island, b.id);
  if (bond.status === "none" && bond.friendship >= 55 && spark > 0.55 && bothFree) {
    bond.romance = Math.min(100, bond.romance + 8);
    if (bond.romance >= 60) {
      bond.status = "crush";
      raise(island, {
        kind: "confess",
        resident: a.id,
        other: b.id,
        text: `${a.mii.name} has feelings for ${b.mii.name} and doesn't know what to do.`,
      });
    }
    logEvent(island, "romance", fill(pick(ROMANTIC_SCENES, seed), a.mii.name, b.mii.name), [a.id, b.id]);
    return island.events[0];
  }

  if (bond.status === "sweethearts") {
    bond.romance = Math.min(100, bond.romance + 5);
    if (bond.romance >= 92) {
      raise(island, {
        kind: "propose",
        resident: a.id,
        other: b.id,
        text: `${a.mii.name} wants to propose to ${b.mii.name}.`,
      });
    }
    logEvent(island, "romance", fill(pick(ROMANTIC_SCENES, seed), a.mii.name, b.mii.name), [a.id, b.id]);
    return island.events[0];
  }

  if (bond.status === "married" && island.residents.length < capacity(island) && seed > 0.93) {
    if (bearChild(island, a, b)) return island.events[0];
  }

  logEvent(island, "friendly", fill(pick(FRIENDLY_SCENES, seed), a.mii.name, b.mii.name), [a.id, b.id]);
  return island.events[0];
}

/** Somebody pottering about on their own. The island does this on a slow
 * timer so it still has something to say when everyone is spread out. */
export function soloBeat(island: Island, roll = Math.random()): IslandEvent | null {
  if (island.residents.length === 0) return null;
  const index = Math.floor(unit("solo", Math.floor(island.clock), roll) * island.residents.length);
  const solo = island.residents[index % island.residents.length];
  logEvent(island, "solo", fill(pick(SOLO_SCENES, unit("scene", solo.id, Math.floor(island.clock))), solo.mii.name), [solo.id]);
  addHappiness(island, solo, 2);
  return island.events[0];
}

export function isSingle(island: Island, id: string): boolean {
  return !island.bonds.some(
    (b) => (b.a === id || b.b === id) && (b.status === "sweethearts" || b.status === "married"),
  );
}

/** A child takes each feature from one parent or the other -- which is both
 * the simplest rule and the one that actually looks right. */
export function blendMii(a: Mii, b: Mii, id: string, name: string): Mii {
  const child = { ...a, id, name } as Mii;
  const keys = Object.keys(a) as (keyof Mii)[];
  for (const key of keys) {
    if (key === "id" || key === "name") continue;
    const fromB = unit("gene", id, key) > 0.5;
    (child as unknown as Record<string, string>)[key] = String(fromB ? b[key] : a[key]);
  }
  child.height = "short";
  return child;
}

export function bearChild(island: Island, a: Resident, b: Resident): Resident | null {
  if (island.residents.length >= capacity(island)) return null;
  const id = `k${island.nextId + 1}`;
  const syllables = ["Mi", "Ko", "Ta", "Nu", "Rei", "Sa", "Bo", "Lu"];
  const name =
    syllables[hash("n1", a.id, b.id, id) % syllables.length] + syllables[hash("n2", a.id, b.id, id) % syllables.length].toLowerCase();
  const mii = blendMii(a.mii, b.mii, id, name);
  const child = addResident(island, mii, a.owner || b.owner);
  if (!child) return null;
  child.child = true;
  child.parents = [a.id, b.id];
  // Family starts out close.
  for (const parent of [a, b]) {
    const bond = bondBetween(island, parent.id, child.id);
    if (bond) bond.friendship = 90;
  }
  addHappiness(island, a, 60);
  addHappiness(island, b, 60);
  logEvent(island, "milestone", `${a.mii.name} and ${b.mii.name} had a baby: ${name}!`, [a.id, b.id, child.id]);
  return child;
}

// ---------------------------------------------------------------------------
// The island itself
// ---------------------------------------------------------------------------

/**
 * Putting the town up.
 *
 * The old island unlocked its buildings on milestones, which meant the
 * player watched them appear rather than deciding anything. Now every
 * building is bought and can be grown, so the coins a grateful Mii hands
 * you have somewhere to go and the island has a direction: a scruffy pair
 * of buildings on an empty field, turned into a town.
 */

export function levelOf(island: Island, buildingId: string): number {
  return island.buildings[buildingId] ?? 0;
}

export function isBuilt(island: Island, buildingId: string): boolean {
  return levelOf(island, buildingId) > 0;
}

/** Everything standing, tallest thing first so the town draws back to front. */
export function builtBuildings(island: Island): BuildingType[] {
  return BUILDINGS.filter((b) => isBuilt(island, b.id));
}

export function leisureBuildings(island: Island): BuildingType[] {
  return builtBuildings(island).filter((b) => b.leisure);
}

/** The island's own level: everything you have put up, added together. It
 * is the score, and the thing the town-hall panel is really about. */
export function islandLevel(island: Island): number {
  return Object.values(island.buildings).reduce((total, level) => total + level, 0);
}

/** Why you can't build this yet, or null if you can. Money is checked last
 * so the message is about the interesting reason first. */
export function blockedBecause(island: Island, type: BuildingType): string | null {
  if (isBuilt(island, type.id)) return "Already built.";
  if (type.needsResidents && island.residents.length < type.needsResidents) {
    return `Needs ${type.needsResidents} residents`;
  }
  if (type.needsBuilding && !isBuilt(island, type.needsBuilding)) {
    const name = BUILDING_BY_ID.get(type.needsBuilding)?.name ?? type.needsBuilding;
    // Some of them are called "The Park", so the article is already there.
    return `Needs ${/^The /.test(name) ? name : `the ${name}`}`;
  }
  if (type.needsLevel && !island.residents.some((r) => r.level >= type.needsLevel!)) {
    return `Needs a Mii at level ${type.needsLevel}`;
  }
  if (island.coins < type.cost) return `Needs ${type.cost} coins`;
  return null;
}

export function build(island: Island, buildingId: string): ActionResult {
  const type = BUILDING_BY_ID.get(buildingId);
  if (!type) return { ok: false, message: "No such building." };
  const blocked = blockedBecause(island, type);
  if (blocked) return { ok: false, message: blocked };

  island.coins -= type.cost;
  island.buildings[type.id] = 1;
  logEvent(island, "milestone", `The ${type.name} opened!`, []);
  // A new place to go cheers everybody up.
  for (const resident of island.residents) addHappiness(island, resident, 6);
  return { ok: true, message: `${type.name} built.`, building: type.id };
}

export function upgrade(island: Island, buildingId: string): ActionResult {
  const type = BUILDING_BY_ID.get(buildingId);
  if (!type) return { ok: false, message: "No such building." };
  const level = levelOf(island, type.id);
  if (level === 0) return { ok: false, message: "It isn't built yet." };
  if (level >= MAX_BUILDING_LEVEL) return { ok: false, message: `The ${type.name} is as big as it gets.` };
  const cost = upgradeCost(type, level);
  if (island.coins < cost) return { ok: false, message: `Needs ${cost} coins` };

  island.coins -= cost;
  island.buildings[type.id] = level + 1;
  logEvent(island, "milestone", `The ${type.name} grew to level ${level + 1}.`, []);
  for (const resident of island.residents) addHappiness(island, resident, 4);
  return { ok: true, message: `${type.name} is now level ${level + 1}.`, building: type.id };
}

/** What the island would most like you to do next, for the goal line at the
 * top of the screen. */
export function nextGoal(island: Island): string {
  // A Mii with nothing to do is the island asking you for a building.
  const restless = island.residents.find((r) => r.boredom >= 80);
  if (restless && leisureBuildings(island).length === 0) {
    const park = BUILDING_BY_ID.get("park")!;
    return `${restless.mii.name} has nowhere to go — build ${park.name} (${park.cost} coins)`;
  }
  if (island.residents.length >= capacity(island)) {
    return `The apartments are full — upgrade them for ${upgradeCost(BUILDING_BY_ID.get("apartments")!, levelOf(island, "apartments"))} coins`;
  }
  const affordable = BUILDINGS.filter((b) => !isBuilt(island, b.id) && blockedBecause(island, b) === null);
  if (affordable.length > 0) return `You can afford the ${affordable[0].name} (${affordable[0].cost} coins)`;
  const next = BUILDINGS.filter((b) => !isBuilt(island, b.id)).sort((a, b) => a.cost - b.cost)[0];
  if (next) {
    const why = blockedBecause(island, next);
    return `Next: the ${next.name} — ${why}`;
  }
  const growable = BUILDINGS.filter((b) => isBuilt(island, b.id) && levelOf(island, b.id) < MAX_BUILDING_LEVEL);
  if (growable.length > 0) return `Everything is built — grow the ${growable[0].name}`;
  return "The island is finished. Look at it.";
}

/** Food is cheaper as the Food Mart grows -- the first thing an upgrade is
 * actually worth. */
export function foodDiscount(island: Island): number {
  return 1 - 0.12 * Math.max(0, levelOf(island, "foodmart") - 1);
}

/** A headline for the news channel: real events first, filler if the island
 * has been quiet. */
export function headlines(island: Island, count = 5): string[] {
  const real = island.events
    .filter((e) => e.kind !== "news")
    .slice(0, count)
    .map((e) => e.text);
  while (real.length < count && island.residents.length > 0) {
    const who = island.residents[real.length % island.residents.length];
    real.push(fill(pick(NEWS_FILLER, unit("news", island.clock, real.length)), who.mii.name));
  }
  return real;
}

export function makeWish(island: Island): string {
  if (island.residents.length === 0) return "The fountain is quiet.";
  if (island.coins < 5) return "You need a coin to throw in.";
  island.coins -= 5;
  const who = island.residents[hash("wish", island.clock) % island.residents.length];
  const text = fill(pick(WISHES, unit("wishline", island.clock)), who.mii.name);
  addHappiness(island, who, 8);
  logEvent(island, "news", text, [who.id]);
  return text;
}

/** Everyone who could take the stage, and what they know. */
export function performers(island: Island): { resident: Resident; songs: string[] }[] {
  return island.residents.filter((r) => r.songs.length > 0).map((r) => ({ resident: r, songs: r.songs }));
}

/** Sorted list of every pair the tower knows about. */
export function relationshipBoard(island: Island): { a: Resident; b: Resident; bond: Bond; fit: number }[] {
  const rows: { a: Resident; b: Resident; bond: Bond; fit: number }[] = [];
  for (const bond of island.bonds) {
    const a = residentById(island, bond.a);
    const b = residentById(island, bond.b);
    if (!a || !b) continue;
    rows.push({ a, b, bond, fit: compatibility(a, b) });
  }
  rows.sort((x, y) => {
    const rank = (r: typeof x) => (r.bond.status === "married" ? 3 : r.bond.status === "sweethearts" ? 2 : r.bond.quarrel ? -1 : 0);
    return rank(y) - rank(x) || y.bond.friendship - x.bond.friendship;
  });
  return rows;
}

/** Colours the outfit onto the Mii without touching the saved Mii itself. */
export function dressedMii(resident: Resident): Mii {
  const outfit = resident.outfit ? OUTFIT_BY_ID.get(resident.outfit) : undefined;
  if (!outfit) return resident.mii;
  return { ...resident.mii, shirtColor: outfit.color, shirtStyle: outfit.style };
}

export { FOODS, OUTFITS, INTERIORS, GIFTS, SONGS };
export type { Reaction };
