import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import "./bowling.css";
import type { GameProps } from "./types";
import { useSwing } from "./useSwing";

// First-pass swing-detection tuning, unvalidated against a real device yet --
// adjust after live playtesting. threshold is m/s^2 of linear acceleration,
// cooldownMs is the minimum gap between two swings.
const SWING_THRESHOLD = 14;
const SWING_COOLDOWN_MS = 450;

// A swing at or above this peak magnitude (m/s^2, gravity removed) counts as
// "full power" and maps to full swing power (1.0).
const MAX_SWING_MAGNITUDE = 25;

const TOTAL_ROLLS = 6;

// How long each phase's beat lasts, in ms. Rolling was extended from the
// original flat 700ms so the curved ball-roll animation has room to read.
const ROLLING_DURATION_MS = 1100;
const RESULT_DURATION_MS = 1800;
const FINAL_DURATION_MS = 3000;

type Phase = "ready" | "rolling" | "result" | "final";

// Pins arranged as a 4-row triangle (1 + 2 + 3 + 4 = 10 pins), rendered back
// row first so it reads like a deck viewed straight down the lane.
const PIN_ROWS = [4, 3, 2, 1];

interface PinLayout {
  index: number;
  row: number;
  /** Lateral offset within the triangle, in "pin units" (~one pin-width +
   * gap apart), centered on 0 so the rack is symmetric left-to-right. */
  x: number;
}

// Precompute every pin's lateral position once. pinIndex here matches the
// pinIndex the render loop below derives from PIN_ROWS (same row-major
// order), so PIN_LAYOUT[pinIndex] is always the right lookup.
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

// Maps the phone's aim offset (ox, ~1.0 unit = a full lane-width/90-degree
// tilt) onto the same "pin unit" space as PIN_LAYOUT.
const OX_TO_PIN_SCALE = 2.4;
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
 * motion samples and, at swing time, compare the oldest sample still within
 * GAMMA_LOOKBACK_MS of the latest one to the latest sample itself. The
 * resulting angular velocity is a reasonable, honest stand-in for "how fast
 * and which direction the wrist was rolling right as the ball released."
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
  /** Lateral drift from curve alone (spin * CURVE_STRENGTH), in pin units. */
  curveAtPins: number;
  radius: number;
  power: number;
  spin: number;
  isGutter: boolean;
  isSplit: boolean;
}

/**
 * Combines swing power, aim, and wrist-spin-at-release into where the ball
 * ends up at the pin deck, then knocks down every pin within a power-scaled
 * radius of that impact point. This replaces the old "first N pins by index"
 * approach -- the visual knockdown pattern and the scored pin count now
 * always agree, because both come from the same impact geometry.
 *
 * Simplification: real pin-deck physics (deflection, pins knocking down
 * other pins, which exact pins survive a ricochet) isn't modeled -- a single
 * impact point + radius is a reasonable stand-in that still produces
 * strikes, gutters, and the occasional split from natural geometry (a narrow
 * hit width landing between pin clusters), without simulating collisions.
 */
function computeOutcome(peakMagnitude: number, aimOx: number, spin: number): RollOutcome {
  const power = Math.min(Math.max(peakMagnitude / MAX_SWING_MAGNITUDE, 0), 1);
  const curveAtPins = spin * CURVE_STRENGTH;
  const impactX = aimOx * OX_TO_PIN_SCALE + curveAtPins;
  const radius = MIN_HIT_RADIUS + power * (MAX_HIT_RADIUS - MIN_HIT_RADIUS);

  const isGutter = Math.abs(impactX) > GUTTER_X;
  const knocked = new Set<number>();
  if (!isGutter) {
    for (const pin of PIN_LAYOUT) {
      if (Math.abs(pin.x - impactX) <= radius) knocked.add(pin.index);
    }
  }

  const standingXs = PIN_LAYOUT.filter((p) => !knocked.has(p.index)).map((p) => p.x);
  // Simplified split detection (see doc comment above): flag it as a split
  // whenever a handful of pins remain but they're spread wider than the
  // ball's own hit width, i.e. isolated on both sides of the impact rather
  // than a clustered near-miss.
  const isSplit =
    !isGutter &&
    knocked.size > 0 &&
    standingXs.length > 0 &&
    standingXs.length <= 4 &&
    Math.max(...standingXs) - Math.min(...standingXs) > radius * 2;

  return { pins: knocked.size, knocked, impactX, curveAtPins, radius, power, spin, isGutter, isSplit };
}

