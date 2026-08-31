import { useCallback, useEffect, useRef } from "react";
import { adaptiveDelay, lerpDeep } from "./snapshotLerp";

// Buffering half of snapshot interpolation. The blending itself lives in
// snapshotLerp.ts, which has no React in it so it can be tested directly.

interface BufferOptions {
  /** How far behind live to draw, in ms. Must exceed the gap between
   * snapshots or the buffer runs dry and motion stutters again. */
  delayMs?: number;
  /** See `lerpDeep`. In whatever units the snapshot's positions use. */
  snapDistance?: number;
}

/**
 * Buffers incoming snapshots and returns a sampler for the render loop to
 * call each frame. The sampler is stable, so it can be read from inside a
 * canvas loop without re-subscribing.
 */
export function useSnapshotBuffer<T>(snapshot: T | null, { delayMs = 70, snapDistance }: BufferOptions = {}) {
  const bufferRef = useRef<Array<{ at: number; value: T }>>([]);
  // How far apart snapshots have really been arriving. The configured delay
  // is only a floor: network jitter, not the publish rate, is what empties
  // the buffer and makes a mirror look like it keeps pausing.
  const gapsRef = useRef<number[]>([]);
  const effectiveDelayRef = useRef(delayMs);

  useEffect(() => {
    if (snapshot === null || snapshot === undefined) return;
    const buffer = bufferRef.current;
    const arrivedAt = performance.now();
    if (buffer.length > 0) {
      gapsRef.current.push(arrivedAt - buffer[buffer.length - 1].at);
      if (gapsRef.current.length > 30) gapsRef.current.shift();
      effectiveDelayRef.current = adaptiveDelay(gapsRef.current, delayMs);
    }
    buffer.push({ at: arrivedAt, value: snapshot });
    // Two entries either side of the draw point is all that's ever needed;
    // anything older is dead weight.
    while (buffer.length > 2 && buffer[1].at < performance.now() - effectiveDelayRef.current) buffer.shift();
    if (buffer.length > 8) buffer.splice(0, buffer.length - 8);
  }, [snapshot, delayMs]);

  return useCallback(
    (now: number): T | null => {
      const buffer = bufferRef.current;
      if (buffer.length === 0) return snapshot ?? null;
      const target = now - effectiveDelayRef.current;

      // Before the buffer starts, or only one snapshot so far: nothing to
      // blend towards yet.
      if (buffer.length === 1 || target <= buffer[0].at) return buffer[0].value;

      for (let i = 0; i < buffer.length - 1; i++) {
        const from = buffer[i];
        const to = buffer[i + 1];
        if (target >= from.at && target <= to.at) {
          const span = to.at - from.at;
          const t = span > 0 ? (target - from.at) / span : 1;
          return lerpDeep(from.value, to.value, t, snapDistance);
        }
      }

      // The buffer ran dry -- the host stalled or the connection hiccuped.
      // Showing the newest state is better than freezing.
      return buffer[buffer.length - 1].value;
    },
    [snapshot, delayMs, snapDistance],
  );
}
