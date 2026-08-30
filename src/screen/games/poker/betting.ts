// No-limit hold 'em betting. Pure and separate from the renderer, because
// blinds, raise sizing and side pots are the parts most likely to be subtly
// wrong, and the only way to know they aren't is to play hands at them
// directly.

import { bestHand, compareHands, type Card } from "./hands";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "done";

export interface Seat {
  /** Room player number, so the host knows which phone this is. */
  player: number;
  chips: number;
  /** Committed on the current street. */
  bet: number;
  /** Committed across the whole hand -- what side pots are built from. */
  committed: number;
  folded: boolean;
  allIn: boolean;
  hole: Card[];
}

export interface Pot {
  amount: number;
  /** Seat indexes eligible to win this pot. */
  eligible: number[];
}

export interface HandState {
  seats: Seat[];
  deck: Card[];
  community: Card[];
  /** Seat index of the dealer button. */
  button: number;
  toAct: number;
  street: Street;
  /** Highest total bet on this street. */
  currentBet: number;
  /** Size of the last bet or raise: the minimum a re-raise must add. */
  minRaise: number;
  /** Has this seat acted since the last aggressive action? */
  actedSinceRaise: boolean[];
  smallBlind: number;
  bigBlind: number;
  log: string[];
  /** Set once the hand is over. */
  payouts?: { seat: number; amount: number; reason: string }[];
}

export type PokerAction =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }
  /** Total this seat's bet becomes on this street, not the increment. */
  | { kind: "raise"; to: number };

const seatCount = (state: HandState) => state.seats.length;

/** Next seat clockwise that is still in the hand and able to act. */
function nextActive(state: HandState, from: number): number {
  const n = seatCount(state);
  for (let step = 1; step <= n; step++) {
    const index = (from + step) % n;
    const seat = state.seats[index];
    if (!seat.folded && !seat.allIn) return index;
  }
  return from;
}

/** Next seat clockwise still holding cards, all-in or not. */
function nextInHand(state: HandState, from: number): number {
  const n = seatCount(state);
  for (let step = 1; step <= n; step++) {
    const index = (from + step) % n;
    if (!state.seats[index].folded) return index;
  }
  return from;
}

function post(seat: Seat, amount: number): number {
  const paid = Math.min(seat.chips, amount);
  seat.chips -= paid;
  seat.bet += paid;
  seat.committed += paid;
  if (seat.chips === 0) seat.allIn = true;
  return paid;
}

/**
 * Deal a hand. `deck` should already be shuffled; cards are taken from the
 * end. Blinds follow the standard arrangement -- small blind left of the
 * button, big blind next -- except heads-up, where the button posts the
 * small blind and acts first before the flop.
 */
export function startHand(
  seats: Seat[],
  button: number,
  smallBlind: number,
  bigBlind: number,
  deck: Card[],
): HandState {
  const working = seats.map((seat) => ({
    ...seat,
    bet: 0,
    committed: 0,
    // A player with no chips is not dealt in. Seating them anyway let them
    // be the last player standing having committed nothing, which orphaned
    // every pot slice and made the chips vanish.
    folded: seat.chips <= 0,
    allIn: false,
    hole: [] as Card[],
  }));
  const n = working.length;
  const heads = n === 2;
  const sbSeat = heads ? button : (button + 1) % n;
  const bbSeat = heads ? (button + 1) % n : (button + 2) % n;

  const state: HandState = {
    seats: working,
    deck: [...deck],
    community: [],
    button,
    toAct: 0,
    street: "preflop",
    currentBet: bigBlind,
    minRaise: bigBlind,
    actedSinceRaise: working.map(() => false),
    smallBlind,
    bigBlind,
    log: [],
  };

  post(working[sbSeat], smallBlind);
  post(working[bbSeat], bigBlind);
  state.log.unshift(`Player ${working[sbSeat].player} posts ${smallBlind}, Player ${working[bbSeat].player} posts ${bigBlind}`);

  // Two down each, dealt one at a time from the small blind round.
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < n; i++) {
      const seat = working[(sbSeat + i) % n];
      if (seat.folded) continue; // sitting out with no chips
      seat.hole.push(state.deck.pop()!);
    }
  }

  // Pre-flop action starts left of the big blind; heads-up that is the button.
  state.toAct = heads ? sbSeat : (bbSeat + 1) % n;
  return state;
}

