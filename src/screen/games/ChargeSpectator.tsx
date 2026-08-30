import { useRef } from "react";
import "./charge.css";
import { MiiAvatar } from "../mii/MiiAvatar";
import type { Mii } from "../mii/Mii";
import { drawChargeWorld, type ChargeSnapshot } from "./Charge";
import { useGameCanvas } from "./useGameCanvas";

/** Read-only mirror of one player's Charge! run. */
export function ChargeSpectator({ snapshot, mii }: { snapshot: ChargeSnapshot; mii: Mii }) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const riderRef = useRef<HTMLDivElement | null>(null);

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    const cow = drawChargeWorld(ctx, width, height, snapshotRef.current.engine);
    // The rider is a DOM element sat on top of the canvas, so it has to be
    // moved to wherever the cow ended up -- same as on the host.
    const rider = riderRef.current;
    if (rider) {
      rider.style.left = `${cow.x}px`;
      rider.style.top = `${cow.y}px`;
    }
  });

  const seconds = Math.max(0, Math.ceil(snapshot.timeLeft));
  const minutes = Math.floor(seconds / 60);

  return (
    <div className="charge-root">
      <div className="charge-hud">
        <div className="charge-hud-item">
          <span className="charge-hud-label">Time</span>
          <span className="charge-hud-value">
            {minutes}:{String(seconds % 60).padStart(2, "0")}
          </span>
        </div>
        <div className="charge-hud-item">
          <span className="charge-hud-label">Score</span>
          <span className="charge-hud-value">{snapshot.score}</span>
        </div>
        <div className="charge-hud-item">
          <span className="charge-hud-label">Streak</span>
          <span className="charge-hud-value">{snapshot.streak}</span>
        </div>
      </div>

      <div className="charge-canvas-wrap">
        <canvas ref={canvasRef} />
        <div ref={riderRef} className="charge-rider" aria-hidden="true">
          <MiiAvatar mii={mii} size={54} pose="idle" />
        </div>
      </div>
    </div>
  );
}
