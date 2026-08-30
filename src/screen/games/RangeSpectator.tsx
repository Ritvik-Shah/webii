import "./target-practice.css";
import { useRef } from "react";
import { drawRange, type RangeSnapshot } from "./TargetPractice";
import { useGameCanvas } from "./useGameCanvas";
import { MIRROR_DELAY_MS } from "../../../shared/protocol";
import { useSnapshotBuffer } from "./interpolate";

/** Read-only mirror of one player's run through the range. */
export function RangeSpectator({ snapshot }: { snapshot: RangeSnapshot }) {
  // Arena/screen coordinates are in pixels here, so the snap guard is a
  // pixel distance -- a tank respawning across the map should cut, not slide.
  const sample = useSnapshotBuffer(snapshot, { delayMs: MIRROR_DELAY_MS, snapDistance: 400 });
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    const s = sampleRef.current(performance.now());
    // Drawn with the host's clock, so fade-ins and pop animations line up.
    if (s) drawRange(ctx, s.world, width, height, s.stage, s.reticle, s.now);
  });

  return (
    <div className="target-practice-root">
      <div className="target-practice-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
