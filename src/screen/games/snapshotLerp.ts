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

