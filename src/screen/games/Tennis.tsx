import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import type { GameProps } from "./types";
import { useSwing } from "./useSwing";
import { MiiAvatar } from "../mii/MiiAvatar";
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

// --- Shot placement from swing timing -------------------------------------
// The hit window is split into equal early/mid/late thirds. Where in that
// window the swing/A-press lands determines placement, matching real Wii
// Sports Tennis: an early swing meets the ball out front (cross-court), a
// late swing meets it deep (down the line), a swing in the middle goes
// down the middle. Convention (arbitrary but consistent): cross-court lands
// on the LEFT of the opponent's court, down-the-line on the RIGHT -- see
// LANDING_X below, which the CSS zone guides (.tennis-zone-line) mirror.
type Placement = "cross" | "middle" | "line";
const LANDING_X: Record<Placement, number> = { cross: 22, middle: 50, line: 78 };

// --- Shot height/type from phone pitch during the swing --------------------
// Heuristic, not a precise gesture read: we keep a rolling buffer of recent
// `beta` (front/back tilt) samples and, at swing time, diff the latest
// reading against one from ~150ms earlier. A rising beta over that window
// reads as the phone pitching up (low-to-high swing) -> lob. Anything else
// (pitching down, or roughly flat) reads as a flat/slice shot. This is a
// coarse approximation of swing arc, good enough to pick one of two shot
// shapes -- not a real motion classifier.
type Pitch = "lob" | "flat";
const PITCH_LOOKBACK_MS = 150;
const PITCH_UP_DELTA_DEG = 8;

type ShotOutcome = "winner" | "return-error";
interface ShotResult {
  placement: Placement;
  pitch: Pitch;
  outcome: ShotOutcome;
}

// Down-the-middle shots aren't automatic winners -- give the "opponent" a
// real (not guaranteed) chance to read one and send it back as an unforced
// error, so aiming for the corners actually matters instead of every swing
// scoring the same point. Rolled once per down-the-middle shot in
// resolveShot.
const MIDDLE_RETURN_CHANCE = 0.4;

// Shot-flight animation: duration/arc height per pitch type. Lob = slower,
// higher arc; flat/slice = quicker, flatter.
const SHOT_DURATION_LOB_MS = 650;
const SHOT_DURATION_FLAT_MS = 350;
const SHOT_PEAK_LOB_PX = 60;
const SHOT_PEAK_FLAT_PX = 16;
const SHOT_MESSAGE_MS = 900; // how long the outcome banner + flight stay visible

type Feedback = "winner" | "return-error" | "miss" | null;

function randomApproachMs() {
  return MIN_APPROACH_MS + Math.random() * (MAX_APPROACH_MS - MIN_APPROACH_MS);
}

// Reads placement+pitch into a short player-facing line. Kept terse -- it's
// read mid-game in a couple of seconds.
function describeShot(shot: ShotResult): string {
  if (shot.outcome === "return-error") {
    return shot.pitch === "lob" ? "Lob returned — unforced error!" : "Down the middle — unforced error!";
  }
  switch (shot.placement) {
    case "cross":
      return shot.pitch === "lob" ? "Cross-court lob — winner!" : "Cross-court winner!";
    case "line":
      return shot.pitch === "lob" ? "Down the line, lobbed — winner!" : "Down the line winner!";
    default:
      return "Down the middle — point!";
  }
}

// Diffs the latest beta sample against one from ~PITCH_LOOKBACK_MS ago to
// guess whether the swing pitched the phone low-to-high (lob) or not
// (flat/slice). See the heuristic note above LANDING_X/PITCH_LOOKBACK_MS.
function classifyPitch(buffer: { t: number; beta: number }[]): Pitch {
  if (buffer.length < 2) return "flat";
  const now = Date.now();
  const latest = buffer[buffer.length - 1];
  let past = buffer[0];
  for (const sample of buffer) {
    if (now - sample.t <= PITCH_LOOKBACK_MS) {
      past = sample;
      break;
    }
  }
  const delta = latest.beta - past.beta;
  return delta > PITCH_UP_DELTA_DEG ? "lob" : "flat";
}

// Where the incoming ball ends up (player's contact point) and where a
// returned shot lands, in percent of the court box -- mirrors the
// tennis-approach keyframe's 8%/78% top range in tennis.css.
const SHOT_START_TOP = 78;
const SHOT_END_TOP = 14;

