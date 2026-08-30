import { useEffect, useRef } from "react";
import "./tanks.css";
import type { TanksVersusSnapshot } from "./TanksVersus";
import { TanksVersusHud } from "./TanksVersusHud";
import { drawVersusWorld } from "./tanksCore";
import { useGameCanvas } from "./useGameCanvas";
import { MIRROR_DELAY_MS } from "../../../shared/protocol";
import { useSnapshotBuffer } from "./interpolate";

/** Read-only mirror of a deathmatch: redraws the host's world, simulates
 * nothing. */
export function TanksVersusSpectator({ snapshot }: { snapshot: TanksVersusSnapshot }) {
  // Arena/screen coordinates are in pixels here, so the snap guard is a
  // pixel distance -- a tank respawning across the map should cut, not slide.
  const sample = useSnapshotBuffer(snapshot, { delayMs: MIRROR_DELAY_MS, snapDistance: 150 });
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    const current = sampleRef.current(performance.now());
    if (current) drawVersusWorld(ctx, width, height, current.world);
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
