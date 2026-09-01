import { useRef } from "react";
import { MIRROR_DELAY_MS } from "../../../../shared/protocol";
import { MiiAvatar } from "../../mii/MiiAvatar";
import { useSnapshotBuffer } from "../interpolate";
import { useGameCanvas } from "../useGameCanvas";
import { drawLake, type FishingSnapshot } from "./Fishing";
import { SPECIES_BY_ID, standings } from "./lake";
import "./fishing.css";

/**
 * The watch screen's lake. It draws with the host's own `drawLake`, so there
 * is one picture of the water rather than two that drift apart -- the only
 * difference is that this one is a few frames behind and interpolated.
 */
export function FishingSpectator({ snapshot }: { snapshot: FishingSnapshot }) {
  // Fish positions are in 0-100 lake units, so a fish wrapping from one edge
  // to the other is about 100 units -- anything past half that is a wrap and
  // should cut rather than slide back across the screen.
  const sample = useSnapshotBuffer(snapshot, { delayMs: MIRROR_DELAY_MS, snapDistance: 40 });
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  const latest = useRef(snapshot);

  const canvasRef = useGameCanvas((ctx, _dt, width, height) => {
    const s = sampleRef.current(performance.now());
    if (!s) return;
    latest.current = s;
    drawLake(ctx, s.lake, width, height, s.now);
  });

  const lake = latest.current.lake;

  return (
    <div className="fishing-root">
      <header className="fishing-header">
        <span className="fishing-title">Fishing</span>
        <span className="fishing-clock">
          {Math.floor(Math.ceil(lake.remaining) / 60)}:{String(Math.ceil(lake.remaining) % 60).padStart(2, "0")}
        </span>
        <span className="fishing-hint">Watching — the rods are in the players' hands</span>
      </header>

      <div className="fishing-canvas-wrap">
        <canvas ref={canvasRef} />
        {lake.anglers.map((angler) => {
          const mii = snapshot.miis?.[angler.player];
          if (!mii) return null;
          return (
            <div key={angler.player} className="fishing-angler" style={{ left: `${angler.x}%`, top: "17%" }}>
              <MiiAvatar mii={mii} size={54} />
              <span className="fishing-angler-tag">P{angler.player}</span>
            </div>
          );
        })}
      </div>

      <div className="fishing-cards">
        {lake.anglers.map((angler) => (
          <div key={angler.player} className={`fishing-card${angler.phase === "hooked" ? " is-fighting" : ""}`}>
            <span className="fishing-card-player">P{angler.player}</span>
            <span className="fishing-card-score">{angler.score.toFixed(1)}kg</span>
            <span className="fishing-card-note">{angler.noteFor > 0 ? angler.note : ""}</span>
          </div>
        ))}
      </div>

      {lake.over && (
        <div className="fishing-results">
          <h2>Time!</h2>
          <ol>
            {standings(lake).map((row, rank) => (
              <li key={row.player} className={rank === 0 ? "is-winner" : ""}>
                <span className="fishing-rank">{rank + 1}</span>
                <span className="fishing-who">Player {row.player}</span>
                <span className="fishing-bag">{row.score.toFixed(1)} kg</span>
                <span className="fishing-best">
                  {row.count} caught
                  {row.best ? ` · best ${SPECIES_BY_ID.get(row.best.species)?.name} ${row.best.weight.toFixed(1)}kg` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
