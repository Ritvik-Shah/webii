// The lake, and everything that happens in it.
//
// No React and no canvas: the whole game is a state object plus a step
// function, so the fight physics -- which are the interesting part, and the
// part nobody can eyeball from a screenshot -- can be driven and asserted on
// in a plain node script.
//
// Coordinates: x runs 0-100 across the water, depth runs 0 (the surface) to
// 100 (the bed). Anglers stand along the pier at the top and drop straight
// down, so every player gets their own column and ten lines never cross.

export interface Species {
  id: string;
  name: string;
  /** Where in the water column it lives. */
  minDepth: number;
  maxDepth: number;
  minWeight: number;
  maxWeight: number;
  /** How fast it swims, in x units per second. */
  speed: number;
  /** How hard it fights: added tension per second, and how much it drags
   * itself back down. */
  fight: number;
  /** Relative chance of being the next fish to appear. */
  rarity: number;
  color: string;
  /** Junk doesn't fight and barely weighs anything. It is here because
   * pulling up a boot is funnier than pulling up nothing. */
  junk?: boolean;
}

export const SPECIES: Species[] = [
  { id: "sunperch", name: "Sunperch", minDepth: 5, maxDepth: 28, minWeight: 0.3, maxWeight: 1.1, speed: 9, fight: 0.5, rarity: 26, color: "#f0b64a" },
  { id: "silverfin", name: "Silverfin", minDepth: 8, maxDepth: 34, minWeight: 0.4, maxWeight: 1.4, speed: 11, fight: 0.7, rarity: 22, color: "#cfd8e3" },
  { id: "pebblemouth", name: "Pebblemouth", minDepth: 20, maxDepth: 48, minWeight: 0.8, maxWeight: 2.2, speed: 7, fight: 1.0, rarity: 18, color: "#8a9a6b" },
  { id: "bluecap", name: "Bluecap", minDepth: 30, maxDepth: 58, minWeight: 1.2, maxWeight: 3.0, speed: 8, fight: 1.3, rarity: 14, color: "#5b8fd6" },
  { id: "ribbontail", name: "Ribbontail", minDepth: 42, maxDepth: 70, minWeight: 1.6, maxWeight: 3.8, speed: 13, fight: 1.6, rarity: 9, color: "#b06fc4" },
  { id: "gloomfish", name: "Gloomfish", minDepth: 58, maxDepth: 82, minWeight: 2.5, maxWeight: 5.5, speed: 6, fight: 2.0, rarity: 6, color: "#3f5a70" },
  { id: "moonscale", name: "Moonscale", minDepth: 70, maxDepth: 92, minWeight: 4.0, maxWeight: 8.0, speed: 9, fight: 2.6, rarity: 3, color: "#9fd3e8" },
  { id: "kettleback", name: "Kettleback", minDepth: 82, maxDepth: 98, minWeight: 6.0, maxWeight: 12.0, speed: 5, fight: 3.4, rarity: 1.2, color: "#6b4a2f" },
  { id: "boot", name: "Old Boot", minDepth: 10, maxDepth: 95, minWeight: 0.4, maxWeight: 0.7, speed: 2, fight: 0.2, rarity: 7, color: "#5a4634", junk: true },
  { id: "can", name: "Dented Tin", minDepth: 10, maxDepth: 95, minWeight: 0.2, maxWeight: 0.4, speed: 2, fight: 0.2, rarity: 5, color: "#9aa7ad", junk: true },
];

export const SPECIES_BY_ID = new Map(SPECIES.map((s) => [s.id, s]));

export interface Fish {
  id: number;
  species: string;
  x: number;
  depth: number;
  /** 1 swimming right, -1 swimming left. */
  dir: 1 | -1;
  weight: number;
  /** Seed for its own wobble and its own surges, so two fish of the same
   * kind don't fight in lockstep. */
  seed: number;
  /** Set while it is nosing at somebody's bait. */
  interestedIn: number | null;
}

