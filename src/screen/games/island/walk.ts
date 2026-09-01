import {
  BUILDINGS,
  BUILDING_BY_ID,
  PLOT_BY_ID,
  onLand,
  wanderPoint,
  type Walker,
} from "./map";
import { unit, type Island, type Resident } from "./sim";

// Miis walking about.
//
// This is what makes the island a place rather than a list. Everyone has
// somewhere they are going, and where they are going comes from what they
// want: a hungry Mii heads for the Food Mart, a bored one for whatever
// there is to do, and somebody with a crush finds a reason to be wherever
// their crush is. So you can read the town at a glance -- the crowd outside
// the shop is the crowd that needs feeding.
//
// It also decides who meets whom. Relationships used to come from picking
// two names out of a hat; now two Miis have to actually stand near each
// other, which is both more legible and much closer to the real thing.

/** Island units per second. The island is 100 across, so this is a gentle
 * stroll: about half a minute from the beach to the apartments. */
const BASE_SPEED = 3.4;
/** Close enough to have arrived. */
const ARRIVE = 1.2;
/** Close enough to strike up a conversation. */
const MEET_RANGE = 9;
/** ...and how long before either of them will do so again. */
const MEET_COOLDOWN = 16;

export interface Meeting {
  a: string;
  b: string;
}

function homeDoor(): { x: number; y: number } {
  const plot = PLOT_BY_ID.get("p-apartments")!;
  return { x: plot.x, y: plot.doorY };
}

export function newWalker(seed: string): Walker {
  const home = homeDoor();
  return {
    x: home.x + (unit("spawnx", seed) - 0.5) * 22,
    y: home.y + (unit("spawny", seed) - 0.5) * 8,
    tx: home.x,
    ty: home.y,
    facing: 1,
    state: "idle",
    hold: unit("hold", seed) * 6,
    at: "apartments",
    quietUntil: 0,
    pace: 0.8 + unit("pace", seed) * 0.45,
  };
}

/** Adds walkers for anyone who has moved in, and forgets anyone who left. */
export function syncWalkers(island: Island) {
  const living = new Set(island.residents.map((r) => r.id));
  for (const resident of island.residents) {
    if (!island.walkers[resident.id]) island.walkers[resident.id] = newWalker(resident.id);
  }
  for (const id of Object.keys(island.walkers)) {
    if (!living.has(id)) delete island.walkers[id];
  }
}

/** Every building that is actually standing. */
function standing(island: Island) {
  return BUILDINGS.filter((b) => (island.buildings[b.id] ?? 0) > 0);
}

function doorOf(buildingId: string): { x: number; y: number } | null {
  const type = BUILDING_BY_ID.get(buildingId);
  if (!type) return null;
  const plot = PLOT_BY_ID.get(type.plot);
  if (!plot) return null;
  // Spread arrivals along the frontage so a queue doesn't stack into one pixel.
  return { x: plot.x, y: plot.doorY };
}

/**
 * Where this Mii wants to be next. Needs first, then company, then whim --
 * which is roughly the order a person works in too.
 */
export function chooseDestination(
  island: Island,
  resident: Resident,
  seed: number,
): { tx: number; ty: number; at: string | null } {
  const built = standing(island);
  const has = (id: string) => built.some((b) => b.id === id);
  const spread = (point: { x: number; y: number }, jitter: number) => ({
    tx: point.x + (seed - 0.5) * jitter,
    ty: point.y + ((seed * 7) % 1 - 0.5) * (jitter * 0.4),
  });

  if (resident.hunger >= 70 && has("foodmart")) {
    const door = doorOf("foodmart")!;
    return { ...spread(door, 12), at: "foodmart" };
  }

  if (resident.boredom >= 65) {
    const fun = built.filter((b) => b.leisure);
    if (fun.length > 0) {
      const choice = fun[Math.floor(seed * fun.length) % fun.length];
      const door = doorOf(choice.id)!;
      return { ...spread(door, 12), at: choice.id };
    }
  }

  // Somebody they are keen on: go and be nearby. This is how a crush turns
  // into a confession without the player arranging anything.
  const sweet = island.bonds.find(
    (b) => (b.a === resident.id || b.b === resident.id) && (b.status === "crush" || b.status === "sweethearts" || b.status === "married"),
  );
  if (sweet && seed > 0.45) {
    const otherId = sweet.a === resident.id ? sweet.b : sweet.a;
    const other = island.walkers[otherId];
    if (other) return { tx: other.x + (seed - 0.5) * 8, ty: other.y + 2, at: other.at };
  }

  // Weighted towards the town rather than the empty field: buildings are
  // where Miis run into each other, and an island where everyone wanders
  // off alone has no relationships in it at all.
  if (seed > 0.28 && built.length > 0) {
    const choice = built[Math.floor(seed * 977) % built.length];
    const door = doorOf(choice.id)!;
    return { ...spread(door, 12), at: choice.id };
  }

  const point = wanderPoint(seed);
  return { tx: point.x, ty: point.y, at: null };
}

/**
 * Advances everyone by `dt` seconds and reports anyone who ended up next to
 * somebody they have not spoken to recently.
 */
export function stepWalkers(island: Island, dt: number): Meeting[] {
  syncWalkers(island);
  const meetings: Meeting[] = [];

  for (const resident of island.residents) {
    const walker = island.walkers[resident.id];
    if (!walker) continue;

    if (walker.state === "idle") {
      walker.hold -= dt;
      if (walker.hold > 0) continue;
      const seed = unit("dest", resident.id, Math.floor(island.clock));
      const next = chooseDestination(island, resident, seed);
      // Never send anyone for a swim.
      if (onLand(next.tx, next.ty)) {
        walker.tx = next.tx;
        walker.ty = next.ty;
        walker.at = next.at;
        walker.state = "walk";
      } else {
        walker.hold = 2;
      }
      continue;
    }

    const dx = walker.tx - walker.x;
    const dy = walker.ty - walker.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= ARRIVE) {
      walker.state = "idle";
      walker.hold = 4 + unit("dwell", resident.id, Math.floor(island.clock)) * 8;
      continue;
    }
    const step = Math.min(distance, BASE_SPEED * walker.pace * dt);
    walker.x += (dx / distance) * step;
    walker.y += (dy / distance) * step;
    if (Math.abs(dx) > 0.4) walker.facing = dx > 0 ? 1 : -1;
  }

  // Who ended up standing together?
  const ids = island.residents.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 1) {
    const a = island.walkers[ids[i]];
    if (!a || a.state !== "idle" || island.clock < a.quietUntil) continue;
    for (let j = i + 1; j < ids.length; j += 1) {
      const b = island.walkers[ids[j]];
      if (!b || b.state !== "idle" || island.clock < b.quietUntil) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > MEET_RANGE) continue;
      a.quietUntil = island.clock + MEET_COOLDOWN;
      b.quietUntil = island.clock + MEET_COOLDOWN;
      meetings.push({ a: ids[i], b: ids[j] });
      break;
    }
  }

  return meetings;
}

/** Sends everyone home -- used when the apartments shrink or on a fresh load
 * where positions might be nonsense. */
export function resetWalkers(island: Island) {
  island.walkers = {};
  syncWalkers(island);
}
