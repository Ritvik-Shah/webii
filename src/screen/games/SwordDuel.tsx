import { useCallback, useEffect, useRef, useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import type { GameProps } from "./types";
import { useSwing } from "./useSwing";
import "./sword.css";

// First-pass swing-detection numbers -- not yet validated against a real
// phone. A duel is about quick reaction slashes rather than a big tennis-
// style swing, so this is tuned lower/faster than that game's 14/450ms:
// easier to trigger, and re-arms sooner so a fast double-tap slash doesn't
// get eaten by cooldown. Adjust after live playtesting.
const SWING_THRESHOLD = 11;
const SWING_COOLDOWN_MS = 300;

// Clash timing.
const MIN_WAIT_MS = 800; // shortest "hold steady" delay before the prompt
const MAX_WAIT_MS = 2500; // longest "hold steady" delay before the prompt
const REACT_WINDOW_MS = 600; // how long the player has to slash once "NOW!" appears
const CLASH_PAUSE_MS = 900; // beat between a resolved clash and the next one starting
const WIN_SCORE = 5;
const RESULT_DISPLAY_MS = 3000;

type ClashPhase = "waiting" | "reactWindow" | "resolved";
type Outcome = "hit" | "miss" | "falseStart" | null;

function randomWaitMs() {
  return MIN_WAIT_MS + Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS);
}

