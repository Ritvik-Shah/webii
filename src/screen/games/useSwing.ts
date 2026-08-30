import { useEffect, useRef } from "react";
import type { ControllerMessage } from "../../../shared/protocol";

const GRAVITY = 9.81;

export interface SwingOptions {
  /** Linear-acceleration magnitude (m/s^2, gravity removed) that counts as a swing. */
  threshold: number;
  /** Minimum time between two detected swings, in ms -- prevents one big
   * motion from firing multiple swings while the phone is still moving. */
  cooldownMs: number;
}

/**
 * Watches the raw `motion` messages already flowing through the room's
 * controller-message bus and calls `onSwing` on each detected swing, with
 * its peak acceleration magnitude (useful for "how hard did they swing").
 *
 * Detection is a simple threshold-crossing with hysteresis: a swing fires
 * once linear acceleration exceeds `threshold`, then the detector re-arms
 * only once it settles back below 40% of that threshold -- so one swing
 * can't double-fire while the arm is still decelerating.
 *
 * These thresholds are a first pass, not tuned against a real phone yet --
 * expect to adjust `threshold`/`cooldownMs` per game after live playtesting.
 */
export function useSwing(
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void,
  onSwing: (peakMagnitude: number) => void,
  options: SwingOptions,
) {
  const armedRef = useRef(true);
  const lastSwingAtRef = useRef(0);
  const onSwingRef = useRef(onSwing);
  onSwingRef.current = onSwing;

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== "motion") return;
      const { ax, ay, az } = msg.sample;
      if (ax === null || ay === null || az === null) return;

      const magnitude = Math.sqrt(ax * ax + ay * ay + az * az) - GRAVITY;
      const now = Date.now();

      if (
        magnitude > options.threshold &&
        armedRef.current &&
        now - lastSwingAtRef.current > options.cooldownMs
      ) {
        armedRef.current = false;
        lastSwingAtRef.current = now;
        onSwingRef.current(magnitude);
      } else if (magnitude < options.threshold * 0.4) {
        armedRef.current = true;
      }
    });
  }, [subscribe, options.threshold, options.cooldownMs]);
}
