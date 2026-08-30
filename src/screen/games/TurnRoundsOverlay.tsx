import { MiiAvatar } from "../mii/MiiAvatar";
import type { TurnRoundsSnapshot } from "./TurnRounds";
import "./turn-rounds.css";

/**
 * The hand-off and results cards for the take-turns games. Rendered from the
 * same snapshot shape on the host and on a spectator screen, so a mirror
 * can't drift from what the room is actually looking at.
 */
export function TurnRoundsOverlay({ snapshot, spectating = false }: { snapshot: TurnRoundsSnapshot; spectating?: boolean }) {
  const { title, scoreSuffix, stage, players, scores, activeIndex } = snapshot;
  const multiplayer = players.length > 1;

  if (stage === "results") {
    const ranked = players
      .map((info, i) => ({ info, score: scores[i] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.score ?? 0;

    return (
      <div className="turn-rounds-overlay">
        <div className="turn-rounds-card">
          <h2 className="turn-rounds-title">{multiplayer ? `${title} — Results` : title}</h2>
          <ol className="turn-rounds-results">
            {ranked.map(({ info, score }, rank) => (
              <li key={info.player} className={`turn-rounds-result${score === best ? " is-winner" : ""}`}>
                <span className="turn-rounds-rank">{rank + 1}</span>
                <MiiAvatar mii={info.mii} size={38} />
                <span className="turn-rounds-who">
                  {multiplayer ? `P${info.player} · ` : ""}
                  {info.mii.name}
                </span>
                <span className="turn-rounds-score">
                  {score}
                  {scoreSuffix ? ` ${scoreSuffix}` : ""}
                </span>
              </li>
            ))}
          </ol>
          {!spectating && <p className="turn-rounds-hint">Press A to return to the Wii Menu</p>}
        </div>
      </div>
    );
  }

  const active = players[Math.min(activeIndex, players.length - 1)];
  return (
    <div className="turn-rounds-overlay">
      <div className="turn-rounds-card">
        <span className="turn-rounds-eyebrow">{title}</span>
        <h2 className="turn-rounds-title">Player {active.player}</h2>
        <MiiAvatar mii={active.mii} size={110} />
        <p className="turn-rounds-name">{active.mii.name}, you're up</p>
        {scores.length > 0 && (
          <p className="turn-rounds-standing">
            {players
              .slice(0, scores.length)
              .map((info, i) => `P${info.player} ${scores[i]}`)
              .join("  ·  ")}
          </p>
        )}
        <p className="turn-rounds-hint">
          {spectating ? `Waiting for Player ${active.player}` : "Press A when you're ready"}
        </p>
      </div>
    </div>
  );
}