interface RollRecord {
  roll: number;
  pins: number;
}

export function Bowling({ subscribe, onExit }: GameProps) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [rolls, setRolls] = useState<RollRecord[]>([]);
  const [lastPins, setLastPins] = useState<number | null>(null);
  const [lastImpactX, setLastImpactX] = useState<number | null>(null);
  const [lastIsGutter, setLastIsGutter] = useState(false);
  const [lastIsSplit, setLastIsSplit] = useState(false);
  const [knockedSet, setKnockedSet] = useState<Set<number>>(new Set());

  const phaseRef = useRef<Phase>("ready");
  phaseRef.current = phase;

  const oxRef = useRef(0);
  const gammaBufferRef = useRef<GammaSample[]>([]);
  const rollCountRef = useRef(0);

  const ballElRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const rollingTimeoutRef = useRef<number | null>(null);
  const resultTimeoutRef = useRef<number | null>(null);

  // Track the phone's most recent aim offset and a short rolling window of
  // wrist-roll (gamma) samples continuously; both are read at the moment a
  // swing is detected rather than subscribed separately per-roll.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "pointer") {
        oxRef.current = msg.ox;
      } else if (msg.type === "motion") {
        const { t, gamma } = msg.sample;
        if (gamma === null) return;
        const buf = gammaBufferRef.current;
        buf.push({ t, gamma });
        while (buf.length > 0 && t - buf[0].t > GAMMA_BUFFER_MAX_MS) buf.shift();
      }
    });
  }, [subscribe]);

  // Drives the ball's curved travel from the bowler's end to the pin deck
  // via CSS custom properties on the ball element directly (rAF loop,
  // no per-frame React state) -- purely visual, independent of the phase
  // timers below which still own the actual state transitions.
  const animateRoll = useCallback((aimOx: number, curveAtPins: number, durationMs: number) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const startX = aimOx * OX_TO_PIN_SCALE;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Curve accumulates the further the ball travels -- quadratic easing
      // keeps the path relatively straight near the bowler and bends more
      // sharply as it nears the pins, like a real hook shot.
      const curve = curveAtPins * t * t;
      const el = ballElRef.current;
      if (el) {
        el.style.setProperty("--ball-x", (startX + curve).toFixed(3));
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

  const onSwing = useCallback(
    (peakMagnitude: number) => {
      // Ignore swings that land outside the "ready" window (mid-animation,
      // showing a result, or the final screen) so one big motion can't queue
      // up multiple rolls.
      if (phaseRef.current !== "ready") return;

      const spin = computeSpin(gammaBufferRef.current);
      const aimOx = oxRef.current;
      const outcome = computeOutcome(peakMagnitude, aimOx, spin);

      setPhase("rolling");
      animateRoll(aimOx, outcome.curveAtPins, ROLLING_DURATION_MS);

      rollingTimeoutRef.current = window.setTimeout(() => {
        setLastPins(outcome.pins);
        setLastImpactX(outcome.impactX);
        setLastIsGutter(outcome.isGutter);
        setLastIsSplit(outcome.isSplit);
        setKnockedSet(outcome.knocked);
        setPhase("result");
        rollCountRef.current += 1;
        const rollNumber = rollCountRef.current;
        setRolls((prev) => [...prev, { roll: rollNumber, pins: outcome.pins }]);

        resultTimeoutRef.current = window.setTimeout(() => {
          if (rollNumber >= TOTAL_ROLLS) {
            setPhase("final");
          } else {
            setKnockedSet(new Set());
            setPhase("ready");
          }
        }, RESULT_DURATION_MS);
      }, ROLLING_DURATION_MS);
    },
    [animateRoll],
  );

  useSwing(subscribe, onSwing, { threshold: SWING_THRESHOLD, cooldownMs: SWING_COOLDOWN_MS });

  // Once the final tally is up, hold it briefly then hand control back to
  // the Wii Menu automatically.
  useEffect(() => {
    if (phase !== "final") return;
    const timer = window.setTimeout(() => onExit(), FINAL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onExit]);

  // Clear every timer/animation frame this component owns on unmount, so an
  // early HOME-exit mid-roll can't leak a pending setState or rAF callback.
  useEffect(() => {
    return () => {
      if (rollingTimeoutRef.current !== null) window.clearTimeout(rollingTimeoutRef.current);
      if (resultTimeoutRef.current !== null) window.clearTimeout(resultTimeoutRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const total = rolls.reduce((sum, r) => sum + r.pins, 0);
  const currentRoll = Math.min(rollCountRef.current + 1, TOTAL_ROLLS);
  const isStrike = lastPins === 10;
  const ballVisible = phase === "rolling" || phase === "result";

  let statusText: string;
  if (phase === "ready") statusText = "Ready to roll…";
  else if (phase === "rolling") statusText = "Rolling!";
  else if (phase === "result") {
    if (isStrike) statusText = "STRIKE!";
    else if (lastIsGutter) statusText = "GUTTER!";
    else if (lastIsSplit) statusText = `Split! ${lastPins} pin${lastPins === 1 ? "" : "s"}`;
    else statusText = `${lastPins} pin${lastPins === 1 ? "" : "s"}!`;
  } else statusText = "Game over!";

  return (
    <div className="bowling-root">
      <div className="bowling-scoreboard">
        <div className="bowling-scoreboard-item">
          <span className="bowling-scoreboard-label">Roll</span>
          <span className="bowling-scoreboard-value">
            {phase === "final" ? TOTAL_ROLLS : currentRoll} / {TOTAL_ROLLS}
          </span>
        </div>
        <div className="bowling-scoreboard-item">
          <span className="bowling-scoreboard-label">Score</span>
          <span className="bowling-scoreboard-value">{total}</span>
        </div>
      </div>

      <div className="bowling-lane">
        <div className="bowling-track">
          <div className={`bowling-pins${isStrike && phase === "result" ? " bowling-pins-strike" : ""}`}>
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
                    const knocked = knockedSet.has(pinIndex);
                    let pinStyle: CSSProperties | undefined;
                    if (knocked) {
                      const pinX = PIN_LAYOUT[pinIndex].x;
                      const impact = lastImpactX ?? 0;
                      // Stagger each knocked pin's fall by distance from the
                      // impact point, and send it falling away from the
                      // ball, for a cascading rather than instant topple.
                      const delayMs = Math.min(260, Math.abs(pinX - impact) * 90);
                      const fallDir = pinX >= impact ? 1 : -1;
                      pinStyle = {
                        "--bowling-pin-fall-delay": `${delayMs.toFixed(0)}ms`,
                        "--bowling-pin-fall-x": `${fallDir * 16}px`,
                      } as CSSProperties;
                    }
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
          <div className="bowling-arrow" aria-hidden="true" />
          <div ref={ballElRef} className={`bowling-ball${ballVisible ? " bowling-ball-visible" : ""}`} aria-hidden="true" />
        </div>
      </div>

      <div className={`bowling-result${phase === "result" && isStrike ? " bowling-result-strike" : ""}`}>
        {phase === "final" ? (
          <div className="bowling-final">
            <div className="bowling-final-label">Final score</div>
            <div className="bowling-final-score">{total}</div>
          </div>
        ) : (
          <div className="bowling-status">{statusText}</div>
        )}
      </div>

      <div className="bowling-hint">Swing forward to roll · twist your wrist at release to curve it · HOME to exit</div>
    </div>
  );
}