export type Phase = "ready" | "sinking" | "fishing" | "bite" | "hooked" | "landing";

export interface Catch {
  species: string;
  weight: number;
  at: number;
}

export interface Angler {
  player: number;
  /** Where their line hangs, 0-100 across the water. */
  x: number;
  phase: Phase;
  /** Current hook depth. */
  depth: number;
  targetDepth: number;
  fish: Fish | null;
  /** Counts down the window in which a strike will hook the fish. */
  biteTimer: number;
  tension: number;
  /** How long tension has been over the limit, and how long the line has
   * been slack -- the two ways to lose a fish. */
  strainFor: number;
  slackFor: number;
  catches: Catch[];
  score: number;
  /** Purely for the screen: a short line about what just happened. */
  note: string;
  noteFor: number;
  /** Drives the bobber's dip and the rod's bend. */
  wobble: number;
  landing: { species: string; weight: number; t: number } | null;
}

export interface Lake {
  time: number;
  remaining: number;
  fish: Fish[];
  anglers: Angler[];
  nextFishId: number;
  over: boolean;
}

// --- tuning ---------------------------------------------------------------

export const ROUND_SECONDS = 150;
/** How many fish are in the water at once. */
const FISH_COUNT = 14;
/** Depth units per second while a cast sinks. */
const SINK_SPEED = 55;
/** How close in depth and across the water a fish has to be to notice bait. */
const BITE_DEPTH = 6;
const BITE_X = 3.2;
/** Chance per second that an interested fish actually bites. */
const BITE_CHANCE = 1.5;
/** How long a strike still counts after the bite. */
export const BITE_WINDOW = 1.3;
/** Crank speed (degrees per second of wrist rotation) that counts as
 * reeling flat out. Deliberately reachable: this has never met a real
 * wrist, and reeling too hard is already punished by the tension. */
export const REEL_FULL = 420;
/**
 * Depth units per second recovered at a full crank, and the three numbers
 * that decide whether the fight is a fight.
 *
 * They are balanced against each other rather than picked to feel right in
 * isolation. At a full crank the tension climbs at about 56/s, so the line
 * strains inside two seconds -- long before a fish 50 units down could be
 * hauled up at 22/s. Winding flat out therefore always loses, which is the
 * whole point; the first pass had reeling outrun the strain and a fish could
 * simply be yanked in, so there was no game in it at all.
 *
 * Tension falls at 48/s when you stop, so the sustainable crank is around a
 * third of full and a mid-sized fish takes ten seconds or so of wind, ease,
 * wind.
 */
const REEL_SPEED = 22;
/** ...and while merely adjusting a cast that hasn't hooked anything. */
const ADJUST_SPEED = 14;
const TENSION_FROM_REEL = 90;
const TENSION_FROM_FISH = 14;
const TENSION_RELAX = 48;
/** Over this, the line is straining; hold it there and it snaps. */
export const TENSION_LIMIT = 100;
const SNAP_AFTER = 0.55;
/** Stop cranking for this long and the fish works itself free. */
const SLACK_AFTER = 3.5;
const LANDED_DEPTH = 2.5;

export type LakeEvent =
  | { kind: "bite"; player: number }
  | { kind: "hooked"; player: number; species: string }
  | { kind: "landed"; player: number; species: string; weight: number }
  | { kind: "snapped"; player: number }
  | { kind: "escaped"; player: number }
  | { kind: "spooked"; player: number };

// --- setup ----------------------------------------------------------------

function pickSpecies(roll: number): Species {
  const total = SPECIES.reduce((sum, s) => sum + s.rarity, 0);
  let target = roll * total;
  for (const species of SPECIES) {
    target -= species.rarity;
    if (target <= 0) return species;
  }
  return SPECIES[0];
}

