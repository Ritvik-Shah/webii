import "./party/party.css";
import "./uno/uno.css";
import "./poker/poker.css";
import { MiiAvatar } from "../mii/MiiAvatar";
import type { Mii } from "../mii/Mii";
import { COLOR_HEX, cardLabel as unoLabel, type UnoCard, type UnoColor } from "./uno/rules";
import { SUIT_IS_RED, SUIT_SYMBOL, rankName, type Card } from "./poker/hands";

// Read-only mirrors for the games whose screens are plain state rather than a
// canvas: the card games and the party games. Each renders exactly what the
// host published, and nothing that would leak a private hand.

interface Seat {
  player: number;
  mii: Mii;
}

// ---------------------------------------------------------------------------
// Uno
// ---------------------------------------------------------------------------

export interface UnoMirrorState {
  players: Seat[];
  counts: number[];
  top: UnoCard;
  activeColor: UnoColor;
  direction: 1 | -1;
  turnIndex: number;
  winner: number | null;
  log: string[];
  drawCount: number;
}

export function UnoMirror({ state }: { state: UnoMirrorState }) {
  return (
    <div className="uno-root">
      <div className="uno-table">
        <div className="uno-pile">
          <div
            className="uno-card is-top"
            style={{ background: state.top.color ? COLOR_HEX[state.top.color] : "#2b2b33" }}
          >
            {unoLabel(state.top)}
          </div>
          <div className="uno-colour" style={{ background: COLOR_HEX[state.activeColor] }}>
            {state.activeColor}
          </div>
          <div className="uno-meta">
            {state.direction === 1 ? "clockwise" : "anticlockwise"} - {state.drawCount} left to draw
          </div>
        </div>
        <div className="uno-players">
          {state.players.map((info, index) => (
            <div
              key={info.player}
              className={`uno-player${index === state.turnIndex && state.winner === null ? " is-up" : ""}`}
            >
              <MiiAvatar mii={info.mii} size={42} />
              <span className="uno-player-name">
                P{info.player} - {info.mii.name}
              </span>
              <span className="uno-player-count">
                {state.counts[index] ?? 0}
                {state.counts[index] === 1 ? " UNO" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
      <ul className="uno-log">
        {state.log.slice(0, 5).map((line, i) => (
          <li key={`${line}-${i}`}>{line}</li>
        ))}
      </ul>
      <div className="uno-hint-bar">Watching - hands stay on the players phones</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poker
// ---------------------------------------------------------------------------

export interface PokerMirrorState {
  players: Seat[];
  community: Card[];
  pot: number;
  button: number;
  toAct: number;
  street: string;
  log: string[];
  seats: { player: number; chips: number; bet: number; folded: boolean; allIn: boolean; hole: Card[] }[];
  payouts: { seat: number; amount: number; reason: string }[];
}

export function PokerMirror({ state }: { state: PokerMirrorState }) {
  const showdown = state.street === "done";
  return (
    <div className="poker-root">
      <div className="poker-board">
        <div className="poker-community">
          {state.community.map((card) => (
            <div key={`${card.rank}${card.suit}`} className={`poker-card${SUIT_IS_RED[card.suit] ? " is-red" : ""}`}>
              <span className="poker-rank">{rankName(card.rank)}</span>
              <span className="poker-suit">{SUIT_SYMBOL[card.suit]}</span>
            </div>
          ))}
          {state.community.length === 0 && <div className="poker-preflop">Pre-flop</div>}
        </div>
        <div className="poker-pot">Pot {state.pot}</div>
      </div>

      <div className="poker-seats">
        {state.seats.map((seat, index) => {
          const info = state.players[index];
          const isUp = index === state.toAct && !showdown;
          const won = state.payouts.filter((p) => p.seat === index).reduce((a, p) => a + p.amount, 0);
          return (
            <div
              key={seat.player}
              className={`poker-seat${isUp ? " is-up" : ""}${seat.folded ? " is-folded" : ""}${won > 0 ? " is-winner" : ""}`}
            >
              <div className="poker-seat-head">
                {info && <MiiAvatar mii={info.mii} size={36} />}
                <span className="poker-seat-name">
                  P{seat.player}
                  {index === state.button ? " (D)" : ""}
                </span>
                <span className="poker-seat-chips">{seat.chips}</span>
              </div>
              <div className="poker-seat-state">
                {seat.folded ? "folded" : seat.allIn ? "all in" : seat.bet > 0 ? `bet ${seat.bet}` : isUp ? "to act" : ""}
              </div>
              {/* Hole cards only ever arrive in the snapshot at a showdown. */}
              {seat.hole.length > 0 && (
                <div className="poker-seat-hole">
                  {seat.hole.map((card) => (
                    <span key={`${card.rank}${card.suit}`} className={SUIT_IS_RED[card.suit] ? "is-red" : ""}>
                      {rankName(card.rank)}
                      {SUIT_SYMBOL[card.suit]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ul className="poker-log">
        {state.log.slice(0, 5).map((line, i) => (
          <li key={`${line}-${i}`}>{line}</li>
        ))}
      </ul>
      <div className="poker-hint-bar">Watching - hole cards stay on the players phones</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Party games -- one mirror covers all three, because they publish the same
// shape: a phase, a clock, some prompt text and the running scores.
// ---------------------------------------------------------------------------

export interface PartyMirrorState {
  phase: string;
  points: number[];
  players: Seat[];
  clock: number;
  matchup?: { prompt: string; answers: [string, string] } | null;
  lastLash?: { prompt: string; answers: string[] };
  question?: { question: string; answer: string };
  options?: { text: string; author: number }[];
  faker?: number;
}

export function PartyMirror({ title, state }: { title: string; state: PartyMirrorState }) {
  const standings = state.points
    .map((points, player) => ({ points, player }))
    .sort((a, b) => b.points - a.points);
  const prompt = state.matchup?.prompt ?? state.question?.question ?? state.lastLash?.prompt ?? "";
  const counting = state.phase === "writing" || state.phase === "lying" || state.phase === "doing";

  return (
    <div className="party-root">
      <header className="party-header">
        <span className="party-title">{title}</span>
        <span className="party-round">{state.phase === "final" ? "Final scores" : state.phase}</span>
      </header>

      <div className="party-centre">
        {prompt && <p className="party-prompt">{prompt}</p>}
        {counting && <div className="party-clock">{state.clock}</div>}

        {state.matchup && (state.phase === "voting" || state.phase === "reveal") && (
          <div className="party-duel">
            <div className="party-answer">{state.matchup.answers[0] || "(no answer)"}</div>
            <span className="party-vs">vs</span>
            <div className="party-answer">{state.matchup.answers[1] || "(no answer)"}</div>
          </div>
        )}

        {state.options && state.options.length > 0 && (
          <div className="party-list">
            {state.options.map((option, i) => (
              <div
                key={i}
                className={`party-answer${state.phase === "reveal" && option.author === -1 ? " is-sweep" : ""}`}
              >
                {option.text}
              </div>
            ))}
          </div>
        )}

        {state.faker !== undefined && state.faker >= 0 && (
          <p className="party-sub">{state.players[state.faker]?.mii.name} was faking</p>
        )}

        <ol className="party-standings">
          {standings.map(({ player, points }, rank) => (
            <li key={player} className={rank === 0 ? "is-leader" : ""}>
              <span className="party-rank">{rank + 1}</span>
              {state.players[player] && <MiiAvatar mii={state.players[player].mii} size={30} />}
              <span className="party-who">
                P{state.players[player]?.player} - {state.players[player]?.mii.name}
              </span>
              <span className="party-score">{points}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="party-hint">Watching - answers arrive on the players phones</div>
    </div>
  );
}