// Computes the flying ball's inline style at animation progress t (0..1):
// lerps position toward the landing zone while adding a parabolic vertical
// "lift" (peak at t=0.5) to suggest an arc, and shrinks the ball to suggest
// it traveling away from the camera.
function computeShotStyle(shot: ShotResult, t: number): CSSProperties {
  const top = SHOT_START_TOP + (SHOT_END_TOP - SHOT_START_TOP) * t;
  const left = 50 + (LANDING_X[shot.placement] - 50) * t;
  const size = 44 - (44 - 10) * t;
  const peakPx = shot.pitch === "lob" ? SHOT_PEAK_LOB_PX : SHOT_PEAK_FLAT_PX;
  const arcLift = peakPx * 4 * t * (1 - t); // parabola: 0 at t=0/1, peak at t=0.5
  return {
    top: `${top}%`,
    left: `${left}%`,
    width: `${size}px`,
    height: `${size}px`,
    marginLeft: `${-size / 2}px`,
    marginTop: `${-size / 2}px`,
    transform: `translateY(${-arcLift}px)`,
  };
}

export function Tennis({ send: _send, subscribe, onExit, mii }: GameProps) {
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  // Bumped on every real swing attempt (not on an unswung miss) so the
  // player's Mii replays its one-shot swing animation via a changing `key`.
  const [swingTrigger, setSwingTrigger] = useState(0);
  const [approachMs, setApproachMs] = useState<number>(() => randomApproachMs());
  const [ballKey, setBallKey] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  // Most recently resolved shot (placement/pitch/outcome), for the outcome
  // banner and to drive the flight animation below.
  const [shotResult, setShotResult] = useState<ShotResult | null>(null);
  // 0..1 progress through the current shot's flight animation.
  const [shotProgress, setShotProgress] = useState(0);

  // Whether a swing/tap right now counts as a hit.
  const hitWindowRef = useRef(false);
  // When the current hit window opened (ms, Date.now()) -- used to bucket a
  // swing into early/mid/late thirds for shot placement.
  const windowOpenedAtRef = useRef<number | null>(null);
  // Rolling buffer of recent `beta` (front/back tilt) samples, newest last,
  // used by classifyPitch to read swing pitch. Trimmed in the motion
  // subscription below so it never grows unbounded over a long match.
  const betaBufferRef = useRef<{ t: number; beta: number }[]>([]);
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
  // requestAnimationFrame handle driving the current shot's flight arc.
  const shotRafRef = useRef<number | null>(null);
  const shotStartRef = useRef(0);

  const clearBallTimers = useCallback(() => {
    if (approachTimerRef.current) clearTimeout(approachTimerRef.current);
    if (windowOpenTimerRef.current) clearTimeout(windowOpenTimerRef.current);
    approachTimerRef.current = null;
    windowOpenTimerRef.current = null;
  }, []);

  const cancelShotAnimation = useCallback(() => {
    if (shotRafRef.current !== null) {
      cancelAnimationFrame(shotRafRef.current);
      shotRafRef.current = null;
    }
  }, []);

  // Drives the ball-flight arc for a resolved shot via rAF, animating
  // shotProgress 0 -> 1 over the pitch-dependent duration. Render reads
  // shotProgress + shotResult to compute the ball's position (see
  // computeShotStyle below).
  const launchShotAnimation = useCallback(
    (pitch: Pitch) => {
      cancelShotAnimation();
      setShotProgress(0);
      shotStartRef.current = performance.now();
      const duration = pitch === "lob" ? SHOT_DURATION_LOB_MS : SHOT_DURATION_FLAT_MS;

      const tick = (now: number) => {
        const t = Math.min(1, (now - shotStartRef.current) / duration);
        setShotProgress(t);
        if (t < 1) {
          shotRafRef.current = requestAnimationFrame(tick);
        } else {
          shotRafRef.current = null;
        }
      };
      shotRafRef.current = requestAnimationFrame(tick);
    },
    [cancelShotAnimation],
  );

  const registerMiss = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    hitWindowRef.current = false;
    setOpponentScore((s) => s + 1);
    setFeedback("miss");
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 350);
  }, []);

  // Successful swing: classify placement+pitch already happened in
  // attemptHit, this scores/animates/announces the result. Corners are
  // clean winners; a down-the-middle shot has a real chance of coming back
  // as an unforced error (see MIDDLE_RETURN_CHANCE above).
  const resolveShot = useCallback(
    (placement: Placement, pitch: Pitch) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      hitWindowRef.current = false;
      setSwingTrigger((k) => k + 1);

      const isReturned = placement === "middle" && Math.random() < MIDDLE_RETURN_CHANCE;
      const outcome: ShotOutcome = isReturned ? "return-error" : "winner";
      const shot: ShotResult = { placement, pitch, outcome };

      if (outcome === "winner") {
        setPlayerScore((s) => s + 1);
      } else {
        setOpponentScore((s) => s + 1);
      }
      setFeedback(outcome);
      setShotResult(shot);
      launchShotAnimation(pitch);

      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => {
        setFeedback(null);
        setShotResult(null);
      }, SHOT_MESSAGE_MS);
    },
    [launchShotAnimation],
  );

  // Schedule each ball's approach: open the hit window near the end, and
  // register a miss automatically if the ball "arrives" unhit.
  useEffect(() => {
    if (result) return; // match already decided, stop scheduling

    resolvedRef.current = false;
    hitWindowRef.current = false;
    windowOpenedAtRef.current = null;

    const windowDelay = Math.max(0, approachMs - HIT_WINDOW_MS);
    windowOpenTimerRef.current = setTimeout(() => {
      hitWindowRef.current = true;
      windowOpenedAtRef.current = Date.now();
    }, windowDelay);

    approachTimerRef.current = setTimeout(() => {
      hitWindowRef.current = false;
      registerMiss();
    }, approachMs);

    return clearBallTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballKey, result]);

  // After a hit or miss resolves, queue up the next ball (unless the match
  // just ended). A scored point keeps its flight animation + outcome banner
  // on screen for SHOT_MESSAGE_MS, so wait that long before the next ball
  // appears; a miss only shows a brief flash, so it can queue sooner.
  useEffect(() => {
    if (result) return;
    if (!resolvedRef.current) return;

    const delay = feedback === "miss" ? 500 : SHOT_MESSAGE_MS;
    const next = setTimeout(() => {
      setApproachMs(randomApproachMs());
      setBallKey((k) => k + 1);
    }, delay);

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

  // When the match ends, stop any in-flight ball/shot animation and
  // auto-exit after a beat.
  useEffect(() => {
    if (!result) return;
    clearBallTimers();
    cancelShotAnimation();
    exitTimerRef.current = setTimeout(() => {
      onExit();
    }, RESULT_DISPLAY_MS);
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [result, onExit, clearBallTimers, cancelShotAnimation]);

  // Clean up all timers (and the shot-flight rAF loop) on unmount.
  useEffect(() => {
    return () => {
      clearBallTimers();
      cancelShotAnimation();
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [clearBallTimers, cancelShotAnimation]);

  // Tracks recent phone pitch (beta) so classifyPitch can read swing shape
  // at hit time. A separate subscription from useSwing's internal one, per
  // the task brief -- useSwing only reports "a swing happened", not the
  // orientation trace around it.
  useEffect(() => {
    return subscribe((msg: ControllerMessage) => {
      if (msg.type !== "motion") return;
      const { beta } = msg.sample;
      if (beta === null) return;
      const buf = betaBufferRef.current;
      const now = Date.now();
      buf.push({ t: now, beta });
      // Drop samples we can no longer need for the lookback diff.
      const cutoff = now - PITCH_LOOKBACK_MS * 3;
      while (buf.length > 1 && buf[0].t < cutoff) buf.shift();
    });
  }, [subscribe]);

  const attemptHit = useCallback(() => {
    if (stateRef.current.result) return;
    if (!hitWindowRef.current) return;

    // Which third of the hit window the swing landed in decides placement.
    const openedAt = windowOpenedAtRef.current ?? Date.now();
    const elapsed = Date.now() - openedAt;
    const third = HIT_WINDOW_MS / 3;
    const placement: Placement = elapsed < third ? "cross" : elapsed < third * 2 ? "middle" : "line";

    const pitch = classifyPitch(betaBufferRef.current);

    resolveShot(placement, pitch);
  }, [resolveShot]);

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
        {/* Static target-zone guides -- their left offsets mirror LANDING_X
            above (22 / 78) so what's drawn matches what actually scores. */}
        <div className="tennis-zone-line tennis-zone-line-left" />
        <div className="tennis-zone-line tennis-zone-line-right" />
        {!result && !shotResult && (
          <div
            key={ballKey}
            className="tennis-ball"
            style={{ animationDuration: `${approachMs}ms` }}
          />
        )}
        {shotResult && (
          <div
            className={
              "tennis-shot " +
              (shotResult.outcome === "winner" ? "tennis-shot-winner" : "tennis-shot-return")
            }
            style={computeShotStyle(shotResult, shotProgress)}
          />
        )}
        {feedback === "winner" && <div className="tennis-flash tennis-flash-hit" />}
        {feedback === "return-error" && <div className="tennis-flash tennis-flash-return" />}
        {feedback === "miss" && <div className="tennis-flash tennis-flash-miss" />}
        {shotResult && <div className="tennis-shot-message">{describeShot(shotResult)}</div>}

        <MiiAvatar
          key={swingTrigger}
          mii={mii}
          pose={swingTrigger > 0 ? "tennis-swing" : "idle"}
          size={84}
          className="tennis-mii"
        />
      </div>

      {!result && (
        <div className="tennis-hint">
          Swing early for cross-court, late for down the line. Low-to-high = lob. (Or tap A.)
        </div>
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