function spawnFish(lake: Lake, rng: () => number): Fish {
  const species = pickSpecies(rng());
  lake.nextFishId += 1;
  return {
    id: lake.nextFishId,
    species: species.id,
    x: rng() * 100,
    depth: species.minDepth + rng() * (species.maxDepth - species.minDepth),
    dir: rng() > 0.5 ? 1 : -1,
    weight: Number((species.minWeight + rng() * (species.maxWeight - species.minWeight)).toFixed(1)),
    seed: rng() * Math.PI * 2,
    interestedIn: null,
  };
}

export function createLake(players: number[], rng: () => number = Math.random): Lake {
  const lake: Lake = {
    time: 0,
    remaining: ROUND_SECONDS,
    fish: [],
    anglers: [],
    nextFishId: 0,
    over: false,
  };
  // Spread the pier evenly however many turned up, with a margin so nobody
  // is fishing off the edge of the screen.
  const count = Math.max(1, players.length);
  players.forEach((player, index) => {
    lake.anglers.push({
      player,
      x: 8 + ((index + 0.5) / count) * 84,
      phase: "ready",
      depth: 0,
      targetDepth: 0,
      fish: null,
      biteTimer: 0,
      tension: 0,
      strainFor: 0,
      slackFor: 0,
      catches: [],
      score: 0,
      note: "Flick to cast",
      noteFor: 3,
      wobble: 0,
      landing: null,
    });
  });
  for (let i = 0; i < FISH_COUNT; i += 1) lake.fish.push(spawnFish(lake, rng));
  return lake;
}

export function anglerFor(lake: Lake, player: number): Angler | undefined {
  return lake.anglers.find((a) => a.player === player);
}

function say(angler: Angler, note: string, seconds = 2.5) {
  angler.note = note;
  angler.noteFor = seconds;
}

// --- the two things a player does ----------------------------------------

/**
 * Throw the line out. `power` is 0-1, from how hard the phone was flicked:
 * harder casts sink deeper, and the deep water is where the big ones are.
 */
export function castLine(lake: Lake, player: number, power: number): boolean {
  const angler = anglerFor(lake, player);
  if (!angler || lake.over) return false;
  // Not while something is on the hook -- that would just be letting it go.
  if (angler.phase === "hooked" || angler.phase === "landing") return false;

  angler.targetDepth = 6 + Math.max(0, Math.min(1, power)) * 90;
  angler.phase = "sinking";
  angler.fish = null;
  angler.biteTimer = 0;
  angler.tension = 0;
  say(angler, angler.targetDepth > 60 ? "Casting deep…" : "Casting…", 2);
  return true;
}

/**
 * Jerk the phone up. In the bite window that sets the hook; at any other
 * time it just yanks the bait about and scares off anything nearby.
 */
export function strike(lake: Lake, player: number): "hooked" | "early" | "nothing" {
  const angler = anglerFor(lake, player);
  if (!angler || lake.over) return "nothing";

  if (angler.phase === "bite" && angler.fish) {
    angler.phase = "hooked";
    angler.biteTimer = 0;
    angler.tension = 30;
    angler.strainFor = 0;
    angler.slackFor = 0;
    const species = SPECIES_BY_ID.get(angler.fish.species);
    say(angler, species?.junk ? "…that's not a fish." : `${species?.name}! Reel!`, 2.5);
    return "hooked";
  }

  if (angler.phase === "fishing") {
    // Anything nosing at the bait bolts.
    for (const fish of lake.fish) {
      if (fish.interestedIn === player) {
        fish.interestedIn = null;
        fish.dir = fish.x > angler.x ? 1 : -1;
      }
    }
    say(angler, "Too early!", 1.6);
    return "early";
  }

  return "nothing";
}

// --- the clock ------------------------------------------------------------

/**
 * Advances everything by `dt` seconds. `reelRates` is each player's current
 * wrist speed in degrees per second; it is the only continuous input the
 * game has, and it does three different jobs -- adjusting a cast, hauling a
 * fish up, and putting strain on the line.
 */
