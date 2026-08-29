import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import "./bowling.css";
import type { GameProps } from "./types";
import type { MotionSample } from "../../../shared/protocol";
import { MiiAvatar } from "../mii/MiiAvatar";
import { playLaunchChime } from "../../lib/sound";

// ---------------------------------------------------------------------------
// Swing/release tuning -- all first-pass, unvalidated against a real device.
// Adjust after live playtesting, same as the X_SIGN/Y_SIGN flip constants in
// useMotionStream.ts and the SWING_THRESHOLD pattern this replaces.
// ---------------------------------------------------------------------------

// Beta angular velocity (deg/sec) that counts as the start of a deliberate
// swing motion (either the backswing or its forward reversal). Needs to be
// sustained for BACKSWING_SUSTAIN_SAMPLES consecutive motion samples in the
// same direction so a single noisy reading can't trigger a phase change.
const BACKSWING_VELOCITY_THRESHOLD_DPS = 60;
const BACKSWING_SUSTAIN_SAMPLES = 2;

// Once the forward swing begins, release fires after beta has rotated this
// many degrees (in the forward direction) past wherever beta was when the
// forward phase started. This stands in for "beta crosses a fixed
// downward-facing threshold" from a delta instead of an absolute value,
// because we don't yet know the real sign/zero-point of beta in an actual
// bowling grip -- a delta-based trigger gets the same "release timed to
// crossing a pitch threshold during the forward swing" feel while staying
// correct regardless of which way beta happens to run on a given phone.
const RELEASE_BETA_DELTA_DEG = 25;

// Peak forward beta velocity (deg/sec) that maps to full swing power (1.0).
const MAX_FORWARD_BETA_VELOCITY_DPS = 220;

// If a swing gets stuck in backswing/forward for this long without
// releasing (noisy sensor data misreading a phase), auto-reset to idle so
// the player never gets soft-locked out of their own turn.
const SWING_SAFETY_TIMEOUT_MS = 3000;

// How long each phase's beat lasts, in ms.
const ROLLING_DURATION_MS = 1100;
const RESULT_DURATION_MS = 1800;
const FINAL_DURATION_MS = 3000;

const FRAME_COUNT = 10;

type Phase = "ready" | "rolling" | "result" | "gameover";
type SwingPhase = "idle" | "backswing" | "forward";
type PositionMode = "position" | "angle";

// ---------------------------------------------------------------------------
// Pin geometry -- unchanged from the previous version. Pins arranged as a
// 4-row triangle (1 + 2 + 3 + 4 = 10 pins), rendered back row first so it
// reads like a deck viewed straight down the lane.
// ---------------------------------------------------------------------------

const PIN_ROWS = [4, 3, 2, 1];

interface PinLayout {
  index: number;
  row: number;
  /** Lateral offset within the triangle, in "pin units" (~one pin-width +
   * gap apart), centered on 0 so the rack is symmetric left-to-right. */
  x: number;
}

const PIN_LAYOUT: PinLayout[] = (() => {
  const layout: PinLayout[] = [];
  let index = 0;
  for (let row = 0; row < PIN_ROWS.length; row++) {
    const rowSize = PIN_ROWS[row];
    for (let col = 0; col < rowSize; col++) {
      layout.push({ index, row, x: col - (rowSize - 1) / 2 });
      index++;
    }
  }
  return layout;
})();

function freshRack(): Set<number> {
  return new Set(PIN_LAYOUT.map((p) => p.index));
}

// Maps the phone's aim offset (ox, ~1.0 unit = a full lane-width/90-degree
// tilt) onto the same "pin unit" space as PIN_LAYOUT.
const OX_TO_PIN_SCALE = 2.4;
// Standing position and aim-angle offsets are both clamped to +-1 (same unit
// space as ox); these scales keep both influences visible at the pin deck
// without letting either swamp the phone-tilt aim entirely.
const STANDING_OFFSET_TO_PIN_SCALE = 0.9;
const AIM_ANGLE_TO_PIN_SCALE = 1.3;
// How far (in pin units) a full wrist-snap spin can curve the ball's path by
// the time it reaches the pins.
const CURVE_STRENGTH = 1.5;
// Beyond this lateral offset the ball is already in the gutter before it
// ever reaches the deck -- no pins fall regardless of hit radius.
const GUTTER_X = 2.0;
// Hit radius (pin units) scales with swing power: a weak or glancing shot
// only clips pins right around the impact point; a full-power, well-aimed
// shot can sweep the whole rack for a strike.
const MIN_HIT_RADIUS = 0.55;
const MAX_HIT_RADIUS = 1.9;

