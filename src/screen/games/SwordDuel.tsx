import { useCallback, useEffect, useRef, useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import type { GameProps } from "./types";
import { useSwing } from "./useSwing";
import { MiiAvatar } from "../mii/MiiAvatar";
import { MII_ROSTER } from "../mii/Mii";
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
const WIN_SCORE = 2; // first to two ring-outs wins -- matches Duel's "best of" ring-out format
const RESULT_DISPLAY_MS = 3000;

// Live-blade + angle-matching tuning.
const BLADE_MAX_ANGLE = 75; // clamp the live blade's on-screen rotation to a legible range
const TARGET_ANGLE_RANGE = 60; // target cut-angle randomized within +/-60deg of vertical
const ANGLE_TOLERANCE_DEG = 28; // how close a swing's angle must land to the target for a clean hit

// The Mii avatar's bounding-box width, in px -- matches the old CSS-only
// silhouette's `max-width: 90px` so the ring-out shove distances (tuned in
// sword.css as percentages of the duelist's own box width) still land in
// roughly the same place without needing to be retuned.
const MII_SIZE = 90;
// A fixed roster pick for the opponent -- any single Mii works here, this
// one's arbitrary (avoiding index 0 in case that ever becomes a "your Mii"
// default elsewhere, though it likely doesn't matter for a duel opponent).
const OPPONENT_MII = MII_ROSTER[1];

type ClashPhase = "waiting" | "reactWindow" | "resolved";
// "blocked" is distinct from "miss": the player swung inside the reaction
// window (so it's not a timing failure) but at the wrong angle, so the
// opponent's blade parries it -- per the real game, cutting along the
// blade lands a hit, but a mismatched angle gets blocked instead.
type Outcome = "hit" | "miss" | "falseStart" | "blocked" | null;

function randomWaitMs() {
  return MIN_WAIT_MS + Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS);
}

function randomTargetAngle() {
  return (Math.random() * 2 - 1) * TARGET_ANGLE_RANGE;
}

