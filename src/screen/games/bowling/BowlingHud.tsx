import { FRAME_COUNT, currentScore, frameTotals, rollGlyph } from "./score";
import type { PlayerInfo } from "../types";
import type { BowlingHudState } from "./Bowling";

/** Above this many players, the scorecard collapses to a standings strip. */
const CARDS_SHOWN = 4;

interface BowlingHudProps {
  hud: BowlingHudState;
  players: PlayerInfo[];
  /** A spectator mirror hides the control hints, which mean nothing there. */
  spectating?: boolean;
}

/**
 * Everything drawn over the alley: the scorecard, the frame/ball readout,
 * the turn call-out, banners and the game-over card. Shared so a spectator
 * screen shows exactly what the host does, from the same snapshot.
 */
export function BowlingHud({ hud, players, spectating = false }: BowlingHudProps) {
  const scores = hud.cards.map((card) => currentScore(card));
  const best = Math.max(...scores);
  const multiplayer = players.length > 1;
  const activePlayer = players[hud.turnIndex];
  // Ten full ten-frame cards will not fit on a screen. Past a few players
  // only whoever is bowling gets their card shown, and everyone else is a
  // running-total strip underneath it.
  const crowded = players.length > CARDS_SHOWN;
  const shownCards = crowded
    ? hud.cards.map((card, i) => ({ card, i })).filter(({ i }) => i === hud.turnIndex)
    : hud.cards.map((card, i) => ({ card, i }));

  return (
    <>

      <div className={`bowling-scorecard${multiplayer ? " is-multi" : ""}`}>
        {shownCards.map(({ card, i: playerIndex }) => {
          const totals = frameTotals(card);
          const isUp = playerIndex === hud.turnIndex && hud.phase !== "final";
          return (
            <div key={players[playerIndex].player} className={`bowling-card-row${isUp ? " is-up" : ""}`}>
              {multiplayer && (
                <div className="bowling-card-who">
                  <span className="bowling-card-player">P{players[playerIndex].player}</span>
                  <span className="bowling-card-name">{players[playerIndex].mii.name}</span>
                </div>
              )}
              {card.map((_frame, i) => {
                const isTenth = i === FRAME_COUNT - 1;
                const boxes = isTenth ? [0, 1, 2] : [0, 1];
                const active = isUp && i === hud.frameIndex;
                return (
                  <div key={i} className={`bowling-frame${active ? " is-active" : ""}${isTenth ? " is-tenth" : ""}`}>
                    {playerIndex === 0 && <div className="bowling-frame-number">{i + 1}</div>}
                    <div className="bowling-frame-rolls">
                      {boxes.map((rollIndex) => (
                        <span key={rollIndex} className="bowling-roll">
                          {rollGlyph(card, i, rollIndex)}
                        </span>
                      ))}
                    </div>
                    <div className="bowling-frame-total">{totals[i] ?? ""}</div>
                  </div>
                );
              })}
              <div className="bowling-grand-total">
                {!multiplayer && <span className="bowling-grand-label">Total</span>}
                <span className="bowling-grand-value">{scores[playerIndex]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {crowded && (
        <div className="bowling-standings">
          {players.map((info, i) => (
            <span
              key={info.player}
              className={`bowling-standing${i === hud.turnIndex ? " is-up" : ""}${scores[i] === best ? " is-best" : ""}`}
            >
              <span className="bowling-standing-who">P{info.player}</span>
              <span className="bowling-standing-score">{scores[i]}</span>
            </span>
          ))}
        </div>
      )}

      <div className="bowling-status">
        <span className="bowling-status-frame">Frame {hud.frameIndex + 1}</span>
        <span className="bowling-status-ball">
          {multiplayer && activePlayer ? `Player ${activePlayer.player} · Ball ${hud.ballNumber}` : `Ball ${hud.ballNumber}`}
        </span>
      </div>

      {multiplayer && hud.phase === "intro" && activePlayer && (
        <div className="bowling-turncall">
          <span className="bowling-turncall-player">Player {activePlayer.player}</span>
          <span className="bowling-turncall-name">{activePlayer.mii.name}, you're up</span>
        </div>
      )}

      {hud.phase === "aim" && (
        <div className="bowling-aimpanel">
          <div className="bowling-aimpanel-title">Left / Right</div>
          <div className="bowling-modes">
            <span className={`bowling-mode${hud.aimMode === "move" ? " is-on" : ""}`}>Move</span>
            <span className={`bowling-mode${hud.aimMode === "rotate" ? " is-on" : ""}`}>Rotate</span>
          </div>
          <div className="bowling-aimpanel-note">A to switch</div>
        </div>
      )}

      {hud.phase === "aim" && hud.cameraView === "lineup" && (
        <div className="bowling-zoomtag">Checking your line · ↓ to go back</div>
      )}

      {hud.phase === "wind" && <div className="bowling-winding">Swing and let go of B!</div>}

      {hud.banner && (
        <div className={`bowling-banner bowling-banner-${hud.bannerKind}`} key={`${hud.frameIndex}-${hud.banner}`}>
          {hud.banner}
        </div>
      )}

      {hud.phase === "final" && (
        <div className="bowling-final">
          <div className="bowling-final-card">
            <h2 className="bowling-final-title">Game Over</h2>
            {multiplayer ? (
              <ol className="bowling-results">
                {players
                  .map((info, i) => ({ info, score: scores[i] }))
                  .sort((a, b) => b.score - a.score)
                  .map(({ info, score }, rank) => (
                    <li key={info.player} className={`bowling-result${score === best ? " is-winner" : ""}`}>
                      <span className="bowling-result-rank">{rank + 1}</span>
                      <span className="bowling-result-who">
                        P{info.player} · {info.mii.name}
                      </span>
                      <span className="bowling-result-score">{score}</span>
                    </li>
                  ))}
              </ol>
            ) : (
              <>
                <div className="bowling-final-score">{scores[0]}</div>
                <p className="bowling-final-note">
                  {scores[0] === 300
                    ? "A perfect game!"
                    : scores[0] >= 200
                      ? "Fantastic bowling!"
                      : scores[0] >= 130
                        ? "Nice game!"
                        : "Good game!"}
                </p>
              </>
            )}
            <p className="bowling-final-hint">Press A to return to the Wii Menu</p>
          </div>
        </div>
      )}

      {!spectating && <div className="bowling-hint">
        {hud.phase === "intro"
          ? "A to skip"
          : hud.phase === "aim"
            ? `←/→ ${hud.aimMode === "move" ? "move" : "rotate"} · A to switch · ↑ check your line · ↓ back · 1 to reset · Hold B, swing, release to bowl`
            : hud.phase === "wind"
              ? "Swing the remote forward and release B"
              : "HOME to exit"}
      </div>}
    </>
  );
}
