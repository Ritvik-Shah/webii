// Ten-pin scoring: frames 1-9 are one or two rolls with strike/spare bonuses
// pulled from the following rolls, and the 10th frame earns a third roll if
// its first two rolls clear the rack. Kept as pure functions over a
// `number[][]` (rolls per frame) so the game component can just append a
// roll and re-derive the whole card.

export const FRAME_COUNT = 10;

export type Frame = number[];

export function emptyCard(): Frame[] {
  return Array.from({ length: FRAME_COUNT }, () => [] as Frame);
}

/** True once the 10th frame's last legal roll has been bowled. */
export function isGameOver(card: Frame[]): boolean {
  return rollsRemainingInFrame(card, FRAME_COUNT - 1) === 0;
}

/** How many more rolls the given frame still allows (0 = move on). */
export function rollsRemainingInFrame(card: Frame[], frameIndex: number): number {
  const frame = card[frameIndex];
  if (frameIndex < FRAME_COUNT - 1) {
    if (frame.length === 0) return 2;
    if (frame.length === 1) return frame[0] === 10 ? 0 : 1;
    return 0;
  }
  // Tenth frame: a strike or spare in the first two rolls buys a third.
  if (frame.length < 2) return 2 - frame.length;
  const openedRack = frame[0] === 10 || frame[0] + frame[1] === 10;
  if (frame.length === 2) return openedRack ? 1 : 0;
  return 0;
}

/**
 * How many pins were standing when the given roll of a frame was bowled --
 * i.e. what that ball could possibly have knocked down. Frames 1-9 are
 * simple; the 10th re-racks after any ball that clears the deck, so a
 * "10" there can be a second or third strike rather than a spare.
 */
export function pinsStandingBeforeRoll(card: Frame[], frameIndex: number, rollIndex: number): number {
  const frame = card[frameIndex];
  if (rollIndex === 0) return 10;

  if (frameIndex < FRAME_COUNT - 1) return 10 - frame[0];

  if (rollIndex === 1) return frame[0] === 10 ? 10 : 10 - frame[0];
  // Third ball: a fresh rack unless the second ball left pins standing.
  if (frame[0] === 10) return frame[1] === 10 ? 10 : 10 - frame[1];
  return 10; // reached only after a spare, which always re-racks
}

/** What the *next* ball in the given frame can knock down. */
export function pinsAvailable(card: Frame[], frameIndex: number): number {
  return pinsStandingBeforeRoll(card, frameIndex, card[frameIndex].length);
}

/**
 * Running total after each frame, or `null` for a frame whose bonus rolls
 * haven't been bowled yet (exactly how a real scorecard leaves the box
 * blank until the bonus lands).
 */
export function frameTotals(card: Frame[]): (number | null)[] {
  const flat: number[] = [];
  const frameStart: number[] = [];
  for (const frame of card) {
    frameStart.push(flat.length);
    flat.push(...frame);
  }

  const totals: (number | null)[] = [];
  let running = 0;

  for (let i = 0; i < FRAME_COUNT; i++) {
    const frame = card[i];
    const start = frameStart[i];
    if (frame.length === 0) {
      totals.push(null);
      continue;
    }

    if (i === FRAME_COUNT - 1) {
      if (rollsRemainingInFrame(card, i) > 0) {
        totals.push(null);
      } else {
        running += frame.reduce((a, b) => a + b, 0);
        totals.push(running);
      }
      continue;
    }

    if (frame[0] === 10) {
      if (flat.length >= start + 3) {
        running += 10 + flat[start + 1] + flat[start + 2];
        totals.push(running);
      } else {
        totals.push(null);
      }
    } else if (frame.length >= 2) {
      if (frame[0] + frame[1] === 10) {
        if (flat.length >= start + 3) {
          running += 10 + flat[start + 2];
          totals.push(running);
        } else {
          totals.push(null);
        }
      } else {
        running += frame[0] + frame[1];
        totals.push(running);
      }
    } else {
      totals.push(null);
    }
  }

  return totals;
}

/** Final score, treating unresolved bonuses as not-yet-earned. */
export function currentScore(card: Frame[]): number {
  const totals = frameTotals(card);
  for (let i = totals.length - 1; i >= 0; i--) {
    if (totals[i] !== null) return totals[i]!;
  }
  return 0;
}

/**
 * Whether the given roll faced a full, freshly set rack -- which is what
 * makes clearing it a strike rather than a spare. Only the 10th frame can
 * present a fresh rack to anything but the first ball: it re-racks after
 * any ball that clears the deck.
 */
function isFreshRack(frame: Frame, frameIndex: number, rollIndex: number): boolean {
  if (rollIndex === 0) return true;
  if (frameIndex < FRAME_COUNT - 1) return false;
  if (rollIndex === 1) return frame[0] === 10;
  return frame[0] === 10 ? frame[1] === 10 : true;
}

/** The glyph a real scorecard prints in a roll box: X, /, -, or the count. */
export function rollGlyph(card: Frame[], frameIndex: number, rollIndex: number): string {
  const frame = card[frameIndex];
  if (rollIndex >= frame.length) return "";
  const pins = frame[rollIndex];
  if (pins === pinsStandingBeforeRoll(card, frameIndex, rollIndex)) {
    return isFreshRack(frame, frameIndex, rollIndex) ? "X" : "/";
  }
  return pins === 0 ? "-" : String(pins);
}

// ---------------------------------------------------------------------------
// Turn order
// ---------------------------------------------------------------------------

/** Who is bowling, and which frame everyone is on. */
export interface TurnCursor {
  /** Index into the player list, not the room's player number. */
  turnIndex: number;
  frameIndex: number;
}

/**
 * Where play moves once the current player's frame is complete: along to the
 * next player, or back to the first player and on to the next frame. Returns
 * `null` when the last player has finished the tenth frame and the game is
 * over.
 */
export function nextTurn(cursor: TurnCursor, playerCount: number): TurnCursor | null {
  const nextIndex = cursor.turnIndex + 1;
  if (nextIndex < playerCount) {
    return { turnIndex: nextIndex, frameIndex: cursor.frameIndex };
  }
  const nextFrame = cursor.frameIndex + 1;
  if (nextFrame >= FRAME_COUNT) return null;
  return { turnIndex: 0, frameIndex: nextFrame };
}