// D-pad Left/Right nudges standingOffset or aimAngleOffset (whichever mode
// is active) at this rate, in units/sec, while held; both clamp to +-1.
const NUDGE_PER_SEC = 1.4;
const MAX_LATERAL_OFFSET = 1;

interface GammaSample {
  t: number;
  gamma: number;
}

// Look this far back into the gamma buffer to estimate "how fast and which
// way the wrist was rolling at release" -- 150ms approximates the last flick
// of the wrist just before letting go, without being so short it's dominated
// by single-sample noise.
const GAMMA_LOOKBACK_MS = 150;
// The buffer only needs to cover slightly more than the lookback window.
const GAMMA_BUFFER_MAX_MS = 400;
// Rotation rate (degrees/ms) that counts as a "full" wrist snap, mapped to
// spin = +-1. Unvalidated against a real device -- like the swing tuning
// above, adjust after live playtesting.
const GAMMA_VELOCITY_FOR_MAX_SPIN = 0.35;

/**
 * Approximates "wrist twist at release" from recent `gamma` (device roll)
 * readings. The raw gyroscope `rotationRate` isn't forwarded over the wire --
 * MotionSample only carries orientation (alpha/beta/gamma) and acceleration
 * (ax/ay/az) -- so instead we keep a short rolling buffer of {t, gamma}
 * motion samples and, at release time, compare the oldest sample still
 * within GAMMA_LOOKBACK_MS of the latest one to the latest sample itself.
 * The resulting angular velocity is a reasonable, honest stand-in for "how
 * fast and which direction the wrist was rolling right as the ball
 * released."
 */
function computeSpin(buffer: GammaSample[]): number {
  if (buffer.length < 2) return 0;
  const latest = buffer[buffer.length - 1];
  const past = buffer.find((s) => latest.t - s.t <= GAMMA_LOOKBACK_MS) ?? buffer[0];
  const deltaT = latest.t - past.t;
  if (deltaT <= 0) return 0;

  const angularVelocity = (latest.gamma - past.gamma) / deltaT;
  return Math.min(1, Math.max(-1, angularVelocity / GAMMA_VELOCITY_FOR_MAX_SPIN));
}

interface RollOutcome {
  pins: number;
  knocked: Set<number>;
  /** Final lateral position of the ball at the pin deck, in pin units. */
  impactX: number;
  /** The aim-only component of impactX (tilt + stance + angle), before
   * curve -- the ball's visual animation lands here at t=0 and drifts to
   * impactX by t=1, matching the pins exactly. */
  aimComponent: number;
  /** Lateral drift from curve alone (spin * CURVE_STRENGTH), in pin units. */
  curveAtPins: number;
  radius: number;
  power: number;
  spin: number;
  isGutter: boolean;
  isSplit: boolean;
}

/**
 * Combines swing power, aim (phone tilt + stance + aim angle), and
 * wrist-spin-at-release into where the ball ends up at the pin deck, then
 * knocks down every currently-standing pin within a power-scaled radius of
 * that impact point. Only pins in `standing` can be knocked -- pins already
 * down from an earlier throw this frame stay down and can't be "hit" again.
 *
 * Simplification: real pin-deck physics (deflection, pins knocking down
 * other pins, which exact pins survive a ricochet) isn't modeled -- a single
 * impact point + radius is a reasonable stand-in that still produces
 * strikes, gutters, and the occasional split from natural geometry (a narrow
 * hit width landing between pin clusters), without simulating collisions.
 */