export function SwordDuel({ send: _send, subscribe, onExit, mii }: GameProps) {
  const [playerRingouts, setPlayerRingouts] = useState(0);
  const [opponentRingouts, setOpponentRingouts] = useState(0);
  const [clashKey, setClashKey] = useState(0);
  const [clashPhase, setClashPhase] = useState<ClashPhase>("waiting");
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [result, setResult] = useState<"win" | "lose" | null>(null);
  // The target cut-angle for the current clash, in degrees (same space as
  // the live blade's rotation). Re-rolled each time the reaction window
  // opens. State drives the rendered indicator; the ref lets handleSwing
  // (set up once by useSwing) read the current value synchronously.
  const [targetAngle, setTargetAngle] = useState(0);
  const targetAngleRef = useRef(0);

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

  // The live blade element the player's phone orientation drives directly --
  // updated by imperative style writes on every `motion` message (see the
  // effect below) rather than React state, so a ~30/sec stream of ticks
  // doesn't trigger a re-render each time.
  const bladeRef = useRef<HTMLDivElement>(null);
  // Mirrors the blade's current on-screen angle (post-clamp) so handleSwing
  // can read "where was the blade pointing right now" synchronously, without
  // waiting on a render.
  const lastBladeAngleRef = useRef(0);

  const clearClashTimers = useCallback(() => {
    if (waitTimerRef.current) clearTimeout(waitTimerRef.current);
    if (reactTimerRef.current) clearTimeout(reactTimerRef.current);
    waitTimerRef.current = null;
    reactTimerRef.current = null;
  }, []);

  const resolveClash = useCallback((nextOutcome: "hit" | "miss" | "falseStart" | "blocked") => {
    if (phaseRef.current === "resolved") return;
    phaseRef.current = "resolved";
    setClashPhase("resolved");
    clearClashTimers();
    if (nextOutcome === "hit") {
      setPlayerRingouts((s) => s + 1);
    } else if (nextOutcome === "miss" || nextOutcome === "falseStart") {
      // Both a miss (window expired) and a false start (slashed too early)
      // score the opponent.
      setOpponentRingouts((s) => s + 1);
    }
    // A "blocked" swing (right timing, wrong angle) scores nobody -- the
    // parry just cancels the exchange, same as a real clash.
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

      // Roll a fresh target cut-angle the instant the window opens, so it's
      // on screen for the player to match for the whole react window.
      const angle = randomTargetAngle();
      targetAngleRef.current = angle;
      setTargetAngle(angle);

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
    if (playerRingouts >= WIN_SCORE) {
      setResult("win");
    } else if (opponentRingouts >= WIN_SCORE) {
      setResult("lose");
    }
  }, [playerRingouts, opponentRingouts, result]);

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
      // Angle-matching heuristic: rather than trying to derive a one-shot
      // swing-direction vector out of a single noisy accelerometer spike
      // (ax/ay at the instant of the swing), we compare the target angle to
      // the live blade angle that's already being driven continuously by
      // the phone's roll (gamma) -- i.e. "wherever your blade was pointing
      // the instant you flicked it". This is simpler and more robust than a
      // discrete accel-direction guess, and it's more honest to the real
      // mechanic ("cut along the angle you're holding the blade at") since
      // it's the exact same number the player is watching on screen.
      const diff = Math.abs(lastBladeAngleRef.current - targetAngleRef.current);
      if (diff <= ANGLE_TOLERANCE_DEG) {
        resolveClash("hit");
      } else {
        resolveClash("blocked");
      }
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

  // Live blade tracking: mirror the phone's real-time roll (gamma) onto the
  // on-screen blade every `motion` tick, regardless of clash phase -- this
  // runs continuously (including during "waiting") so holding/rotating the
  // phone always visibly moves the blade, same as actually holding a sword.
  // Written straight to the DOM (not React state) since motion ticks arrive
  // ~30/sec and a re-render per tick would be wasteful; cleaned up on
  // unmount via the same subscribe/unsubscribe pattern as every other
  // listener in this file.
  useEffect(() => {
    return subscribe((msg: ControllerMessage) => {
      if (msg.type !== "motion") return;
      const { gamma } = msg.sample;
      if (gamma === null) return;
      const angle = Math.max(-BLADE_MAX_ANGLE, Math.min(BLADE_MAX_ANGLE, gamma));
      lastBladeAngleRef.current = angle;
      const el = bladeRef.current;
      if (el) {
        el.style.transform = `rotate(${angle}deg)`;
      }
    });
  }, [subscribe]);

  return (
    <div className="sword-root">
      <div className="sword-scoreboard">
        <div className="sword-score-block">
          <span className="sword-score-label">You</span>
          <span className="sword-score-value">{playerRingouts}</span>
        </div>
        <div className="sword-score-divider">-</div>
        <div className="sword-score-block">
          <span className="sword-score-label">Opponent</span>
          <span className="sword-score-value">{opponentRingouts}</span>
        </div>
      </div>
      <div className="sword-scoreboard-caption">First to {WIN_SCORE} ring-outs wins</div>

      <div className="sword-arena">
        {/* Pushed further toward its edge of the arena as that side takes
            more ring-outs -- a lasting knockback, not just a flash. */}
        <div
          className={`sword-duelist sword-duelist-player sword-duelist-shoved-${Math.min(opponentRingouts, 2)}`}
        >
          {/* The player's actual chosen Mii, arm raised into the sword-ready
              pose -- the live blade below is positioned to read as being
              held in that raised hand. */}
          <MiiAvatar mii={mii} pose="sword-ready" size={MII_SIZE} className="sword-mii" />
          {/* The player's live blade -- rotation is written imperatively by
              the motion-tracking effect above, not by React re-renders. */}
          <div ref={bladeRef} className="sword-blade sword-blade-player" />
          {!result && clashPhase === "reactWindow" && (
            <div
              key={clashKey}
              className="sword-target-angle"
              style={{ transform: `rotate(${targetAngle}deg)` }}
            />
          )}
        </div>
        <div
          className={`sword-duelist sword-duelist-opponent sword-duelist-shoved-${Math.min(playerRingouts, 2)}`}
        >
          {/* A fixed roster Mii stands in for the opponent, mirrored (via
              CSS scaleX(-1) on sword-mii-opponent) so the two duelists
              visually face each other across the arena. */}
          <MiiAvatar
            mii={OPPONENT_MII}
            pose="sword-ready"
            size={MII_SIZE}
            className="sword-mii sword-mii-opponent"
          />
        </div>

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
        {outcome === "blocked" && <div className="sword-flash sword-flash-blocked" />}

        {outcome === "hit" && <div className="sword-outcome sword-outcome-hit">Ring-out!</div>}
        {outcome === "miss" && <div className="sword-outcome sword-outcome-miss">Too slow!</div>}
        {outcome === "falseStart" && (
          <div className="sword-outcome sword-outcome-falsestart">Too early!</div>
        )}
        {outcome === "blocked" && (
          <div className="sword-outcome sword-outcome-blocked">Blocked!</div>
        )}
      </div>

      {!result && (
        <div className="sword-hint">
          Watch your blade, wait for SLASH!, then cut along the shown angle.
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
