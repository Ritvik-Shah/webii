import { useEffect, useRef } from "react";
import "./tanks.css";
import type { TanksVersusSnapshot } from "./TanksVersus";
import { TanksVersusHud } from "./TanksVersusHud";
import { drawVersusWorld } from "./tanksCore";
import { useGameCanvas } from "./useGameCanvas";

/** Read-only mirror of a deathmatch: redraws the host's world, simulates
 * nothing. */
export function TanksVersusSpectator({ snapshot }: { snapshot: TanksVersusSnapshot }) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    drawVersusWorld(ctx, width, height, snapshotRef.current.world);
  });

  // Nothing to clean up beyond the canvas loop, which useGameCanvas owns.
  useEffect(() => undefined, []);

  return (
    <div className="tanks-root">
      <div className="tanks-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <TanksVersusHud players={snapshot.players} hud={snapshot.hud} spectating />
    </div>
  );
}