function computeOutcome(
  power: number,
  aimOx: number,
  spin: number,
  standingOffset: number,
  aimAngleOffset: number,
  standing: Set<number>,
): RollOutcome {
  const aimComponent = aimOx * OX_TO_PIN_SCALE + standingOffset * STANDING_OFFSET_TO_PIN_SCALE + aimAngleOffset * AIM_ANGLE_TO_PIN_SCALE;
  const curveAtPins = spin * CURVE_STRENGTH;
  const impactX = aimComponent + curveAtPins;
  const radius = MIN_HIT_RADIUS + power * (MAX_HIT_RADIUS - MIN_HIT_RADIUS);

  const isGutter = Math.abs(impactX) > GUTTER_X;
  const knocked = new Set<number>();
  if (!isGutter) {
    for (const pin of PIN_LAYOUT) {
      if (!standing.has(pin.index)) continue;
      if (Math.abs(pin.x - impactX) <= radius) knocked.add(pin.index);
    }
  }

  const standingAfterXs = PIN_LAYOUT.filter((p) => standing.has(p.index) && !knocked.has(p.index)).map((p) => p.x);
  // Simplified split detection (see doc comment above): flag it as a split
  // whenever a handful of pins remain but they're spread wider than the
  // ball's own hit width, i.e. isolated on both sides of the impact rather
  // than a clustered near-miss.
  const isSplit =
    !isGutter &&
    knocked.size > 0 &&
    standingAfterXs.length > 0 &&
    standingAfterXs.length <= 4 &&
    Math.max(...standingAfterXs) - Math.min(...standingAfterXs) > radius * 2;

  return { pins: knocked.size, knocked, impactX, aimComponent, curveAtPins, radius, power, spin, isGutter, isSplit };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Scoring engine -- standard 10-frame algorithm, verified against an
// all-strikes 300 game and a no-strikes-no-spares (sum of all rolls) game.
// The `?? 0` guards let this run incrementally mid-game, before all bonus
// rolls exist yet, for a live running total; recomputed from scratch on
// every roll since it's cheap.
// ---------------------------------------------------------------------------

function scoreGame(rolls: number[]): number {
  let score = 0;
  let i = 0;
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    if (rolls[i] === 10) {
      // strike
      score += 10 + (rolls[i + 1] ?? 0) + (rolls[i + 2] ?? 0);
      i += 1;
    } else if ((rolls[i] ?? 0) + (rolls[i + 1] ?? 0) === 10) {
      // spare
      score += 10 + (rolls[i + 2] ?? 0);
      i += 2;
    } else {
      score += (rolls[i] ?? 0) + (rolls[i + 1] ?? 0);
      i += 2;
    }
  }
  return score;
}

/** Same walk as scoreGame, but returns the running cumulative total after
 * each of the 10 frames (provisional for a frame whose bonus rolls haven't
 * landed yet -- it'll bump once they do, matching how a real scoresheet
 * fills in). */
