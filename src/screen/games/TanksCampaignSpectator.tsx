import { useRef } from "react";
import "./tanks.css";
import type { CampaignSnapshot } from "./Tanks";
import { drawCampaignWorld } from "./tanksCore";
import { useGameCanvas } from "./useGameCanvas";
import { MIRROR_DELAY_MS } from "../../../shared/protocol";
import { useSnapshotBuffer } from "./interpolate";

/** Read-only mirror of the single-player Tanks campaign. */
export function TanksCampaignSpectator({ snapshot }: { snapshot: CampaignSnapshot }) {
  // Arena/screen coordinates are in pixels here, so the snap guard is a
  // pixel distance -- a tank respawning across the map should cut, not slide.
  const sample = useSnapshotBuffer(snapshot, { delayMs: MIRROR_DELAY_MS, snapDistance: 150 });
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    const current = sampleRef.current(performance.now());
    if (current) drawCampaignWorld(ctx, width, height, current.world);
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
