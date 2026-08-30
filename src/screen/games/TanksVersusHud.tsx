import { MiiAvatar } from "../mii/MiiAvatar";
import type { PlayerInfo } from "./types";

/** What a spectator screen needs to draw a deathmatch, alongside the world. */
export interface VersusHudState {
  scores: number[];
  timeLeft: number;
  phase: "countdown" | "playing" | "over";
  countdown: number;
  matchSeconds: number;
}

interface TanksVersusHudProps {
  players: PlayerInfo[];
  hud: VersusHudState;
  /** A mirror hides the control hints, which mean nothing there. */
  spectating?: boolean;
}

export function TanksVersusHud({ players, hud, spectating = false }: TanksVersusHudProps) {
  const { scores, timeLeft, phase, countdown, matchSeconds } = hud;
  const ranked = players
    .map((info, i) => ({ info, score: scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  const drawn = ranked.filter((r) => r.score === best).length > 1;

  return (
    <>
      <div className="tanks-versus-hud">
        <div className="tanks-versus-clock">{timeLeft}s</div>
        <div className="tanks-versus-scores">
          {players.map((info, i) => (
            <div key={info.player} className="tanks-versus-score" style={{ borderColor: info.mii.shirtColor }}>
              <MiiAvatar mii={info.mii} size={26} />
              <span className="tanks-versus-player">P{info.player}</span>
              <span className="tanks-versus-points">{scores[i] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {phase === "countdown" && (
        <div className="tanks-overlay">
          <div className="tanks-panel">
            <h2 className="tanks-panel-title">{countdown > 0 ? countdown : "Go!"}</h2>
            <p className="tanks-panel-text">Everyone plays at once — most kills in {matchSeconds}s wins</p>
          </div>
        </div>
      )}

      {phase === "over" && (
        <div className="tanks-overlay">
          <div className="tanks-panel">
            <h2 className="tanks-panel-title">{drawn ? "It's a draw!" : `Player ${ranked[0].info.player} wins!`}</h2>
            <ol className="tanks-versus-results">
              {ranked.map(({ info, score }, rank) => (
                <li key={info.player} className={`tanks-versus-result${score === best ? " is-winner" : ""}`}>
                  <span className="tanks-versus-rank">{rank + 1}</span>
                  <MiiAvatar mii={info.mii} size={34} />
                  <span className="tanks-versus-who">
                    P{info.player} · {info.mii.name}
                  </span>
                  <span className="tanks-versus-points">{score}</span>
                </li>
              ))}
            </ol>
            {!spectating && <p className="tanks-panel-text">Press A to return to the Wii Menu</p>}
          </div>
        </div>
      )}

      {!spectating && (
        <div className="tanks-hint">D-pad to drive · point to aim · B to fire · 2 to drop a mine · HOME to exit</div>
      )}
    </>
  );
}