function scoreGameFrames(rolls: number[]): number[] {
  const totals: number[] = [];
  let score = 0;
  let i = 0;
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    if (rolls[i] === 10) {
      score += 10 + (rolls[i + 1] ?? 0) + (rolls[i + 2] ?? 0);
      i += 1;
    } else if ((rolls[i] ?? 0) + (rolls[i + 1] ?? 0) === 10) {
      score += 10 + (rolls[i + 2] ?? 0);
      i += 2;
    } else {
      score += (rolls[i] ?? 0) + (rolls[i + 1] ?? 0);
      i += 2;
    }
    totals.push(score);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Frame progression -- how many throws happen per frame, and whether the
// next throw starts from a fresh rack or the pins left standing.
// ---------------------------------------------------------------------------

interface AdvanceStep {
  frameIndex: number;
  throwIndex: number;
  /** Whether the throw at (frameIndex, throwIndex) starts against a fresh
   * rack of 10 pins rather than whatever's still standing. */
  fresh: boolean;
}

/** Given the frame just thrown in (0-indexed) and its rolls so far
 * (including the roll that just happened), returns the next throw to take,
 * or "gameover" if the game is complete. */
function advanceFrame(frameIndex: number, frameRolls: number[]): AdvanceStep | "gameover" {
  const throwsTaken = frameRolls.length;

  if (frameIndex < FRAME_COUNT - 1) {
    if (throwsTaken === 1) {
      if (frameRolls[0] === 10) return { frameIndex: frameIndex + 1, throwIndex: 0, fresh: true }; // strike ends the frame
      return { frameIndex, throwIndex: 1, fresh: false }; // second ball, standing pins carry over
    }
    return { frameIndex: frameIndex + 1, throwIndex: 0, fresh: true }; // frame always ends after throw 2
  }

  // 10th frame.
  if (throwsTaken === 1) {
    return { frameIndex, throwIndex: 1, fresh: frameRolls[0] === 10 };
  }
  if (throwsTaken === 2) {
    const strikeStart = frameRolls[0] === 10;
    const spare = !strikeStart && frameRolls[0] + frameRolls[1] === 10;
    // A bonus 3rd ball happens after a strike or a spare, always on a fresh
    // rack -- the strike/spare bonus rolls never inherit standing pins.
    if (strikeStart || spare) return { frameIndex, throwIndex: 2, fresh: true };
    return "gameover";
  }
  return "gameover"; // 3 throws taken in the 10th frame -- that was the last ball of the game
}

// ---------------------------------------------------------------------------
// Scoreboard display notation -- "X" for a strike, "/" for a spare, "-" for
// zero pins, otherwise the pin count.
// ---------------------------------------------------------------------------

function displayPins(n: number): string {
  return n === 0 ? "-" : String(n);
}

/** The 10th frame can hold up to 3 throws with its own fresh-rack-per-bonus
 * rules, so its notation is worked out separately from frames 1-9: a strike
 * or spare pairing is checked against whichever throws share a rack, the
 * same way a real scoresheet reads the 10th frame's bonus balls as their own
 * mini sequence. */
function tenthFrameSymbols(rolls: number[]): string[] {
  const out: string[] = [];
  if (rolls.length === 0) return out;

  out.push(rolls[0] === 10 ? "X" : displayPins(rolls[0]));
  if (rolls.length === 1) return out;

  if (rolls[0] === 10) {
    // Fresh rack for ball 2 -- stands as the first ball of its own mini-frame.
    out.push(rolls[1] === 10 ? "X" : displayPins(rolls[1]));
  } else {
    out.push(rolls[0] + rolls[1] === 10 ? "/" : displayPins(rolls[1]));
  }
  if (rolls.length === 2) return out;

  if (rolls[0] === 10 && rolls[1] !== 10) {
    // Ball 3 completes ball 2's mini-frame -- check it for a spare too.
    if (rolls[1] + rolls[2] === 10) out.push("/");
    else out.push(rolls[2] === 10 ? "X" : displayPins(rolls[2]));
  } else {
    out.push(rolls[2] === 10 ? "X" : displayPins(rolls[2]));
  }
  return out;
}

function frameSymbols(frameIndex: number, rolls: number[]): string[] {
  if (frameIndex === FRAME_COUNT - 1) return tenthFrameSymbols(rolls);
  if (rolls.length === 0) return [];
  if (rolls[0] === 10) return ["X"];
  if (rolls.length === 1) return [displayPins(rolls[0])];
  if (rolls[0] + rolls[1] === 10) return [displayPins(rolls[0]), "/"];
  return [displayPins(rolls[0]), displayPins(rolls[1])];
}

export function Bowling({ subscribe, onExit, mii, lane }: GameProps) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [swingPhase, setSwingPhase] = useState<SwingPhase>("idle");
  const [frameIndex, setFrameIndex] = useState(0);
  const [throwIndex, setThrowIndex] = useState(0);
  const [frames, setFrames] = useState<number[][]>(() => Array.from({ length: FRAME_COUNT }, () => []));
  const [downPins, setDownPins] = useState<Set<number>>(new Set());
  const [lastOutcome, setLastOutcome] = useState<RollOutcome | null>(null);
  const [positionMode, setPositionMode] = useState<PositionMode>("position");
  const [standingOffset, setStandingOffset] = useState(0);
  const [aimAngleOffset, setAimAngleOffset] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  // Refs mirroring the state above for synchronous reads inside message
  // handlers and rAF/timeout callbacks (same pattern as the original file's
  // phaseRef).
  const phaseRef = useRef<Phase>("ready");
  phaseRef.current = phase;
  const frameIndexRef = useRef(0);
  frameIndexRef.current = frameIndex;
  const throwIndexRef = useRef(0);
  throwIndexRef.current = throwIndex;
  const framesRef = useRef<number[][]>(frames);
  framesRef.current = frames;
  const positionModeRef = useRef<PositionMode>("position");
  positionModeRef.current = positionMode;
  const standingOffsetRef = useRef(0);
  standingOffsetRef.current = standingOffset;
  const aimAngleOffsetRef = useRef(0);
  aimAngleOffsetRef.current = aimAngleOffset;

  const oxRef = useRef(0);
  const gammaBufferRef = useRef<GammaSample[]>([]);
  const standingPinsRef = useRef<Set<number>>(freshRack());
  const pinFallStylesRef = useRef<Record<number, CSSProperties>>({});
  const throwCounterRef = useRef(0);

  // D-pad held state (Left/Right drive the continuous position/angle nudge
  // loop below; Up drives zoom).
  const leftHeldRef = useRef(false);
  const rightHeldRef = useRef(false);

  // Swing/release state machine refs.
  const swingPhaseRef = useRef<SwingPhase>("idle");
  const prevBetaSampleRef = useRef<{ t: number; beta: number } | null>(null);
  const sustainCountRef = useRef(0);
  const sustainSignRef = useRef(0);
  const backswingSignRef = useRef(1);
  const forwardPeakVelocityRef = useRef(0);
  const betaAtForwardStartRef = useRef(0);
  const swingSafetyTimeoutRef = useRef<number | null>(null);

  const ballElRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const positionRafRef = useRef<number | null>(null);
  const rollingTimeoutRef = useRef<number | null>(null);
  const resultTimeoutRef = useRef<number | null>(null);
  const finalTimeoutRef = useRef<number | null>(null);

  const clearSwingSafetyTimeout = useCallback(() => {
    if (swingSafetyTimeoutRef.current !== null) {
      window.clearTimeout(swingSafetyTimeoutRef.current);
      swingSafetyTimeoutRef.current = null;
    }
  }, []);

  const resetSwing = useCallback(() => {
    swingPhaseRef.current = "idle";
    sustainCountRef.current = 0;
    sustainSignRef.current = 0;
    forwardPeakVelocityRef.current = 0;
    setSwingPhase("idle");
  }, []);

  const armSwingSafetyTimeout = useCallback(() => {
    clearSwingSafetyTimeout();
    swingSafetyTimeoutRef.current = window.setTimeout(() => {
      swingSafetyTimeoutRef.current = null;
      resetSwing();
    }, SWING_SAFETY_TIMEOUT_MS);
  }, [clearSwingSafetyTimeout, resetSwing]);

  // Drives the ball's curved travel from the bowler's end to the pin deck
  // via CSS custom properties on the ball element directly (rAF loop,
  // no per-frame React state) -- purely visual, independent of the phase
  // timers below which still own the actual state transitions.
  const animateRoll = useCallback((aimComponent: number, curveAtPins: number, durationMs: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Curve accumulates the further the ball travels -- quadratic easing
      // keeps the path relatively straight near the bowler and bends more
      // sharply as it nears the pins, like a real hook shot.
      const curve = curveAtPins * t * t;
      const el = ballElRef.current;
      if (el) {
        el.style.setProperty("--ball-x", (aimComponent + curve).toFixed(3));
        el.style.setProperty("--ball-y", t.toFixed(3));
      }
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const releaseBall = useCallback(
    (power: number, spin: number) => {
      if (phaseRef.current !== "ready") return;

      const aimOx = oxRef.current;
      const thisFrame = frameIndexRef.current;
      const outcome = computeOutcome(power, aimOx, spin, standingOffsetRef.current, aimAngleOffsetRef.current, standingPinsRef.current);

      setPhase("rolling");
      setZoomed(false);
      animateRoll(outcome.aimComponent, outcome.curveAtPins, ROLLING_DURATION_MS);

      rollingTimeoutRef.current = window.setTimeout(() => {
        // Merge this throw's knockdowns into the pins already down this
        // frame, and remember each newly-knocked pin's fall style so it
        // stays consistent across re-renders without replaying the drop.
        const nextDown = new Set(downPinsRef.current);
        for (const idx of outcome.knocked) {
          nextDown.add(idx);
          if (!pinFallStylesRef.current[idx]) {
            const pinX = PIN_LAYOUT[idx].x;
            const delayMs = Math.min(260, Math.abs(pinX - outcome.impactX) * 90);
            const fallDir = pinX >= outcome.impactX ? 1 : -1;
            pinFallStylesRef.current[idx] = {
              "--bowling-pin-fall-delay": `${delayMs.toFixed(0)}ms`,
              "--bowling-pin-fall-x": `${fallDir * 16}px`,
            } as CSSProperties;
          }
        }
        downPinsRef.current = nextDown;
        setDownPins(nextDown);
        standingPinsRef.current = new Set([...standingPinsRef.current].filter((i) => !outcome.knocked.has(i)));

        const newFrameRolls = [...framesRef.current[thisFrame], outcome.pins];
        const nextFrames = framesRef.current.map((f, i) => (i === thisFrame ? newFrameRolls : f));
        framesRef.current = nextFrames;
        setFrames(nextFrames);

        setLastOutcome(outcome);
        setPhase("result");
        throwCounterRef.current += 1;
        if (outcome.pins === 10) playLaunchChime();

        resultTimeoutRef.current = window.setTimeout(() => {
          const step = advanceFrame(thisFrame, newFrameRolls);
          if (step === "gameover") {
            setPhase("gameover");
          } else {
            if (step.fresh) {
              standingPinsRef.current = freshRack();
              pinFallStylesRef.current = {};
              downPinsRef.current = new Set();
              setDownPins(new Set());
            }
            frameIndexRef.current = step.frameIndex;
            throwIndexRef.current = step.throwIndex;
            setFrameIndex(step.frameIndex);
            setThrowIndex(step.throwIndex);
            setPhase("ready");
          }
        }, RESULT_DURATION_MS);
      }, ROLLING_DURATION_MS);
    },
    [animateRoll],
  );

  // downPinsRef mirrors downPins for synchronous reads inside releaseBall.
  const downPinsRef = useRef<Set<number>>(new Set());
  downPinsRef.current = downPins;

  // Reads beta (pitch) continuously to drive the backswing -> forward ->
  // release state machine described at the top of the file. Only runs while
  // waiting for a throw ("ready") so a stray motion sample during the roll
  // animation or a result screen can't queue up an extra release.
  const processSwingSample = useCallback(
    (t: number, beta: number) => {
      if (phaseRef.current !== "ready") return;

      const prev = prevBetaSampleRef.current;
      prevBetaSampleRef.current = { t, beta };
      if (!prev) return;
      const dt = t - prev.t;
      // Guard against a zero/negative gap (duplicate timestamp) and a large
      // gap (a pause in samples) producing a bogus velocity spike.
      if (dt <= 0 || dt > 250) return;
      const velocity = ((beta - prev.beta) / dt) * 1000; // deg/sec

      const phaseNow = swingPhaseRef.current;

      if (phaseNow === "idle") {
        const sign = Math.sign(velocity);
        if (sign !== 0 && Math.abs(velocity) >= BACKSWING_VELOCITY_THRESHOLD_DPS) {
          if (sustainSignRef.current === sign) sustainCountRef.current += 1;
          else {
            sustainSignRef.current = sign;
            sustainCountRef.current = 1;
          }
          if (sustainCountRef.current >= BACKSWING_SUSTAIN_SAMPLES) {
            backswingSignRef.current = sign;
            swingPhaseRef.current = "backswing";
            sustainCountRef.current = 0;
            sustainSignRef.current = 0;
            setSwingPhase("backswing");
            armSwingSafetyTimeout();
          }
        } else {
          sustainCountRef.current = 0;
          sustainSignRef.current = 0;
        }
        return;
      }

      if (phaseNow === "backswing") {
        const forwardSign = -backswingSignRef.current;
        const sign = Math.sign(velocity);
        if (sign === forwardSign && Math.abs(velocity) >= BACKSWING_VELOCITY_THRESHOLD_DPS) {
          sustainCountRef.current += 1;
          if (sustainCountRef.current >= BACKSWING_SUSTAIN_SAMPLES) {
            swingPhaseRef.current = "forward";
            sustainCountRef.current = 0;
            betaAtForwardStartRef.current = beta;
            forwardPeakVelocityRef.current = 0;
            setSwingPhase("forward");
            // Starting the forward swing snaps the pre-throw zoom back out.
            setZoomed(false);
          }
        } else {
          sustainCountRef.current = 0;
        }
        return;
      }

      // phaseNow === "forward"
      const forwardSign = -backswingSignRef.current;
      const forwardVelocity = velocity * forwardSign;
      if (forwardVelocity > forwardPeakVelocityRef.current) forwardPeakVelocityRef.current = forwardVelocity;

      const traveled = (beta - betaAtForwardStartRef.current) * forwardSign;
      if (traveled >= RELEASE_BETA_DELTA_DEG) {
        clearSwingSafetyTimeout();
        const power = clamp(forwardPeakVelocityRef.current / MAX_FORWARD_BETA_VELOCITY_DPS, 0, 1);
        const spin = computeSpin(gammaBufferRef.current);
        resetSwing();
        releaseBall(power, spin);
      }
    },
    [armSwingSafetyTimeout, clearSwingSafetyTimeout, resetSwing, releaseBall],
  );

  // Single subscription for everything the phone sends: aim (pointer),
  // orientation/gamma (motion, feeding both the swing state machine and the
  // spin buffer), and buttons (D-pad position/angle/zoom).
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "pointer") {
        oxRef.current = msg.ox;
      } else if (msg.type === "motion") {
        const sample: MotionSample = msg.sample;
        if (sample.gamma !== null) {
          const buf = gammaBufferRef.current;
          buf.push({ t: sample.t, gamma: sample.gamma });
          while (buf.length > 0 && sample.t - buf[0].t > GAMMA_BUFFER_MAX_MS) buf.shift();
        }
        if (sample.beta !== null) processSwingSample(sample.t, sample.beta);
      } else if (msg.type === "button") {
        if (msg.button === "LEFT") {
          leftHeldRef.current = msg.state === "down";
        } else if (msg.button === "RIGHT") {
          rightHeldRef.current = msg.state === "down";
        } else if (msg.button === "UP") {
          setZoomed(msg.state === "down" && phaseRef.current === "ready");
        } else if (msg.button === "DOWN" && msg.state === "down") {
          setPositionMode((m) => (m === "position" ? "angle" : "position"));
        }
      }
    });
  }, [subscribe, processSwingSample]);

  // Continuous D-pad Left/Right nudge loop for stance/aim-angle, running the
  // whole time the component is mounted but only applying while a held
  // direction is active and the player is waiting to throw.
  useEffect(() => {
    let lastT = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastT) / 1000;
      lastT = now;
      if (phaseRef.current === "ready" && (leftHeldRef.current || rightHeldRef.current)) {
        const dir = (rightHeldRef.current ? 1 : 0) - (leftHeldRef.current ? 1 : 0);
        if (dir !== 0) {
          const nudge = dir * NUDGE_PER_SEC * dt;
          if (positionModeRef.current === "position") {
            setStandingOffset((v) => clamp(v + nudge, -MAX_LATERAL_OFFSET, MAX_LATERAL_OFFSET));
          } else {
            setAimAngleOffset((v) => clamp(v + nudge, -MAX_LATERAL_OFFSET, MAX_LATERAL_OFFSET));
          }
        }
      }
      positionRafRef.current = requestAnimationFrame(tick);
    };
    positionRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (positionRafRef.current !== null) cancelAnimationFrame(positionRafRef.current);
    };
  }, []);

  // Once the final tally is up, hold it briefly then hand control back to
  // the Wii Menu automatically.
  useEffect(() => {
    if (phase !== "gameover") return;
    finalTimeoutRef.current = window.setTimeout(() => onExit(), FINAL_DURATION_MS);
    return () => {
      if (finalTimeoutRef.current !== null) window.clearTimeout(finalTimeoutRef.current);
    };
  }, [phase, onExit]);

  // Clear every timer/animation frame this component owns on unmount, so an
  // early HOME-exit mid-roll can't leak a pending setState or rAF callback.
  useEffect(() => {
    return () => {
      if (rollingTimeoutRef.current !== null) window.clearTimeout(rollingTimeoutRef.current);
      if (resultTimeoutRef.current !== null) window.clearTimeout(resultTimeoutRef.current);
      if (finalTimeoutRef.current !== null) window.clearTimeout(finalTimeoutRef.current);
      if (swingSafetyTimeoutRef.current !== null) window.clearTimeout(swingSafetyTimeoutRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (positionRafRef.current !== null) cancelAnimationFrame(positionRafRef.current);
    };
  }, []);

  const flatRolls = frames.flat();
  const total = scoreGame(flatRolls);
  const frameTotals = scoreGameFrames(flatRolls);
  const ballVisible = phase === "rolling" || phase === "result";

  const currentFrameRolls = frames[frameIndex] ?? [];
  const lastPins = lastOutcome?.pins ?? 0;
  const isStrikeBall = phase === "result" && lastPins === 10;
  const priorRoll = currentFrameRolls.length >= 2 ? currentFrameRolls[currentFrameRolls.length - 2] : null;
  const isSpare = phase === "result" && !isStrikeBall && priorRoll !== null && priorRoll !== 10 && priorRoll + lastPins === 10;

  let statusText: string;
  if (phase === "ready") {
    if (swingPhase === "backswing") statusText = "Backswing…";
    else if (swingPhase === "forward") statusText = "Swing!";
    else statusText = `Frame ${frameIndex + 1} · Ball ${throwIndex + 1}`;
  } else if (phase === "rolling") {
    statusText = "Rolling!";
  } else if (phase === "result") {
    if (isStrikeBall) statusText = "STRIKE!";
    else if (lastOutcome?.isGutter) statusText = "GUTTER!";
    else if (isSpare) statusText = "SPARE!";
    else if (lastOutcome?.isSplit) statusText = `Split! ${lastPins} pin${lastPins === 1 ? "" : "s"}`;
    else statusText = `${lastPins} pin${lastPins === 1 ? "" : "s"}!`;
  } else {
    statusText = "Game over!";
  }

  const bowlerStyle = { "--bowling-standing-shift": `${(standingOffset * 26).toFixed(1)}px` } as CSSProperties;
  const arrowStyle = { "--bowling-arrow-rotate": `${(aimAngleOffset * 18).toFixed(1)}deg` } as CSSProperties;

  return (
    <div className="bowling-root">
      <div className="bowling-frames">
        {frames.map((rolls, i) => {
          const symbols = frameSymbols(i, rolls);
          return (
            <div key={i} className={`bowling-frame${i === frameIndex && phase !== "gameover" ? " bowling-frame-current" : ""}`}>
              <div className="bowling-frame-number">{i + 1}</div>
              <div className="bowling-frame-throws">
                {symbols.map((s, si) => (
                  <span className="bowling-frame-throw" key={si}>
                    {s}
                  </span>
                ))}
              </div>
              <div className="bowling-frame-total">{rolls.length > 0 ? frameTotals[i] : ""}</div>
            </div>
          );
        })}
      </div>

      {lane !== undefined && <div className="bowling-lane-label">Lane {lane}</div>}

      <div className="bowling-controls-status">
        <span className={`bowling-mode-pill${positionMode === "position" ? " bowling-mode-active" : ""}`}>Stance</span>
        <span className={`bowling-mode-pill${positionMode === "angle" ? " bowling-mode-active" : ""}`}>Angle</span>
        {zoomed && <span className="bowling-zoom-pill">Zoom</span>}
      </div>

      <div className="bowling-lane">
        <div className="bowling-track">
          <div className={`bowling-pin-zoom-wrap${zoomed ? " bowling-zoomed" : ""}`}>
            <div className={`bowling-pins${isStrikeBall ? " bowling-pins-strike" : ""}`}>
              {PIN_ROWS.map((rowSize, rowIndex) => {
                const startIndex = PIN_ROWS.slice(0, rowIndex).reduce((a, b) => a + b, 0);
                // Rows get very slightly smaller toward the far end of the
                // deck, a cheap perspective cue paired with the lane's
                // rotateX tilt below.
                const rowStyle = { "--bowling-row-scale": (1 - rowIndex * 0.06).toFixed(2) } as CSSProperties;
                return (
                  <div className="bowling-pin-row" key={rowIndex} style={rowStyle}>
                    {Array.from({ length: rowSize }).map((_, i) => {
                      const pinIndex = startIndex + i;
                      const knocked = downPins.has(pinIndex);
                      const pinStyle = knocked ? pinFallStylesRef.current[pinIndex] : undefined;
                      return (
                        <div
                          key={pinIndex}
                          className={`bowling-pin${knocked ? " bowling-pin-knocked" : ""}`}
                          style={pinStyle}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bowling-arrow" aria-hidden="true" style={arrowStyle} />
          <div ref={ballElRef} className={`bowling-ball${ballVisible ? " bowling-ball-visible" : ""}`} aria-hidden="true" />
        </div>
        <div className="bowling-bowler" style={bowlerStyle}>
          <MiiAvatar
            key={throwCounterRef.current}
            mii={mii}
            size={100}
            pose={phase === "rolling" ? "bowl-swing" : "idle"}
          />
        </div>
      </div>

      <div className={`bowling-result${phase === "result" && isStrikeBall ? " bowling-result-strike" : ""}`}>
        {phase === "gameover" ? (
          <div className="bowling-final">
            <div className="bowling-final-label">Final score</div>
            <div className="bowling-final-score">{total}</div>
          </div>
        ) : (
          <div className="bowling-status">{statusText}</div>
        )}
      </div>

      <div className="bowling-hint">
        D-Pad: Left/Right to move or aim (Down toggles), Up to zoom · Swing forward to bowl, twist wrist to curve · HOME to exit
      </div>
    </div>
  );
}