export function stepLake(
  lake: Lake,
  dt: number,
  reelRates: Record<number, number>,
  rng: () => number = Math.random,
): LakeEvent[] {
  const events: LakeEvent[] = [];
  if (lake.over) return events;

  lake.time += dt;
  lake.remaining = Math.max(0, lake.remaining - dt);
  if (lake.remaining === 0) {
    lake.over = true;
    return events;
  }

  // Fish that nobody has hooked swim about.
  for (const fish of lake.fish) {
    const species = SPECIES_BY_ID.get(fish.species)!;
    const held = lake.anglers.some((a) => a.fish?.id === fish.id);
    if (held) continue;
    if (fish.interestedIn !== null) continue;
    fish.x += species.speed * fish.dir * dt;
    if (fish.x < -4) {
      fish.x = 104;
      fish.dir = -1;
    } else if (fish.x > 104) {
      fish.x = -4;
      fish.dir = 1;
    }
    // A slow drift up and down, so a hook at exactly the right depth still
    // has to wait for the fish to come to it.
    fish.depth += Math.sin(lake.time * 0.5 + fish.seed) * 2 * dt;
    fish.depth = Math.max(species.minDepth, Math.min(species.maxDepth, fish.depth));
  }

  for (const angler of lake.anglers) {
    const reel = Math.max(0, Math.min(1, (reelRates[angler.player] ?? 0) / REEL_FULL));
    angler.noteFor = Math.max(0, angler.noteFor - dt);
    angler.wobble = Math.max(0, angler.wobble - dt * 2);

    if (angler.phase === "landing" && angler.landing) {
      angler.landing.t += dt;
      if (angler.landing.t > 1.6) {
        angler.landing = null;
        angler.phase = "ready";
        say(angler, "Flick to cast again", 2.5);
      }
      continue;
    }

    if (angler.phase === "sinking") {
      angler.depth = Math.min(angler.targetDepth, angler.depth + SINK_SPEED * dt);
      if (angler.depth >= angler.targetDepth - 0.01) {
        angler.phase = "fishing";
        say(angler, "Waiting for a bite…", 2);
      }
      continue;
    }

    if (angler.phase === "fishing") {
      // Cranking here just winds the bait back up, which is how you fish a
      // shallower depth without recasting.
      if (reel > 0.15) {
        angler.depth = Math.max(4, angler.depth - ADJUST_SPEED * reel * dt);
        angler.targetDepth = angler.depth;
      }

      let interested: Fish | null = null;
      for (const fish of lake.fish) {
        if (fish.interestedIn !== null && fish.interestedIn !== angler.player) continue;
        if (Math.abs(fish.depth - angler.depth) > BITE_DEPTH) continue;
        if (Math.abs(fish.x - angler.x) > BITE_X) continue;
        interested = fish;
        break;
      }

      if (interested) {
        interested.interestedIn = angler.player;
        angler.wobble = 1;
        if (rng() < BITE_CHANCE * dt) {
          angler.phase = "bite";
          angler.fish = interested;
          angler.biteTimer = BITE_WINDOW;
          say(angler, "BITE! Jerk up!", BITE_WINDOW);
          events.push({ kind: "bite", player: angler.player });
        }
      } else {
        // Whatever was sniffing about has lost interest.
        for (const fish of lake.fish) {
          if (fish.interestedIn === angler.player) fish.interestedIn = null;
        }
      }
      continue;
    }

    if (angler.phase === "bite") {
      angler.biteTimer -= dt;
      angler.wobble = 1;
      if (angler.biteTimer <= 0) {
        if (angler.fish) angler.fish.interestedIn = null;
        angler.fish = null;
        angler.phase = "fishing";
        say(angler, "…it let go.", 2);
      }
      continue;
    }

    if (angler.phase === "hooked" && angler.fish) {
      const fish = angler.fish;
      const species = SPECIES_BY_ID.get(fish.species)!;
      // The fish doesn't pull steadily -- it surges, which is what makes
      // "crank, ease off, crank" the right way to play rather than
      // "crank as hard as you can".
      const surge = 0.55 + 0.45 * Math.sin(lake.time * 2.2 + fish.seed);
      const pull = species.fight * surge;

      angler.depth += (pull * 4 - REEL_SPEED * reel) * dt;
      angler.depth = Math.max(0, Math.min(100, angler.depth));
      fish.depth = angler.depth;
      fish.x += (angler.x - fish.x) * Math.min(1, dt * 4);

      angler.tension += (reel * TENSION_FROM_REEL + pull * TENSION_FROM_FISH - TENSION_RELAX) * dt;
      angler.tension = Math.max(0, Math.min(140, angler.tension));

      angler.strainFor = angler.tension >= TENSION_LIMIT ? angler.strainFor + dt : 0;
      angler.slackFor = reel < 0.15 ? angler.slackFor + dt : 0;

      if (angler.strainFor >= SNAP_AFTER) {
        events.push({ kind: "snapped", player: angler.player });
        say(angler, "The line snapped!", 3);
        releaseFish(lake, angler, rng);
        continue;
      }
      if (angler.slackFor >= SLACK_AFTER) {
        events.push({ kind: "escaped", player: angler.player });
        say(angler, "It shook itself free.", 3);
        releaseFish(lake, angler, rng);
        continue;
      }
      if (angler.depth <= LANDED_DEPTH) {
        const weight = fish.weight;
        angler.catches.push({ species: fish.species, weight, at: lake.time });
        angler.score = Number((angler.score + weight).toFixed(2));
        angler.landing = { species: fish.species, weight, t: 0 };
        angler.phase = "landing";
        angler.tension = 0;
        say(angler, `${species.name}, ${weight.toFixed(1)}kg!`, 3);
        events.push({ kind: "landed", player: angler.player, species: fish.species, weight });
        // Straight back in the water as a new fish somewhere else, so the
        // lake never empties out.
        lake.fish = lake.fish.filter((f) => f.id !== fish.id);
        lake.fish.push(spawnFish(lake, rng));
        angler.fish = null;
      }
    }
  }

  return events;
}

