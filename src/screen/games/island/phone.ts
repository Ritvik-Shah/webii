import type { PhoneChoice, PhoneView } from "../../../../shared/protocol";
import {
  FOODS,
  INTERIORS,
  LOCATIONS,
  OUTFITS,
  TYPE_BLURBS,
  answerConfession,
  answerProposal,
  cheerUp,
  claimReward,
  decorate,
  dress,
  feed,
  friendshipLabel,
  isUnlocked,
  nameOf,
  personalityFor,
  priceOf,
  requestsFor,
  residentById,
  rewardChoices,
  settleQuarrel,
  solved,
  type ActionResult,
  type Island,
  type IslandRequest,
  type Resident,
} from "./sim";

// The phone is the island's bottom screen. Everything you actually *do* --
// feeding, dressing, decorating, answering the awkward questions -- happens
// here, on your own phone, for your own Miis, while the TV shows the island
// getting on with itself.
//
// It is all expressed in the generic PhoneView vocabulary, so this channel
// needed no new phone-side code at all.

export type Nav =
  | { screen: "root" }
  | { screen: "resident"; id: string }
  | { screen: "feed"; id: string }
  | { screen: "outfit"; id: string }
  | { screen: "room"; id: string }
  | { screen: "cheer"; id: string }
  | { screen: "profile"; id: string };

export const ROOT: Nav = { screen: "root" };

/** Residents this player is responsible for. The host also looks after
 * anyone who moved in without an owner. */
export function myResidents(island: Island, player: number, isHost: boolean): Resident[] {
  return island.residents.filter((r) => r.owner === player || (isHost && r.owner === 0));
}

