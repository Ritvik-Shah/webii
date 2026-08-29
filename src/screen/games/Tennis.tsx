import { useCallback, useEffect, useRef, useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import type { GameProps } from "./types";
import { useSwing } from "./useSwing";
import "./tennis.css";

// First-pass swing-detection numbers -- not yet validated against a real
// phone. Tune these after live playtesting (raise threshold if swings fire
// too easily, lower it if real swings get missed; adjust cooldownMs if
// back-to-back rallies feel sluggish or double-fire).
const SWING_THRESHOLD = 14;
const SWING_COOLDOWN_MS = 450;

// Ball approach timing.
const MIN_APPROACH_MS = 1200;
const MAX_APPROACH_MS = 2200;
const HIT_WINDOW_MS = 400; // last slice of the approach that counts as a valid hit
const WIN_SCORE = 5;
const RESULT_DISPLAY_MS = 3000;

type Feedback = "hit" | "miss" | null;

function randomApproachMs() {
  return MIN_APPROACH_MS + Math.random() * (MAX_APPROACH_MS - MIN_APPROACH_MS);
}

export function Tennis({ send: _send, subscribe, onExit }: GameProps) {
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [approachMs, setApproachMs] = useState<number>(() => randomApproachMs());
  const [ballKey, setBallKey] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [result, setResult] = useState<"win" | "lose" | null>(null);

  // Whether a swing/tap right now counts as a hit.
  const hitWindowRef = useRef(false);
  // Guards against double-scoring the same ball if a stray extra swing event
  // slips through useSwing's hysteresis while still inside the same window.
  const resolvedRef = useRef(false);
  // Always-current scores/result so timeout callbacks and message handlers
  // (set up once) can read fresh state without becoming stale closures.
  const stateRef = useRef({ playerScore, opponentScore, result });
  stateRef.current = { playerScore, opponentScore, result };

  const approachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBallTimers = useCallback(() => {
    if (approachTimerRef.current) clearTimeout(approachTimerRef.current);
    if (windowOpenTimerRef.current) clearTimeout(windowOpenTimerRef.current);
    approachTimerRef.current = null;
    windowOpenTimerRef.current = null;
  }, []);

  const registerMiss = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    hitWindowRef.current = false;
    setOpponentScore((s) => s + 1);
    setFeedback("miss");
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 350);
  }, []);

  const registerHit = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    hitWindowRef.current = false;
    setPlayerScore((s) => s + 1);
    setFeedback("hit");
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 350);
  }, []);

  // Schedule each ball's approach: open the hit window near the end, and
  // register a miss automatically if the ball "arrives" unhit.
  useEffect(() => {
    if (result) return; // match already decided, stop scheduling

    resolvedRef.current = false;
    hitWindowRef.current = false;

    const windowDelay = Math.max(0, approachMs - HIT_WINDOW_MS);
    windowOpenTimerRef.current = setTimeout(() => {
      hitWindowRef.current = true;
    }, windowDelay);

    approachTimerRef.current = setTimeout(() => {
      hitWindowRef.current = false;
      registerMiss();
    }, approachMs);

    return clearBallTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballKey, result]);

  // After a hit or miss resolves, queue up the next ball (unless the match
  // just ended).
  useEffect(() => {
    if (result) return;
    if (!resolvedRef.current) return;

    const next = setTimeout(() => {
      setApproachMs(randomApproachMs());
      setBallKey((k) => k + 1);
    }, 500);

    return () => clearTimeout(next);
  }, [feedback, result]);

  // Decide the match once a score hits the win threshold.
  useEffect(() => {
    if (result) return;
    if (playerScore >= WIN_SCORE) {
      setResult("win");
    } else if (opponentScore >= WIN_SCORE) {
      setResult("lose");
    }
  }, [playerScore, opponentScore, result]);

  // When the match ends, stop any in-flight ball and auto-exit after a beat.
  useEffect(() => {
    if (!result) return;
    clearBallTimers();
    exitTimerRef.current = setTimeout(() => {
      onExit();
    }, RESULT_DISPLAY_MS);
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [result, onExit, clearBallTimers]);

  // Clean up all timers on unmount.
  useEffect(() => {
    return () => {
      clearBallTimers();
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [clearBallTimers]);

  const attemptHit = useCallback(() => {
    if (stateRef.current.result) return;
    if (hitWindowRef.current) {
      registerHit();
    }
  }, [registerHit]);

  useSwing(subscribe, attemptHit, {
    threshold: SWING_THRESHOLD,
    cooldownMs: SWING_COOLDOWN_MS,
  });

  // Also accept an A-button tap as a hit attempt.
  useEffect(() => {
    return subscribe((msg: ControllerMessage) => {
      if (msg.type === "button" && msg.button === "A" && msg.state === "down") {
        attemptHit();
      }
    });
  }, [subscribe, attemptHit]);

  return (
    <div className="tennis-root">
      <div className="tennis-scoreboard">
        <div className="tennis-score-block">
          <span className="tennis-score-label">You</span>
          <span className="tennis-score-value">{playerScore}</span>
        </div>
        <div className="tennis-score-divider">-</div>
        <div className="tennis-score-block">
          <span className="tennis-score-label">Opponent</span>
          <span className="tennis-score-value">{opponentScore}</span>
        </div>
      </div>

      <div className="tennis-court">
        <div className="tennis-net" />
        {!result && (
          <div
            key={ballKey}
            className="tennis-ball"
            style={{ animationDuration: `${approachMs}ms` }}
          />
        )}
        {feedback === "hit" && <div className="tennis-flash tennis-flash-hit" />}
        {feedback === "miss" && <div className="tennis-flash tennis-flash-miss" />}
      </div>

      {!result && (
        <div className="tennis-hint">Swing your phone (or tap A) as the ball reaches you!</div>
      )}

      {result && (
        <div className="tennis-result">
          <div className={result === "win" ? "tennis-result-win" : "tennis-result-lose"}>
            {result === "win" ? "You win!" : "You lose!"}
          </div>
          <div className="tennis-result-sub">Returning to the Wii Menu…</div>
        </div>
      )}

      <div className="tennis-footer">Press HOME on your phone anytime to exit.</div>
    </div>
  );
}
