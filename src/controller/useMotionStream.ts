import { useEffect, useRef } from "react";
import type { ControllerMessage } from "../../shared/protocol";

interface OrientationSnapshot {
  beta: number;
  gamma: number;
}

interface PendingPointer {
  dx: number;
  dy: number;
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

/** Streams device orientation/motion to the screen as batched `pointer` and
 * `motion` messages at ~30Hz. No-ops when `send` is undefined (e.g. motion
 * permission not yet granted, or the room socket is disconnected). */
export function useMotionStream(send: ((msg: ControllerMessage) => void) | undefined): void {
  const lastOrientationRef = useRef<OrientationSnapshot | null>(null);
  const pendingPointerRef = useRef<PendingPointer>({ dx: 0, dy: 0 });
  const latestSampleRef = useRef<RawSample | null>(null);

  useEffect(() => {
    if (!send) return;

    function handleOrientation(e: DeviceOrientationEvent) {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      const last = lastOrientationRef.current;
      if (last) {
        pendingPointerRef.current.dx += (gamma - last.gamma) / 90;
        pendingPointerRef.current.dy += (beta - last.beta) / 90;
      }
      lastOrientationRef.current = { beta, gamma };

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
      const pending = pendingPointerRef.current;
      if (pending.dx !== 0 || pending.dy !== 0) {
        send({ type: "pointer", dx: pending.dx, dy: pending.dy });
        pendingPointerRef.current = { dx: 0, dy: 0 };
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
}