function happinessBar(resident: Resident): string {
  const filled = Math.round(resident.happiness / 10);
  return "█".repeat(filled) + "·".repeat(10 - filled);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function requestView(island: Island, request: IslandRequest): PhoneView {
  const resident = residentById(island, request.resident);
  if (!resident) return { title: "…never mind.", waiting: true };
  const later: PhoneChoice = { id: `req|${request.id}|skip`, label: "Not right now" };

  switch (request.kind) {
    case "hungry":
      return {
        title: `${resident.mii.name} is hungry`,
        subtitle: "What are they having?",
        choices: [...foodChoices(island, resident, `req|${request.id}|food`), later],
      };
    case "clothes":
      return {
        title: `${resident.mii.name} wants a change of clothes`,
        subtitle: `${island.coins} coins`,
        choices: [...outfitChoices(island, `req|${request.id}|outfit`), later],
      };
    case "interior":
      return {
        title: `${resident.mii.name} is bored of these walls`,
        subtitle: `${island.coins} coins`,
        choices: [...interiorChoices(island, `req|${request.id}|room`), later],
      };
    case "bored":
      return {
        title: `${resident.mii.name} has nothing to do`,
        subtitle: "Send them somewhere.",
        choices: [...placeChoices(island, `req|${request.id}|place`), later],
      };
    case "levelup":
      return {
        title: `${resident.mii.name} reached level ${resident.level}!`,
        subtitle: "Pick something for them.",
        choices: rewardChoices(island, resident).map((c) => ({ id: `req|${request.id}|reward|${c.id}`, label: c.label })),
      };
    case "confess":
      return {
        title: `${resident.mii.name} likes ${nameOf(island, request.other ?? "")}`,
        subtitle: "Should they say something?",
        note: "You can push them into it, but you can't decide the answer.",
        choices: [
          { id: `req|${request.id}|yes`, label: "Go on, tell them" },
          { id: `req|${request.id}|no`, label: "Keep it quiet for now" },
        ],
      };
    case "propose":
      return {
        title: `${resident.mii.name} wants to propose to ${nameOf(island, request.other ?? "")}`,
        subtitle: "Well?",
        choices: [
          { id: `req|${request.id}|yes`, label: "Ask them!" },
          { id: `req|${request.id}|no`, label: "Maybe wait" },
        ],
      };
    case "quarrel":
      return {
        title: `${resident.mii.name} and ${nameOf(island, request.other ?? "")} have fallen out`,
        subtitle: "How do you want to handle it?",
        choices: [
          { id: `req|${request.id}|talk`, label: "Sit them down and talk" },
          { id: `req|${request.id}|gift`, label: "Peace offering (20 coins)" },
          { id: `req|${request.id}|leave`, label: "Leave them to it" },
        ],
      };
    default:
      return { title: "Nothing to do", waiting: true };
  }
}

/** Best first. Twenty-six items is a long scroll on a phone, and what you
 * want is nearly always something already in the pantry or something you
 * have learnt they love -- so those come to the top, and anything you know
 * they hate sinks to the bottom. */
const REACTION_RANK: Record<string, number> = {
  "Super All-Time Favourite": 0,
  "All-Time Favourite": 1,
  "Likes It": 2,
  "So-So": 4,
  "Doesn't Like It": 6,
  "Worst Food Ever": 7,
};

function foodChoices(island: Island, resident: Resident, prefix: string): PhoneChoice[] {
  return FOODS.map((food) => {
    const cost = priceOf(island, food.id);
    const known = resident.discovered[food.id];
    const tail = cost === 0 ? "in the pantry" : `${cost}c`;
    return {
      choice: {
        id: `${prefix}|${food.id}`,
        label: `${food.icon} ${food.name} · ${tail}${known ? ` · ${known}` : ""}`,
      },
      // Unknown foods sit in the middle: worth a try, but not ahead of a
      // known favourite.
      rank: (cost === 0 ? -1 : 0) + (known ? REACTION_RANK[known] : 3),
      price: food.price,
    };
  })
    .sort((a, b) => a.rank - b.rank || a.price - b.price)
    .map((row) => row.choice);
}

function outfitChoices(island: Island, prefix: string): PhoneChoice[] {
  return OUTFITS.map((outfit) => ({
    id: `${prefix}|${outfit.id}`,
    label: `${outfit.name} · ${island.wardrobe.includes(outfit.id) ? "owned" : `${outfit.price}c`}`,
  }));
}

function interiorChoices(island: Island, prefix: string): PhoneChoice[] {
  return INTERIORS.map((interior) => ({
    id: `${prefix}|${interior.id}`,
    label: `${interior.prop} ${interior.name} · ${island.interiors.includes(interior.id) ? "owned" : `${interior.price}c`}`,
  }));
}

/** Somewhere to send a bored Mii: only the places the island has unlocked. */
function placeChoices(island: Island, prefix: string): PhoneChoice[] {
  return LOCATIONS.filter((l) => ["park", "cafe", "beach", "amusement", "tower", "fountain"].includes(l.id))
    .filter((l) => isUnlocked(island, l))
    .map((l) => ({ id: `${prefix}|${l.id}`, label: `${l.icon} ${l.name}` }));
}

function placeName(id: string): string {
  return LOCATIONS.find((l) => l.id === id)?.name ?? id;
}

function profileView(island: Island, resident: Resident): PhoneView {
  const person = personalityFor(resident.mii);
  const tastes = Object.entries(resident.discovered)
    .map(([foodId, reaction]) => `${FOODS.find((f) => f.id === foodId)?.name ?? foodId}: ${reaction}`)
    .slice(0, 8);
  const bonds = island.bonds
    .filter((b) => b.a === resident.id || b.b === resident.id)
    .sort((x, y) => y.friendship - x.friendship)
    .slice(0, 5)
    .map((b) => {
      const otherId = b.a === resident.id ? b.b : b.a;
      const label = b.status === "married" ? "Married" : b.status === "sweethearts" ? "Sweethearts" : friendshipLabel(b.friendship);
      return `${nameOf(island, otherId)} — ${label}${b.quarrel ? " (fighting)" : ""}`;
    });

  return {
    title: resident.mii.name,
    subtitle: `${person.type} · ${person.category} · Level ${resident.level}`,
    note: [
      TYPE_BLURBS[person.type] ?? "",
      `Happiness ${happinessBar(resident)}`,
      resident.catchphrase ? `Says: “${resident.catchphrase}”` : "",
      tastes.length ? `Tastes you know: ${tastes.join(", ")}` : "Tastes you know: none yet — feed them something.",
      bonds.length ? bonds.join(" · ") : "Hasn't met anyone yet.",
    ]
      .filter(Boolean)
      .join("\n"),
    actions: [{ id: `nav|resident|${resident.id}`, label: "Back", style: "muted" }],
  };
}

/** The whole phone screen for one player, given where they've navigated to. */
export function phoneViewFor(island: Island, player: number, isHost: boolean, nav: Nav): PhoneView {
  const pending = requestsFor(island, player, isHost);
  // A Mii asking for something always jumps the queue -- that is the game.
  if (pending.length > 0) return requestView(island, pending[0]);

  const mine = myResidents(island, player, isHost);

  if (nav.screen !== "root") {
    const resident = residentById(island, nav.id);
    if (!resident) return phoneViewFor(island, player, isHost, ROOT);

    if (nav.screen === "profile") return profileView(island, resident);

    const back: PhoneChoice = { id: `nav|resident|${resident.id}`, label: "Back" };
    if (nav.screen === "feed") {
      return {
        title: `Feed ${resident.mii.name}`,
        subtitle: `${island.coins} coins · hunger ${Math.round(resident.hunger)}%`,
        choices: [...foodChoices(island, resident, `do|feed|${resident.id}`), back],
      };
    }
    if (nav.screen === "outfit") {
      return {
        title: `Dress ${resident.mii.name}`,
        subtitle: `${island.coins} coins`,
        choices: [...outfitChoices(island, `do|outfit|${resident.id}`), back],
      };
    }
    if (nav.screen === "room") {
      return {
        title: `${resident.mii.name}'s room`,
        subtitle: `${island.coins} coins`,
        choices: [...interiorChoices(island, `do|room|${resident.id}`), back],
      };
    }
    if (nav.screen === "cheer") {
      const places = placeChoices(island, `do|cheer|${resident.id}`);
      return {
        title: `Where should ${resident.mii.name} go?`,
        subtitle: places.length ? "" : "Nowhere is open yet — solve a few problems first.",
        choices: [...places, back],
      };
    }

    // The resident menu itself.
    const person = personalityFor(resident.mii);
    return {
      title: resident.mii.name,
      subtitle: `${person.type} · Level ${resident.level} · ${happinessBar(resident)}`,
      choices: [
        { id: `nav|feed|${resident.id}`, label: "🍽️ Feed them" },
        { id: `nav|outfit|${resident.id}`, label: "👕 Something to wear" },
        { id: `nav|room|${resident.id}`, label: "🛋️ Redecorate" },
        { id: `nav|cheer|${resident.id}`, label: "🎡 Send them out" },
        { id: `nav|profile|${resident.id}`, label: "📋 Profile" },
        { id: "nav|root", label: "Back to the island" },
      ],
    };
  }

  if (mine.length === 0) {
    return {
      title: "Mii Island",
      note: "None of the residents are yours yet. Pick a Mii on the way in and they'll move into the apartments.",
      waiting: true,
    };
  }

  return {
    title: "Mii Island",
    subtitle: `${island.coins} coins · ${island.residents.length} residents · ${island.problemsSolved} problems solved`,
    choices: mine.map((r) => ({
      id: `nav|resident|${r.id}`,
      label: `${r.mii.name} · Lv ${r.level} · ${happinessBar(r)}${r.hunger >= 75 ? " 🍽️" : ""}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Acting
// ---------------------------------------------------------------------------

export interface PhoneOutcome {
  nav: Nav;
  result?: ActionResult;
}

function resolveRequest(island: Island, request: IslandRequest, rest: string[]): ActionResult | undefined {
  const answer = rest[0];
  if (answer === "skip") {
    // Straight to the back of the queue -- not solved, just not now.
    island.requests = island.requests.filter((r) => r.id !== request.id);
    island.requests.push(request);
    return undefined;
  }

  const finish = (result: ActionResult) => {
    if (result.ok) {
      island.requests = island.requests.filter((r) => r.id !== request.id);
      solved(island, request.resident);
    }
    return result;
  };

  switch (request.kind) {
    case "hungry":
      return finish(feed(island, request.resident, rest[1]));
    case "clothes":
      return finish(dress(island, request.resident, rest[1]));
    case "interior":
      return finish(decorate(island, request.resident, rest[1]));
    case "bored":
      return cheerUp(island, request.resident, placeName(rest[1]));
    case "levelup": {
      // `reward|<kind>:<value>` -- the reward id keeps its own colon form.
      const choice = rest.slice(1).join("|");
      return finish(claimReward(island, request.resident, choice));
    }
    case "confess":
      return answerConfession(island, request.id, answer === "yes");
    case "propose":
      return answerProposal(island, request.id, answer === "yes");
    case "quarrel":
      return settleQuarrel(island, request.id, answer as "talk" | "gift" | "leave");
    default:
      return undefined;
  }
}

/**
 * Applies one tap. Mutates `island` in place (the screen hands it a fresh
 * copy) and reports where the phone should go next.
 */
export function applyPhoneAction(island: Island, nav: Nav, id: string): PhoneOutcome {
  const parts = id.split("|");
  const [verb] = parts;

  if (verb === "nav") {
    const [, screen, residentId] = parts;
    if (screen === "root") return { nav: ROOT };
    if (!residentId) return { nav };
    return { nav: { screen: screen as Exclude<Nav, { screen: "root" }>["screen"], id: residentId } };
  }

  if (verb === "do") {
    const [, what, residentId, value] = parts;
    if (what === "feed") return { nav, result: feed(island, residentId, value) };
    if (what === "outfit") return { nav, result: dress(island, residentId, value) };
    if (what === "room") return { nav, result: decorate(island, residentId, value) };
    if (what === "cheer") return { nav: { screen: "resident", id: residentId }, result: cheerUp(island, residentId, placeName(value)) };
    return { nav };
  }

  if (verb === "req") {
    const [, requestId, ...rest] = parts;
    const request = island.requests.find((r) => r.id === requestId);
    if (!request) return { nav };
    return { nav, result: resolveRequest(island, request, rest) };
  }

  return { nav };
}
