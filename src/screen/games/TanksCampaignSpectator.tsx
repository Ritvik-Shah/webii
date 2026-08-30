import { useRef } from "react";
import "./tanks.css";
import type { CampaignSnapshot } from "./Tanks";
import { drawCampaignWorld } from "./tanksCore";
import { useGameCanvas } from "./useGameCanvas";

/** Read-only mirror of the single-player Tanks campaign. */
export function TanksCampaignSpectator({ snapshot }: { snapshot: CampaignSnapshot }) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    drawCampaignWorld(ctx, width, height, snapshotRef.current.world);
  });

  return (
    <div className="tanks-root">
      <div className="tanks-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <div className="tanks-hud-lives">
        <span className="tanks-hud-label">Lives</span>
        <span className="tanks-hud-value">x{snapshot.lives}</span>
      </div>
      <div className="tanks-hud-level">
        <span className="tanks-hud-label">Level</span>
        <span className="tanks-hud-value">{snapshot.level + 1} / 5</span>
      </div>
    </div>
  );
}