export function SwordDuel({ send: _send, subscribe, onExit }: GameProps) {
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [clashKey, setClashKey] = useState(0);
  const [clashPhase, setClashPhase] = useState<ClashPhase>("waiting");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [result, setResult] = useState<"win" | "lose" | null>(null);

  // Authoritative phase for timing/scoring decisions -- mirrors clashPhase
  // state but readable synchronously from timeout callbacks and the swing
  // handler without waiting on a render. Also doubles as the "already
  // resolved this clash" guard so a stray extra swing (or a swing landing
  // right as the window timeout fires) can't double-score.
  const phaseRef = useRef<ClashPhase>("waiting");
  // Always-current result so the swing handler (set up once by useSwing)
  // never scores against a stale closure after the match has ended.
  const stateRef = useRef({ result });
  stateRef.current = { result };

  const waitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextClashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClashTimers = useCallback(() => {
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    if (reactTimerRef.current) clearTimeout(reactTimerRef.current);
    waitTimerRef.current = null;
    reactTimerRef.current = null;
  }, []);

  const resolveClash = useCallback((nextOutcome: "hit" | "miss" | "falseStart") => {
    if (phaseRef.current === "resolved") return;
    phaseRef.current = "resolved";
    setClashPhase("resolved");
    clearClashTimers();
    if (nextOutcome === "hit") {
      setPlayerScore((s) => s + 1);
    } else {
      // Both a miss (window expired) and a false start (slashed too early)
      // score the opponent.
      setOpponentScore((s) => s + 1);
    }
    setOutcome(nextOutcome);
  }, [clearClashTimers]);

  // Kick off each clash: a randomized "hold steady" delay, then the "NOW!"
  // prompt opens the reaction window, then -- if nothing was swung -- the
  // window itself resolves the clash as a miss.
  useEffect(() => {
    if (result) return;

    phaseRef.current = "waiting";
    setClashPhase("waiting");
    setOutcome(null);

    waitTimerRef.current = setTimeout(() => {
      phaseRef.current = "reactWindow";
      setClashPhase("reactWindow");

      reactTimerRef.current = setTimeout(() => {
        if (phaseRef.current === "reactWindow") {
          resolveClash("miss");
        }
      }, REACT_WINDOW_MS);
    }, randomWaitMs());

    return clearClashTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clashKey, result]);

  // Once a clash resolves, queue up the next one after a short pause (unless
  // the match just ended).
  useEffect(() => {
    if (result) return;
    if (phaseRef.current !== "resolved") return;

    nextClashTimerRef.current = setTimeout(() => {
      setClashKey((k) => k + 1);
    }, CLASH_PAUSE_MS);

    return () => {
      if (nextClashTimerRef.current) clearTimeout(nextClashTimerRef.current);
    };
  }, [outcome, result]);

  // Decide the duel once a score hits the win threshold.
  useEffect(() => {
    if (result) return;
    if (playerScore >= WIN_SCORE) {
      setResult("win");
    } else if (opponentScore >= WIN_SCORE) {
      setResult("lose");
    }
  }, [playerScore, opponentScore, result]);

  // When the duel ends, stop any in-flight clash and auto-exit after a beat.
  useEffect(() => {
    if (!result) return;
    clearClashTimers();
    if (nextClashTimerRef.current) clearTimeout(nextClashTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      onExit();
    }, RESULT_DISPLAY_MS);
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [result, onExit, clearClashTimers]);

  // Clean up all timers on unmount.
  useEffect(() => {
    return () => {
      clearClashTimers();
      if (nextClashTimerRef.current) clearTimeout(nextClashTimerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [clearClashTimers]);

  const handleSwing = useCallback(() => {
    if (stateRef.current.result) return;
    if (phaseRef.current === "waiting") {
      resolveClash("falseStart");
    } else if (phaseRef.current === "reactWindow") {
      resolveClash("hit");
    }
    // A swing after the window has already resolved (phaseRef === "resolved")
    // is ignored -- the clash outcome is already locked in.
  }, [resolveClash]);

  useSwing(subscribe, handleSwing, {
    threshold: SWING_THRESHOLD,
    cooldownMs: SWING_COOLDOWN_MS,
  });

  // Also accept an A-button tap as a slash, same as the swing gesture.
  useEffect(() => {
    return subscribe((msg: ControllerMessage) => {
      if (msg.type === "button" && msg.button === "A" && msg.state === "down") {
        handleSwing();
      }
    });
  }, [subscribe, handleSwing]);

  return (
    <div className="sword-root">
      <div className="sword-scoreboard">
        <div className="sword-score-block">
          <span className="sword-score-label">You</span>
          <span className="sword-score-value">{playerScore}</span>
        </div>
        <div className="sword-score-divider">-</div>
        <div className="sword-score-block">
          <span className="sword-score-label">Opponent</span>
          <span className="sword-score-value">{opponentScore}</span>
        </div>
      </div>

      <div className="sword-arena">
        <div className="sword-duelist sword-duelist-player" />
        <div className="sword-duelist sword-duelist-opponent" />

        {!result && clashPhase === "waiting" && (
          <div className="sword-waiting">
            <span className="sword-waiting-text">Hold steady&hellip;</span>
          </div>
        )}

        {!result && clashPhase === "reactWindow" && (
          <div key={clashKey} className="sword-prompt">
            SLASH!
          </div>
        )}

        {outcome === "hit" && <div className="sword-flash sword-flash-hit" />}
        {outcome === "miss" && <div className="sword-flash sword-flash-miss" />}
        {outcome === "falseStart" && <div className="sword-flash sword-flash-falsestart" />}

        {outcome === "hit" && <div className="sword-outcome sword-outcome-hit">Hit!</div>}
        {outcome === "miss" && <div className="sword-outcome sword-outcome-miss">Too slow!</div>}
        {outcome === "falseStart" && (
          <div className="sword-outcome sword-outcome-falsestart">Too early!</div>
        )}
      </div>

      {!result && (
        <div className="sword-hint">
          Wait for it&hellip; then swing your phone (or tap A) the instant you see SLASH!
        </div>
      )}

      {result && (
        <div className="sword-result">
          <div className={result === "win" ? "sword-result-win" : "sword-result-lose"}>
            {result === "win" ? "You win!" : "You lose!"}
          </div>
          <div className="sword-result-sub">Returning to the Wii Menu&hellip;</div>
        </div>
      )}

      <div className="sword-footer">Press HOME on your phone anytime to exit.</div>
    </div>
  );
}
