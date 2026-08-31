// ---------------------------------------------------------------------------
// Snapshot interpolation for spectator screens.
//
// A mirror receives the host's state a few dozen times a second, but draws at
// the display's refresh rate. Drawing the newest snapshot on every frame makes
// motion advance in visible steps -- which reads as lag far more than the
// network actually is. Instead the mirror keeps a short buffer, deliberately
// draws a fraction of a second behind, and interpolates between the two
// snapshots that straddle that moment. This is the standard trade: a small,
// constant delay bought in exchange for motion that is completely smooth.
// ---------------------------------------------------------------------------

/**
 * Blend two snapshots. Numbers are interpolated; everything else (strings,
 * booleans, mismatched shapes) takes the newer value, since those are
 * discrete and have no meaningful halfway point.
 *
 * `snapDistance` guards teleports: a bowling ball leaving the hand, a tank
 * respawning across the arena. Sliding through those over 30 ms looks far
 * worse than simply cutting, so anything moving further than this in a
 * single step jumps instead.
 */
export function lerpDeep<T>(a: T, b: T, t: number, snapDistance = Infinity): T {
  if (typeof b === "number") {
    if (typeof a !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return b;
    if (Math.abs(b - a) > snapDistance) return b;
    return (a + (b - a) * t) as unknown as T;
  }

  if (Array.isArray(b)) {
    // A different length means things were added or removed -- there is no
    // sensible element-wise pairing, so show the newer arrangement.
    if (!Array.isArray(a) || a.length !== b.length) return b;
    return b.map((item, i) => lerpDeep((a as unknown[])[i], item, t, snapDistance)) as unknown as T;
  }

  if (b !== null && typeof b === "object") {
    if (a === null || typeof a !== "object" || Array.isArray(a)) return b;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(b as Record<string, unknown>)) {
      out[key] = lerpDeep((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], t, snapDistance);
    }
    return out as unknown as T;
  }

  return b;
}


export interface BufferedSnapshot<T> {
  at: number;
  value: T;
}

/**
 * Pick the frame to draw at `now`, interpolating between the two snapshots
 * either side of `now - delayMs`.
 *
 * Returns `dry: true` when there was nothing new enough to blend towards, so
 * the caller is showing the newest snapshot repeatedly -- which is what
 * frozen, stuttering motion looks like on a mirror.
 */
export function sampleBuffer<T>(
  buffer: BufferedSnapshot<T>[],
  now: number,
  delayMs: number,
  snapDistance?: number,
): { value: T | null; dry: boolean } {
  if (buffer.length === 0) return { value: null, dry: true };
  const target = now - delayMs;
  if (buffer.length === 1 || target <= buffer[0].at) return { value: buffer[0].value, dry: true };

  for (let i = 0; i < buffer.length - 1; i++) {
    const from = buffer[i];
    const to = buffer[i + 1];
    if (target >= from.at && target <= to.at) {
      const span = to.at - from.at;
      const t = span > 0 ? (target - from.at) / span : 1;
      return { value: lerpDeep(from.value, to.value, t, snapDistance), dry: false };
    }
  }
  return { value: buffer[buffer.length - 1].value, dry: true };
}

/**
 * How far behind live to draw, given how far apart snapshots have actually
 * been arriving. It has to exceed the real gap or the buffer runs dry and
 * the picture holds still until the next one lands.
 *
 * Sized off a high percentile rather than the average, because that is what
 * actually causes visible stutter: a steady 33 ms stream is fine, but one
 * late snapshot in twenty empties the buffer and freezes the frame.
 */
export function adaptiveDelay(recentGapsMs: number[], floorMs: number): number {
  if (recentGapsMs.length < 4) return floorMs;
  const sorted = [...recentGapsMs].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.max(floorMs, Math.min(220, p90 * 1.5));
}
