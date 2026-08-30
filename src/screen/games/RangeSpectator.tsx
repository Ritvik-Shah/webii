import "./target-practice.css";
import { useRef } from "react";
import { drawRange, type RangeSnapshot } from "./TargetPractice";
import { useGameCanvas } from "./useGameCanvas";

/** Read-only mirror of one player's run through the range. */
export function RangeSpectator({ snapshot }: { snapshot: RangeSnapshot }) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    const s = snapshotRef.current;
    // Drawn with the host's clock, so fade-ins and pop animations line up.
    drawRange(ctx, s.world, width, height, s.stage, s.reticle, s.now);
  });

  return (
    <div className="target-practice-root">
      <div className="target-practice-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