export interface LegalActions {
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to match the current bet, capped at the seat's stack. */
  callAmount: number;
  canRaise: boolean;
  /** Lowest legal total to raise to. */
  minRaiseTo: number;
  /** Everything this seat has: their all-in total. */
  maxRaiseTo: number;
}

export function legalActions(state: HandState): LegalActions {
  const seat = state.seats[state.toAct];
  const toCall = Math.min(state.currentBet - seat.bet, seat.chips);
  const maxRaiseTo = seat.bet + seat.chips;
  // A raise has to at least match the previous raise, unless the seat is
  // going all-in for less, which is always allowed.
  const minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo);
  return {
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount: toCall,
    canRaise: maxRaiseTo > state.currentBet,
    minRaiseTo,
    maxRaiseTo,
  };
}

/** Everyone still in the hand who could still act. */
function activeSeats(state: HandState): number[] {
  return state.seats.map((s, i) => (!s.folded && !s.allIn ? i : -1)).filter((i) => i >= 0);
}

function bettingClosed(state: HandState): boolean {
  const active = activeSeats(state);
  // Nobody left to act, or everyone has acted and matched the bet.
  if (active.length === 0) return true;
  if (active.length === 1) {
    const only = active[0];
    // A lone active player still owes an action if they are facing a bet or
    // haven't acted yet this street (they may still bet into all-in callers).
    return state.actedSinceRaise[only] && state.seats[only].bet >= state.currentBet;
  }
  return active.every((i) => state.actedSinceRaise[i] && state.seats[i].bet === state.currentBet);
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

function beginStreet(state: HandState, street: Street) {
  state.street = street;
  for (const seat of state.seats) seat.bet = 0;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.actedSinceRaise = state.seats.map(() => false);
  // Post-flop, action opens to the left of the button.
  state.toAct = nextActive(state, state.button);
}

function dealStreet(state: HandState, street: Street) {
  // One card is burned before each of the flop, turn and river.
  state.deck.pop();
  const count = street === "flop" ? 3 : 1;
  for (let i = 0; i < count; i++) state.community.push(state.deck.pop()!);
}

/** Build the main pot and any side pots from what each seat put in. */
export function buildPots(seats: Seat[]): Pot[] {
  const levels = [...new Set(seats.filter((s) => s.committed > 0).map((s) => s.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;
  // Chips from a level nobody eligible contested are carried into the next
  // pot rather than dropped -- money must never leave the table.
  let carry = 0;
  for (const level of levels) {
    const slice = level - previous;
    const contributors = seats.filter((s) => s.committed >= level);
    const amount = slice * contributors.length;
    // Only players still holding cards can win it; folded money still counts.
    const eligible = seats
      .map((s, i) => (s.committed >= level && !s.folded ? i : -1))
      .filter((i) => i >= 0);
    if (amount > 0 && eligible.length > 0) {
      pots.push({ amount: amount + carry, eligible });
      carry = 0;
    } else {
      carry += amount;
    }
    previous = level;
  }
  if (carry > 0) {
    if (pots.length > 0) pots[pots.length - 1].amount += carry;
    else {
      // Nobody eligible anywhere: give it to whoever is still holding cards.
      const remaining = seats.map((s, i) => (!s.folded ? i : -1)).filter((i) => i >= 0);
      if (remaining.length > 0) pots.push({ amount: carry, eligible: remaining });
    }
  }
  return pots;
}

/** Award every pot and finish the hand. */
export function settle(state: HandState): HandState {
  const payouts: { seat: number; amount: number; reason: string }[] = [];
  const remaining = state.seats.map((s, i) => (!s.folded ? i : -1)).filter((i) => i >= 0);

  for (const pot of buildPots(state.seats)) {
    const contenders = pot.eligible.filter((i) => remaining.includes(i));
    if (contenders.length === 0) continue;

    let winners = contenders;
    let reason = "last player standing";
    if (contenders.length > 1) {
      const scored = contenders.map((i) => ({ i, score: bestHand([...state.seats[i].hole, ...state.community]) }));
      scored.sort((a, b) => compareHands(b.score, a.score));
      const best = scored[0].score;
      winners = scored.filter((s) => compareHands(s.score, best) === 0).map((s) => s.i);
      reason = best.name;
    }

    // Split as evenly as chips allow; the odd chip goes left of the button.
    const share = Math.floor(pot.amount / winners.length);
    let extra = pot.amount - share * winners.length;
    for (const seat of winners) {
      let amount = share;
      if (extra > 0) {
        amount += 1;
        extra -= 1;
      }
      state.seats[seat].chips += amount;
      payouts.push({ seat, amount, reason });
    }
  }

  state.payouts = payouts;
  state.street = "done";
  for (const payout of payouts) {
    state.log.unshift(`Player ${state.seats[payout.seat].player} wins ${payout.amount} (${payout.reason})`);
  }
  return state;
}

/** Move the hand on once the current betting round has closed. */
function advance(state: HandState): HandState {
  const stillIn = state.seats.filter((s) => !s.folded);
  if (stillIn.length === 1) return settle(state);

  while (bettingClosed(state)) {
    const next = STREET_ORDER[STREET_ORDER.indexOf(state.street) + 1];
    if (!next || next === "showdown") {
      // Any community cards still owed are dealt out before showdown, which
      // is what happens when everyone is all-in.
      while (state.community.length < 5) {
        dealStreet(state, state.community.length === 0 ? "flop" : "turn");
      }
      return settle(state);
    }
    dealStreet(state, next);
    beginStreet(state, next);
    // With at most one player able to act, there is no betting to do here --
    // loop round and deal the next street.
    if (activeSeats(state).length <= 1) continue;
    return state;
  }
  return state;
}

export function applyAction(state: HandState, action: PokerAction): HandState {
  if (state.street === "done") return state;
  const next: HandState = {
    ...state,
    seats: state.seats.map((seat) => ({ ...seat, hole: [...seat.hole] })),
    community: [...state.community],
    deck: [...state.deck],
    actedSinceRaise: [...state.actedSinceRaise],
    log: [...state.log],
  };
  const index = next.toAct;
  const seat = next.seats[index];
  const legal = legalActions(next);
  const who = `Player ${seat.player}`;

  switch (action.kind) {
    case "fold":
      seat.folded = true;
      next.log.unshift(`${who} folds`);
      break;
    case "check":
      if (!legal.canCheck) return state;
      next.log.unshift(`${who} checks`);
      break;
    case "call": {
      if (!legal.canCall) return state;
      const paid = post(seat, legal.callAmount);
      next.log.unshift(seat.allIn ? `${who} calls ${paid} and is all in` : `${who} calls ${paid}`);
      break;
    }
    case "raise": {
      if (!legal.canRaise) return state;
      const to = Math.max(legal.minRaiseTo, Math.min(action.to, legal.maxRaiseTo));
      const increase = to - next.currentBet;
      post(seat, to - seat.bet);
      // Only a full-sized raise reopens the betting; a short all-in does not.
      if (increase >= next.minRaise) {
        next.minRaise = increase;
        next.actedSinceRaise = next.seats.map(() => false);
      }
      next.currentBet = Math.max(next.currentBet, seat.bet);
      next.log.unshift(seat.allIn ? `${who} is all in for ${seat.bet}` : `${who} raises to ${seat.bet}`);
      break;
    }
  }

  next.actedSinceRaise[index] = true;

  if (next.seats.filter((s) => !s.folded).length === 1) return settle(next);
  if (bettingClosed(next)) return advance(next);

  next.toAct = nextActive(next, index);
  return next;
}

/** Total chips in the middle, including the current street's bets. */
export function potTotal(state: HandState): number {
  return state.seats.reduce((total, seat) => total + seat.committed, 0);
}

/** Where the button moves for the next hand: the next seat with chips. */
export function nextButton(seats: Seat[], button: number): number {
  const n = seats.length;
  for (let step = 1; step <= n; step++) {
    const index = (button + step) % n;
    if (seats[index].chips > 0) return index;
  }
  return button;
}

export { nextInHand };
