import { useCallback, useEffect, useRef } from "react";
import type { ControllerMessage } from "../../shared/protocol";

interface OrientationSnapshot {
  beta: number;
  gamma: number;
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

/** A ~90-degree tilt from center reads as an offset magnitude of 1.0. */
const DEGREES_PER_UNIT = 90;

interface MotionStreamHandle {
  /** Re-calibrates "center" to wherever the phone is currently pointed. */
  recenter: () => void;
}

/** Streams device orientation/motion to the screen as `pointer` (absolute
 * offset from a calibrated aim center -- point-and-go, not drag-to-move) and
 * `motion` (raw samples, for swing-gesture games) messages at ~30Hz. No-ops
 * when `send` is undefined (e.g. motion permission not yet granted, or the
 * room socket is disconnected). */
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
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      latestOrientationRef.current = { beta, gamma };
      // Auto-calibrate to wherever the phone happens to be pointed the first
      // time we hear from it, so there's a usable pointer before the player
      // ever taps Recenter.
      if (!centerRef.current) centerRef.current = { beta, gamma };

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
        const ox = (current.gamma - center.gamma) / DEGREES_PER_UNIT;
        // Beta is inverted: tilting the top of the phone toward you should
        // move the cursor UP (like tipping a remote back to aim higher),
        // but a rising beta reading means the cursor's y percentage would
        // otherwise increase (move down) -- so flip it here.
        const oy = -((current.beta - center.beta) / DEGREES_PER_UNIT);
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
