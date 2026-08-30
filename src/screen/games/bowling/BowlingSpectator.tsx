import { useEffect, useRef } from "react";
import "./bowling.css";
import type { BowlingSnapshot } from "./Bowling";
import { BowlingHud } from "./BowlingHud";
import { createBowlingScene, type BowlingScene } from "./scene";
import { MIRROR_DELAY_MS } from "../../../../shared/protocol";
import { useSnapshotBuffer } from "../interpolate";

interface BowlingSpectatorProps {
  /** Latest snapshot from the host. Replaced ~30 times a second. */
  snapshot: BowlingSnapshot;
}

/**
 * Read-only mirror of a Bowling game. It builds the same 3D alley and then
 * simply draws whatever the host last described -- no simulation runs here,
 * so a mirror can never drift out of step with the real game.
 */
export function BowlingSpectator({ snapshot }: BowlingSpectatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Positions are in metres here, so anything moving more than half a metre
  // between snapshots is a cut (the ball leaving the hand), not motion.
  const sample = useSnapshotBuffer(snapshot, { delayMs: MIRROR_DELAY_MS, snapDistance: 0.5 });
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  // Rebuild only when the line-up changes, since the Miis are baked into the
  // scene's bowlers; within a game that never happens.
  const playersRef = useRef(snapshot.players);
  playersRef.current = snapshot.players;
  const miiKey = snapshot.players.map((p) => `${p.player}:${p.mii.id}`).join("|");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scene: BowlingScene;
    try {
      scene = createBowlingScene(container, playersRef.current.map((p) => p.mii));
    } catch {
      return; // No WebGL here; the HUD alone still tells you what's happening.
    }

    let rafId = 0;
    let last = performance.now();
    let disposed = false;
    scene.cutCamera();

    function frame(now: number) {
      if (disposed) return;
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const current = sampleRef.current(now);
      if (current) scene.render(dt, current.sim, current.view);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      scene.dispose();
    };
  }, [miiKey]);

  return (
    <div className="bowling-root">
      <div className="bowling-viewport" ref={containerRef} />
      <BowlingHud hud={snapshot.hud} players={snapshot.players} spectating />
    </div>
  );
}
