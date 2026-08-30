// Texas hold 'em card model and hand evaluation. Pure, so it can be tested
// directly -- which matters here more than anywhere else in the app, because
// a subtly wrong evaluator hands the pot to the wrong person and nobody at
// the table can tell why.

export type Suit = "s" | "h" | "d" | "c";

export interface Card {
  /** 2-14, where 11-14 are J, Q, K, A. */
  rank: number;
  suit: Suit;
}

export const SUITS: Suit[] = ["s", "h", "d", "c"];
export const SUIT_SYMBOL: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const SUIT_IS_RED: Record<Suit, boolean> = { s: false, h: true, d: true, c: false };

const RANK_NAMES: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

export function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? String(rank);
}

export function cardLabel(card: Card): string {
  return `${rankName(card.rank)}${SUIT_SYMBOL[card.suit]}`;
}

export function cardId(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank, suit });
  }
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

/** Hand categories, high to low. */
export const HAND_NAMES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

export interface HandScore {
  /** Index into HAND_NAMES; higher beats lower. */
  category: number;
  /** Ranks that break ties within a category, most significant first. */
  tiebreak: number[];
  name: string;
  /** The five cards that actually make the hand. */
  cards: Card[];
}

/** Lexicographic compare: positive when `a` is the better hand. */
export function compareHands(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Highest card of a run of five, or 0. Aces play low for the 5-4-3-2-A wheel. */
function straightHigh(ranks: number[]): number {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  // An ace can start the wheel, so add it as a 1 as well.
  if (unique.includes(14)) unique.push(1);
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === unique[i - 1] - 1) {
      run += 1;
      if (run >= 5) return unique[i] + 4;
    } else {
      run = 1;
    }
  }
  return 0;
}

/** Score exactly five cards. */
export function score5(cards: Card[]): HandScore {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const bySuit = new Map<Suit, number>();
  for (const card of cards) bySuit.set(card.suit, (bySuit.get(card.suit) ?? 0) + 1);
  const isFlush = bySuit.size === 1;
  const high = straightHigh(ranks);

  // Group ranks by how many of each there are, then order by count first and
  // rank second -- which is exactly the tiebreak order for pairs and trips.
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = grouped.map(([, count]) => count);
  const ordered = grouped.map(([rank]) => rank);

  const make = (category: number, tiebreak: number[]): HandScore => ({
    category,
    tiebreak,
    name: HAND_NAMES[category],
    cards,
  });

  if (isFlush && high) return make(8, [high]);
  if (shape[0] === 4) return make(7, ordered);
  if (shape[0] === 3 && shape[1] === 2) return make(6, ordered);
  if (isFlush) return make(5, ranks);
  if (high) return make(4, [high]);
  if (shape[0] === 3) return make(3, ordered);
  if (shape[0] === 2 && shape[1] === 2) return make(2, ordered);
  if (shape[0] === 2) return make(1, ordered);
  return make(0, ranks);
}

/**
 * Best five-card hand out of seven (two hole cards plus five community).
 * All 21 combinations are scored and the best kept -- obvious rather than
 * clever, and 21 is nothing.
 */
export function bestHand(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error("need at least five cards to score a hand");
  let best: HandScore | null = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const score = score5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareHands(score, best) > 0) best = score;
          }
        }
      }
    }
  }
  return best!;
}
