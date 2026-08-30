// Uno rules, kept pure so they can be tested without a room, a phone or a
// renderer. Deck composition, scoring and legality follow the published
// rules: 108 cards, seven dealt, match on colour/number/symbol, and a Wild
// Draw Four only when you hold nothing of the current colour.

export type UnoColor = "red" | "yellow" | "green" | "blue";
export type UnoKind = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface UnoCard {
  /** Unique within a deck, so a phone can name exactly which card it played. */
  id: string;
  kind: UnoKind;
  /** Absent on wilds until one is played and a colour is declared. */
  color?: UnoColor;
  /** 0-9, only on number cards. */
  value?: number;
}

export const UNO_COLORS: UnoColor[] = ["red", "yellow", "green", "blue"];

/** Display colours for the table and the phone. */
export const COLOR_HEX: Record<UnoColor, string> = {
  red: "#d3323a",
  yellow: "#e8b21c",
  green: "#3a9e46",
  blue: "#2f6fd0",
};

export const HAND_SIZE = 7;

/**
 * A full 108-card deck: per colour one 0, two each of 1-9, and two each of
 * Skip, Reverse and Draw Two (25 a colour, 100 total), plus four Wilds and
 * four Wild Draw Fours.
 */
export function buildDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  let n = 0;
  const add = (card: Omit<UnoCard, "id">) => deck.push({ ...card, id: `c${n++}` });

  for (const color of UNO_COLORS) {
    add({ kind: "number", color, value: 0 });
    for (let value = 1; value <= 9; value++) {
      add({ kind: "number", color, value });
      add({ kind: "number", color, value });
    }
    for (const kind of ["skip", "reverse", "draw2"] as const) {
      add({ kind, color });
      add({ kind, color });
    }
  }
  for (let i = 0; i < 4; i++) add({ kind: "wild" });
  for (let i = 0; i < 4; i++) add({ kind: "wild4" });
  return deck;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function cardLabel(card: UnoCard): string {
  switch (card.kind) {
    case "number":
      return String(card.value);
    case "skip":
      return "Skip";
    case "reverse":
      return "Reverse";
    case "draw2":
      return "+2";
    case "wild":
      return "Wild";
    case "wild4":
      return "Wild +4";
  }
}

/** Points the card is worth to the winner: face value, 20, or 50. */
export function cardPoints(card: UnoCard): number {
  if (card.kind === "number") return card.value ?? 0;
  if (card.kind === "wild" || card.kind === "wild4") return 50;
  return 20;
}

export function handPoints(hand: UnoCard[]): number {
  return hand.reduce((total, card) => total + cardPoints(card), 0);
}

/**
 * Can `card` be played onto a discard of `activeColor` / `top`?
 *
 * Wild Draw Four is the special one: the rules only allow it when you hold
 * nothing of the current colour, so legality depends on the whole hand, not
 * just the card. Enforcing it here means there is nothing to challenge --
 * a simpler fit for a party game than the accuse-and-reveal rule.
 */
export function canPlay(card: UnoCard, top: UnoCard, activeColor: UnoColor, hand: UnoCard[]): boolean {
  if (card.kind === "wild4") return !hand.some((c) => c.color === activeColor);
  if (card.kind === "wild") return true;
  if (card.color === activeColor) return true;
  if (card.kind === "number" && top.kind === "number") return card.value === top.value;
  return card.kind === top.kind && card.kind !== "number";
}

export function playableCards(hand: UnoCard[], top: UnoCard, activeColor: UnoColor): UnoCard[] {
  return hand.filter((card) => canPlay(card, top, activeColor, hand));
}

/**
 * Who plays after `index`, given the table size and direction. `skip` steps
 * over one extra player, which is what Skip does -- and what Reverse does in
 * a two-player game, where reversing would otherwise hand the turn straight
 * back.
 */
export function nextIndex(index: number, count: number, direction: 1 | -1, skip = false): number {
  const step = skip ? 2 : 1;
  return (((index + direction * step) % count) + count) % count;
}

/** Draw `count` cards, reshuffling the discard back in if the pile runs dry. */
export function drawCards(
  draw: UnoCard[],
  discard: UnoCard[],
  count: number,
  random: () => number = Math.random,
): { drawn: UnoCard[]; draw: UnoCard[]; discard: UnoCard[] } {
  let pile = [...draw];
  let used = [...discard];
  const drawn: UnoCard[] = [];

  for (let i = 0; i < count; i++) {
    if (pile.length === 0) {
      // The top discard stays face up; everything under it is reshuffled.
      if (used.length <= 1) break; // nothing left anywhere -- stop rather than loop
      const top = used[used.length - 1];
      pile = shuffle(used.slice(0, -1), random).map((card) =>
        card.kind === "wild" || card.kind === "wild4" ? { ...card, color: undefined } : card,
      );
      used = [top];
    }
    const card = pile.pop();
    if (!card) break;
    drawn.push(card);
  }

  return { drawn, draw: pile, discard: used };
}
