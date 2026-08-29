import { useCallback, useEffect, useRef, useState } from "react";
import "./bowling.css";
import type { GameProps } from "./types";
import { useSwing } from "./useSwing";

// First-pass swing-detection tuning, unvalidated against a real device yet --
// adjust after live playtesting. threshold is m/s^2 of linear acceleration,
// cooldownMs is the minimum gap between two swings.
const SWING_THRESHOLD = 14;
const SWING_COOLDOWN_MS = 450;

// A swing at or above this peak magnitude (m/s^2, gravity removed) counts as
// "full power" and maps to the max base pin count; anything above just caps.
const MAX_SWING_MAGNITUDE = 25;

const TOTAL_ROLLS = 6;

// How long each phase's beat lasts, in ms.
const ROLLING_DURATION_MS = 700;
const RESULT_DURATION_MS = 1800;
const FINAL_DURATION_MS = 3000;

type Phase = "ready" | "rolling" | "result" | "final";

// Pins arranged as a 4-row triangle (1 + 2 + 3 + 4 = 10 pins), rendered back
// row first so it reads like a deck viewed straight down the lane.
const PIN_ROWS = [4, 3, 2, 1];

interface RollRecord {
  roll: number;
  pins: number;
}

/**
 * Combines swing power and aim accuracy into a 0-10 pin count for one roll.
 *
 * Power: harder swings knock down more pins, scaled linearly from 0 up to
 * MAX_SWING_MAGNITUDE onto a 0-10 base pin count, then capped.
 *
 * Accuracy: a swing thrown while pointing straight down the lane (ox ~ 0)
 * keeps the full base pin count. The further off-center the aim, the more
 * of that count is lost to the gutter -- linearly down to 0 pins once |ox|
 * reaches (roughly) a full lane-width tilt.
 */
function computePins(peakMagnitude: number, ox: number): number {
  const power = Math.min(peakMagnitude / MAX_SWING_MAGNITUDE, 1);
  const basePins = Math.round(power * 10);

  const accuracy = Math.max(0, 1 - Math.abs(ox));
  const pins = Math.round(basePins * accuracy);

  return Math.min(10, Math.max(0, pins));
}

export function Bowling({ subscribe, onExit }: GameProps) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [rolls, setRolls] = useState<RollRecord[]>([]);
  const [lastPins, setLastPins] = useState<number | null>(null);
  const [knockedCount, setKnockedCount] = useState(0);

  const phaseRef = useRef<Phase>("ready");
  phaseRef.current = phase;

  const oxRef = useRef(0);
  const rollCountRef = useRef(0);

  // Track the phone's most recent aim offset continuously; read it at the
  // moment a swing is detected rather than subscribing separately per-roll.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "pointer") {
        oxRef.current = msg.ox;
      }
    });
  }, [subscribe]);

  const onSwing = useCallback((peakMagnitude: number) => {
    // Ignore swings that land outside the "ready" window (mid-animation,
    // showing a result, or the final screen) so one big motion can't queue
    // up multiple rolls.
    if (phaseRef.current !== "ready") return;

    const pins = computePins(peakMagnitude, oxRef.current);
    setPhase("rolling");

    window.setTimeout(() => {
      setLastPins(pins);
      setKnockedCount(pins);
      setPhase("result");
      rollCountRef.current += 1;
      const rollNumber = rollCountRef.current;
      setRolls((prev) => [...prev, { roll: rollNumber, pins }]);

      window.setTimeout(() => {
        if (rollNumber >= TOTAL_ROLLS) {
          setPhase("final");
        } else {
          setKnockedCount(0);
          setPhase("ready");
        }
      }, RESULT_DURATION_MS);
    }, ROLLING_DURATION_MS);
  }, []);

  useSwing(subscribe, onSwing, { threshold: SWING_THRESHOLD, cooldownMs: SWING_COOLDOWN_MS });

  // Once the final tally is up, hold it briefly then hand control back to
  // the Wii Menu automatically.
  useEffect(() => {
    if (phase !== "final") return;
    const timer = window.setTimeout(() => onExit(), FINAL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [phase, onExit]);

  const total = rolls.reduce((sum, r) => sum + r.pins, 0);
  const currentRoll = Math.min(rollCountRef.current + 1, TOTAL_ROLLS);
  const isStrike = lastPins === 10;

  let statusText: string;
  if (phase === "ready") statusText = "Ready to roll…";
  else if (phase === "rolling") statusText = "Rolling!";
  else if (phase === "result") statusText = isStrike ? "STRIKE!" : `${lastPins} pin${lastPins === 1 ? "" : "s"}!`;
  else statusText = "Game over!";

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
        <div className={`bowling-pins${isStrike && phase === "result" ? " bowling-pins-strike" : ""}`}>
          {PIN_ROWS.map((rowSize, rowIndex) => {
            const startIndex = PIN_ROWS.slice(0, rowIndex).reduce((a, b) => a + b, 0);
            return (
              <div className="bowling-pin-row" key={rowIndex}>
                {Array.from({ length: rowSize }).map((_, i) => {
                  const pinIndex = startIndex + i;
                  const knocked = pinIndex < knockedCount;
                  return <div key={pinIndex} className={`bowling-pin${knocked ? " bowling-pin-knocked" : ""}`} />;
                })}
              </div>
            );
          })}
        </div>
        <div className="bowling-arrow" aria-hidden="true" />
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

      <div className="bowling-hint">Swing the phone forward to roll · Press HOME anytime to exit</div>
    </div>
  );
}
