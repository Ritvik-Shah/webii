import { useCallback, useEffect, useRef } from "react";
import type { ControllerMessage } from "../../shared/protocol";

interface OrientationSnapshot {
  /** Compass-ish yaw (rotation around the phone's vertical axis), 0-360, wraps. */
  alpha: number;
  /** Pitch (tilting the top of the phone up/down). */
  beta: number;
}

interface RawSample {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  ax: number | null;
  ay: number | null;
  az: number | null;
}

const SEND_INTERVAL_MS = 33;

/** A ~90-degree rotation from center reads as an offset magnitude of 1.0. */
const DEGREES_PER_UNIT = 90;

// Flip either of these to -1 if left/right or up/down ever feels backwards
// after live testing -- cheap to tune without touching the math below.
const X_SIGN = 1;
const Y_SIGN = 1;

interface MotionStreamHandle {
  /** Re-calibrates "center" to wherever the phone is currently pointed. */
  recenter: () => void;
}

/** Shortest signed distance from `center` to `current`, wrapping around 360. */
function angleDelta(current: number, center: number): number {
  return (((current - center + 540) % 360) + 360) % 360 - 180;
}

/** Streams device orientation/motion to the screen as `pointer` (absolute
 * offset from a calibrated aim center) and `motion` (raw samples, for
 * swing-gesture games) messages at ~30Hz.
 *
 * Pointing works like an actual Wii remote: held upright and aimed at the
 * screen, swinging your wrist left-right is a YAW motion (alpha), not a roll
 * (gamma) -- gamma barely moves in that grip, which is why an earlier
 * gamma-based version felt like "tilt controls" instead of true pointing.
 * Tilting the top of the phone up/down to aim higher/lower is pitch (beta),
 * which was already correct. Both axes are absolute offsets from a
 * calibrated center (captured on the first reading, and whenever the player
 * taps Recenter), not accumulated deltas -- so there's no drift, and where
 * you point is where the cursor goes.
 *
 * No-ops when `send` is undefined (e.g. motion permission not yet granted,
 * or the room socket is disconnected). */
export function useMotionStream(send: ((msg: ControllerMessage) => void) | undefined): MotionStreamHandle {
  const centerRef = useRef<OrientationSnapshot | null>(null);
  const latestOrientationRef = useRef<OrientationSnapshot | null>(null);
  const latestSampleRef = useRef<RawSample | null>(null);

  const recenter = useCallback(() => {
    if (latestOrientationRef.current) {
      centerRef.current = { ...latestOrientationRef.current };
    }
  }, []);

  useEffect(() => {
    // A fresh mount (new permission grant / reconnect) should re-aim from
    // scratch rather than keep whatever center was calibrated last time.
    centerRef.current = null;

    if (!send) return;

    function handleOrientation(e: DeviceOrientationEvent) {
      const alpha = e.alpha ?? 0;
      const beta = e.beta ?? 0;
      latestOrientationRef.current = { alpha, beta };
      // Auto-calibrate to wherever the phone happens to be pointed the first
      // time we hear from it, so there's a usable pointer before the player
      // ever taps Recenter.
      if (!centerRef.current) centerRef.current = { alpha, beta };

      const prevSample = latestSampleRef.current;
      latestSampleRef.current = {
        alpha: e.alpha,
        beta: e.beta,
        gamma: e.gamma,
        ax: prevSample?.ax ?? null,
        ay: prevSample?.ay ?? null,
        az: prevSample?.az ?? null,
      };
    }

    function handleMotion(e: DeviceMotionEvent) {
      const accel = e.accelerationIncludingGravity;
      const prevSample = latestSampleRef.current;
      latestSampleRef.current = {
        alpha: prevSample?.alpha ?? null,
        beta: prevSample?.beta ?? null,
        gamma: prevSample?.gamma ?? null,
        ax: accel?.x ?? null,
        ay: accel?.y ?? null,
        az: accel?.z ?? null,
      };
    }

    window.addEventListener("deviceorientation", handleOrientation);
    window.addEventListener("devicemotion", handleMotion);

    const interval = setInterval(() => {
      const current = latestOrientationRef.current;
      const center = centerRef.current;
      if (current && center) {
        const ox = X_SIGN * (angleDelta(current.alpha, center.alpha) / DEGREES_PER_UNIT);
        const oy = Y_SIGN * -(angleDelta(current.beta, center.beta) / DEGREES_PER_UNIT);
        send({ type: "pointer", ox, oy });
      }

      const sample = latestSampleRef.current;
      if (sample) {
        send({ type: "motion", sample: { t: Date.now(), ...sample } });
      }
    }, SEND_INTERVAL_MS);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("devicemotion", handleMotion);
      clearInterval(interval);
    };
  }, [send]);

  return { recenter };
}