/** Lets a hooked fish go and puts a fresh one in the water. */
function releaseFish(lake: Lake, angler: Angler, rng: () => number) {
  const fish = angler.fish;
  angler.fish = null;
  angler.phase = "ready";
  angler.tension = 0;
  angler.strainFor = 0;
  angler.slackFor = 0;
  angler.depth = 0;
  if (fish) {
    lake.fish = lake.fish.filter((f) => f.id !== fish.id);
    lake.fish.push(spawnFish(lake, rng));
  }
}

/** Final standings, heaviest bag first. */
export function standings(lake: Lake): { player: number; score: number; best: Catch | null; count: number }[] {
  return lake.anglers
    .map((a) => ({
      player: a.player,
      score: a.score,
      count: a.catches.length,
      best: a.catches.reduce<Catch | null>((best, c) => (!best || c.weight > best.weight ? c : best), null),
    }))
    .sort((x, y) => y.score - x.score);
}

// --- reading a wrist ------------------------------------------------------

/** Shortest signed distance between two angles in degrees. */
export function angleDelta(a: number, b: number): number {
  return ((((a - b + 540) % 360) + 360) % 360) - 180;
}

/**
 * How fast the phone is being turned, in degrees per second, from two
 * orientation samples.
 *
 * Cranking is measured as total angular speed across all three axes rather
 * than rotation about one of them, because there is no telling how somebody
 * is holding the thing -- and winding a reel is a wrist motion that shows up
 * on whichever axes happen to be pointing the right way. Any vigorous
 * circling counts, which is both robust and what a player expects.
 */
export function crankSpeed(
  prev: { alpha: number; beta: number; gamma: number },
  next: { alpha: number; beta: number; gamma: number },
  dt: number,
): number {
  if (dt <= 0) return 0;
  const total =
    Math.abs(angleDelta(next.alpha, prev.alpha)) +
    Math.abs(angleDelta(next.beta, prev.beta)) +
    Math.abs(angleDelta(next.gamma, prev.gamma));
  return total / dt;
}
