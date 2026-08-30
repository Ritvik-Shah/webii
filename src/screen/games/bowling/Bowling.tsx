import { useCallback, useEffect, useRef, useState } from "react";
import "./bowling.css";
import type { GameProps } from "../types";
import {
  AIM_LIMIT,
  AIM_RATE,
  AIM_STEP,
  AIM_YAW_GAIN,
  BALL_RADIUS,
  HOLD_REPEAT_DELAY_MS,
  MAX_BALL_SPEED,
  MIN_BALL_SPEED,
  STANCE_LIMIT,
  STANCE_RATE,
  STANCE_STEP,
  SWING_MAX_ACCEL,
  SWING_MIN_ACCEL,
} from "./constants";
import { NEUTRAL_POSE, type BowlerPose } from "./miiBowler";
import {
  countPinsDown,
  createSimulation,
  isSettled,
  standingPinIds,
  step,
  type Simulation,
} from "./physics";
import { createBowlingScene, type BowlingScene, type CameraShot, type SceneView } from "./scene";
import {
  FRAME_COUNT,
  currentScore,
  emptyCard,
  frameTotals,
  rollGlyph,
  rollsRemainingInFrame,
  type Frame,
} from "./score";
import {
  playBlip,
  playGutter,
  playPinCrash,
  playRackReset,
  playSpareFanfare,
  playStrikeFanfare,
  startRoll,
} from "./sound";

// ---------------------------------------------------------------------------
// Timing (seconds)
// ---------------------------------------------------------------------------

const INTRO_DURATION = 1.9;
/** How long the forward swing takes, and how far into it the ball leaves the hand. */
const SWING_DURATION = 0.3;
const RELEASE_AT = 0.17;
/** Full backswing is reached after holding B this long. */
const WIND_DURATION = 0.5;
const SETTLE_PAUSE = 0.6;
const RESULT_DURATION = 2.4;
const STRIKE_RESULT_DURATION = 3.4;
const RESET_DURATION = 2.0;
const FINAL_AUTO_EXIT_MS = 20000;

/** Where down the approach the ball meets the boards. */
const LAUNCH_Z = 0.25;

/** Shoulder angle that holds the ball out in front at chest height. */
const READY_ARM_ANGLE = 0.5;
/** How far the bowling arm is held out to the side in the ready pose. */
const READY_ARM_SPREAD = 0.5;

const ALL_PINS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type Phase = "intro" | "aim" | "wind" | "swing" | "roll" | "settle" | "result" | "reset" | "final";
/** Left/Right either slide the bowler across the approach or rotate them,
 * with A switching between the two -- the real game's aiming scheme. */
type AimMode = "move" | "rotate";
type CameraView = "normal" | "lineup";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Frame-rate independent easing toward a target. */
function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

interface GameState {
  phase: Phase;
  /** Seconds spent in the current phase. */
  timer: number;
  sim: Simulation;
  card: Frame[];
  frameIndex: number;
  standing: number[];
  /** True when the pins in front of this ball are a full, freshly set rack --
   * what separates a strike from a spare, including on the 10th frame's
   * bonus balls, which re-rack after any ball that clears the deck. */
  freshRack: boolean;
  bowlerX: number;
  targetBowlerX: number;
  aimAngle: number;
  /** Which of the two things Left/Right currently adjusts. A toggles it. */
  aimMode: AimMode;
  /** Normal over-the-shoulder view, or the Up-button close-up on the pins. */
  cameraView: CameraView;
  /** -1 / +1 while Left or Right is held, 0 otherwise. */
  heldDir: number;
  /** When the held direction went down, for the tap-then-repeat behaviour. */
  heldSince: number;
  /** Peak linear acceleration seen while B was held, m/s^2. */
  peakAccel: number;
  /** Arm angle at the moment the forward swing started. */
  swingFrom: number;
  sweeper: number;
  pose: BowlerPose;
  shot: CameraShot;
  /** Set once the current roll's pins have been counted into the card. */
  scored: boolean;
  celebrating: "strike" | "spare" | "gutter" | null;
  rollSound: ReturnType<typeof startRoll> | null;
  /** Result banner is applied to React state from inside the loop. */
  bannerShown: string | null;
}

interface Hud {
  card: Frame[];
  frameIndex: number;
  ballNumber: number;
  banner: string | null;
  bannerKind: "strike" | "spare" | "split" | "count" | "gutter" | null;
  phase: Phase;
  aimMode: AimMode;
  cameraView: CameraView;
}

export function Bowling({ send, subscribe, onExit, mii }: GameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BowlingScene | null>(null);

  const [hud, setHud] = useState<Hud>({
    card: emptyCard(),
    frameIndex: 0,
    ballNumber: 1,
    banner: null,
    bannerKind: null,
    phase: "intro",
    aimMode: "move",
    cameraView: "normal",
  });

  const gameRef = useRef<GameState | null>(null);
  if (gameRef.current === null) {
    gameRef.current = {
      phase: "intro",
      timer: 0,
      sim: createSimulation(ALL_PINS),
      card: emptyCard(),
      frameIndex: 0,
      standing: ALL_PINS,
      freshRack: true,
      bowlerX: 0,
      targetBowlerX: 0,
      aimAngle: 0,
      aimMode: "move",
      cameraView: "normal",
      heldDir: 0,
      heldSince: 0,
      peakAccel: 0,
      swingFrom: 0,
      sweeper: 0,
      pose: { ...NEUTRAL_POSE },
      shot: "intro",
      scored: false,
      celebrating: null,
      rollSound: null,
      bannerShown: null,
    };
  }

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const sendRef = useRef(send);
  sendRef.current = send;

  // -------------------------------------------------------------------------
  // Phase transitions
  // -------------------------------------------------------------------------

  const setPhase = useCallback((game: GameState, phase: Phase) => {
    game.phase = phase;
    game.timer = 0;
  }, []);

  const pushHud = useCallback((game: GameState, extra?: Partial<Hud>) => {
    setHud((prev) => ({
      ...prev,
      card: game.card.map((frame) => [...frame]),
      frameIndex: game.frameIndex,
      ballNumber: game.card[game.frameIndex].length + 1,
      phase: game.phase,
      aimMode: game.aimMode,
      cameraView: game.cameraView,
      ...extra,
    }));
  }, []);

  /** Count the roll, update the card, and decide what the banner should say. */
  const scoreRoll = useCallback(
    (game: GameState) => {
      const knocked = countPinsDown(game.sim);
      const frame = game.card[game.frameIndex];
      frame.push(knocked);

      const clearedRack = standingPinIds(game.sim).length === 0;

      let banner: string;
      let bannerKind: Hud["bannerKind"];
      if (clearedRack && game.freshRack) {
        banner = "STRIKE!";
        bannerKind = "strike";
        game.celebrating = "strike";
        playStrikeFanfare();
        sendRef.current({ type: "haptic", pattern: [30, 40, 30, 40, 90] });
      } else if (clearedRack) {
        banner = "SPARE!";
        bannerKind = "spare";
        game.celebrating = "spare";
        playSpareFanfare();
        sendRef.current({ type: "haptic", pattern: [30, 50, 60] });
      } else if (knocked === 0) {
        banner = game.sim.ball.inGutter ? "GUTTER BALL" : "NO PINS";
        bannerKind = "gutter";
        game.celebrating = "gutter";
      } else {
        banner = knocked === 1 ? "1 PIN" : `${knocked} PINS`;
        bannerKind = "count";
        game.celebrating = null;
      }

      game.bannerShown = banner;
      pushHud(game, { banner, bannerKind });
    },
    [pushHud],
  );

  /** Advance to the next ball or frame, and work out what to re-rack. */
  const advanceAfterResult = useCallback(
    (game: GameState) => {
      const remaining = rollsRemainingInFrame(game.card, game.frameIndex);

      if (remaining === 0) {
        if (game.frameIndex === FRAME_COUNT - 1) {
          setPhase(game, "final");
          game.celebrating = null;
          pushHud(game, { banner: null, bannerKind: null });
          return;
        }
        game.frameIndex += 1;
        game.standing = ALL_PINS;
        game.freshRack = true;
      } else {
        // The 10th frame re-racks whenever the previous ball cleared the deck.
        const stillStanding = standingPinIds(game.sim);
        game.freshRack = stillStanding.length === 0;
        game.standing = game.freshRack ? ALL_PINS : stillStanding;
      }

      game.sim = createSimulation(game.standing);
      game.aimAngle = 0;
      game.aimMode = "move";
      game.cameraView = "normal";
      game.heldDir = 0;
      game.peakAccel = 0;
      game.scored = false;
      game.celebrating = null;
      game.bannerShown = null;
      // A fresh rack gets the little intro flourish; a spare attempt goes
      // straight back to aiming so the game doesn't drag.
      setPhase(game, game.standing.length === 10 ? "intro" : "aim");
      game.shot = game.phase === "intro" ? "intro" : "aim";
      sceneRef.current?.cutCamera();
      pushHud(game, { banner: null, bannerKind: null });
    },
    [pushHud, setPhase],
  );

  const releaseBall = useCallback((game: GameState) => {
    const power = clamp(
      lerp(
        MIN_BALL_SPEED,
        MAX_BALL_SPEED,
        (game.peakAccel - SWING_MIN_ACCEL) / (SWING_MAX_ACCEL - SWING_MIN_ACCEL),
      ),
      MIN_BALL_SPEED,
      MAX_BALL_SPEED,
    );

    const ball = game.sim.ball;
    ball.released = true;
    ball.x = game.bowlerX;
    ball.y = BALL_RADIUS;
    ball.z = LAUNCH_Z;
    ball.vx = Math.sin(game.aimAngle) * power;
    ball.vz = -Math.cos(game.aimAngle) * power;

    game.rollSound = startRoll();
    sendRef.current({ type: "haptic", pattern: [45] });
  }, []);

  // -------------------------------------------------------------------------
  // Per-frame pose
  // -------------------------------------------------------------------------

  const updatePose = useCallback((game: GameState, dt: number) => {
    const pose = game.pose;
    const now = performance.now() / 1000;

    if (game.phase === "swing") {
      // The one pose that's driven explicitly rather than damped -- a swing
      // that eases into its target isn't a swing.
      const t = clamp(game.timer / SWING_DURATION, 0, 1);
      pose.armAngle = lerp(game.swingFrom, 1.15, t * t * (3 - 2 * t));
      pose.lean = damp(pose.lean, 0.3, 12, dt);
      // Deep enough that the hand -- and so the ball -- reaches the boards.
      pose.crouch = damp(pose.crouch, 1, 14, dt);
      pose.offArmAngle = damp(pose.offArmAngle, -0.5, 10, dt);
      pose.yaw = damp(pose.yaw, game.aimAngle * AIM_YAW_GAIN, 8, dt);
      pose.headTurn = damp(pose.headTurn, 0, 8, dt);
      pose.headPitch = damp(pose.headPitch, 0, 8, dt);
      // The arm tucks fully in line with the body as it swings through, which
      // is also what puts the hand exactly on the line the ball launches from.
      pose.armSpread = damp(pose.armSpread, 0, 14, dt);
      return;
    }

    // Ready position: both arms out front cradling the ball at chest height,
    // the way a bowler stands before starting the swing.
    let armTarget = READY_ARM_ANGLE;
    let offArmTarget = READY_ARM_ANGLE;
    let leanTarget = 0.07;
    let crouchTarget = 0.12;
    let yawTarget = game.aimAngle * AIM_YAW_GAIN;
    let headTurnTarget = 0;
    let headPitchTarget = 0;
    let spreadTarget = 0.12;
    let lambda = 7;

    switch (game.phase) {
      case "intro":
        // Turned a little toward camera, having a look at the pins.
        yawTarget = 0.34;
        headTurnTarget = -0.5;
        spreadTarget = READY_ARM_SPREAD;
        break;
      case "aim":
        armTarget = READY_ARM_ANGLE + Math.sin(now * 1.9) * 0.05;
        offArmTarget = READY_ARM_ANGLE + Math.sin(now * 1.9) * 0.05;
        spreadTarget = READY_ARM_SPREAD;
        crouchTarget = 0.16;
        break;
      case "wind": {
        const held = clamp(game.timer / WIND_DURATION, 0, 1);
        const eased = held * held * (3 - 2 * held);
        armTarget = lerp(READY_ARM_ANGLE, -2.05, eased);
        offArmTarget = lerp(READY_ARM_ANGLE, 0.55, eased);
        spreadTarget = lerp(READY_ARM_SPREAD, 0, eased);
        leanTarget = 0.05 + 0.2 * eased;
        crouchTarget = 0.16 + 0.5 * eased;
        lambda = 16;
        break;
      }
      case "roll":
      case "settle":
        armTarget = 0.55;
        leanTarget = 0.14;
        crouchTarget = 0.22;
        headPitchTarget = -0.12;
        lambda = 5;
        break;
      case "result":
      case "reset":
      case "final":
        if (game.celebrating === "strike") {
          // Both arms thrown up, with a bounce.
          armTarget = -2.75;
          offArmTarget = -2.75;
          leanTarget = -0.14;
          crouchTarget = 0.18 + Math.sin(now * 9) * 0.18;
          lambda = 11;
        } else if (game.celebrating === "spare") {
          armTarget = -2.1;
          offArmTarget = 0.25;
          leanTarget = -0.04;
          crouchTarget = 0.16;
          lambda = 9;
        } else if (game.celebrating === "gutter") {
          armTarget = 0.1;
          offArmTarget = 0.1;
          leanTarget = 0.42;
          headPitchTarget = -0.5;
          lambda = 5;
        } else {
          armTarget = 0.1;
          leanTarget = 0.08;
        }
        break;
      default:
        break;
    }

    pose.armAngle = damp(pose.armAngle, armTarget, lambda, dt);
    pose.offArmAngle = damp(pose.offArmAngle, offArmTarget, lambda, dt);
    pose.lean = damp(pose.lean, leanTarget, lambda, dt);
    pose.crouch = damp(pose.crouch, crouchTarget, lambda, dt);
    pose.yaw = damp(pose.yaw, yawTarget, 6, dt);
    pose.headTurn = damp(pose.headTurn, headTurnTarget, 5, dt);
    pose.headPitch = damp(pose.headPitch, headPitchTarget, 5, dt);
    pose.armSpread = damp(pose.armSpread, spreadTarget, lambda, dt);
  }, []);

  // -------------------------------------------------------------------------
  // Scene + game loop
  // -------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scene: BowlingScene;
    try {
      scene = createBowlingScene(container, mii);
    } catch {
      // No WebGL available (rare, but a locked-down browser or a headless
      // display can refuse a context). Bail back to the menu rather than
      // leaving a black screen.
      onExitRef.current();
      return;
    }
    sceneRef.current = scene;

    let rafId = 0;
    let last = performance.now();
    let disposed = false;

    function frame(now: number) {
      if (disposed) return;
      rafId = requestAnimationFrame(frame);

      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const game = gameRef.current!;
      game.timer += dt;

      applyHeldDirection(game, dt, now);
      advancePhase(game, dt);
      updatePose(game, dt);

      game.bowlerX = damp(game.bowlerX, game.targetBowlerX, 9, dt);

      const view: SceneView = {
        shot: game.shot,
        bowlerX: game.bowlerX,
        aimAngle: game.aimAngle,
        showGuide: game.phase === "aim" || game.phase === "wind",
        sweeper: game.sweeper,
        pose: game.pose,
      };
      scene.render(dt, game.sim, view);
    }

    /** Holding Left or Right slides continuously after a short delay, so a
     * tap is one fine step and a hold crosses the lane without 50 presses. */
    function applyHeldDirection(game: GameState, dt: number, now: number) {
      if (game.phase !== "aim" || game.heldDir === 0) return;
      if (now - game.heldSince < HOLD_REPEAT_DELAY_MS) return;
      if (game.aimMode === "move") {
        game.targetBowlerX = clamp(
          game.targetBowlerX + game.heldDir * STANCE_RATE * dt,
          -STANCE_LIMIT,
          STANCE_LIMIT,
        );
      } else {
        game.aimAngle = clamp(game.aimAngle + game.heldDir * AIM_RATE * dt, -AIM_LIMIT, AIM_LIMIT);
      }
    }

    function advancePhase(game: GameState, dt: number) {
      switch (game.phase) {
        case "intro":
          game.shot = "intro";
          if (game.timer >= INTRO_DURATION) {
            setPhase(game, "aim");
            game.shot = "aim";
          }
          break;

        case "aim":
          game.shot = game.cameraView === "lineup" ? "lineup" : "aim";
          break;

        case "wind":
          game.shot = "aim";
          break;

        case "swing":
          game.shot = "release";
          if (!game.sim.ball.released && game.timer >= RELEASE_AT) {
            releaseBall(game);
          }
          if (game.timer >= SWING_DURATION) {
            setPhase(game, "roll");
          }
          break;

        case "roll": {
          const events = step(game.sim, dt);
          const ball = game.sim.ball;

          if (game.rollSound) {
            const speed = Math.hypot(ball.vx, ball.vz);
            game.rollSound.setIntensity(speed / 9);
          }
          if (events.enteredGutter) playGutter();
          if (events.impact > 0) {
            playPinCrash(events.impact);
            sendRef.current({ type: "haptic", pattern: [Math.round(20 + events.impact * 60)] });
          }

          // Camera choreography: trail the ball, then cut low to the deck
          // just before it arrives -- or ride the gutter if it's gone wide.
          if (ball.inGutter) {
            game.shot = "gutter";
          } else if (ball.z < -13.4) {
            if (game.shot !== "pins") scene.cutCamera();
            game.shot = "pins";
          } else {
            game.shot = "follow";
          }

          if (isSettled(game.sim)) {
            game.rollSound?.stop();
            game.rollSound = null;
            setPhase(game, "settle");
          }
          break;
        }

        case "settle":
          game.shot = "result";
          if (game.timer >= SETTLE_PAUSE) {
            if (!game.scored) {
              game.scored = true;
              scoreRoll(game);
            }
            setPhase(game, "result");
          }
          break;

        case "result": {
          game.shot = "result";
          const duration = game.celebrating === "strike" ? STRIKE_RESULT_DURATION : RESULT_DURATION;
          if (game.timer >= duration) {
            playRackReset();
            setPhase(game, "reset");
          }
          break;
        }

        case "reset": {
          game.shot = "result";
          const t = clamp(game.timer / RESET_DURATION, 0, 1);
          // Sweeper drops, sweeps across, then lifts back out of the way.
          game.sweeper = t < 0.7 ? t / 0.7 : 1 - (t - 0.7) / 0.3;
          if (t >= 1) {
            game.sweeper = 0;
            advanceAfterResult(game);
          }
          break;
        }

        case "final":
          game.shot = "result";
          break;
      }
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      gameRef.current?.rollSound?.stop();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [mii, advanceAfterResult, releaseBall, scoreRoll, setPhase, updatePose]);

  // -------------------------------------------------------------------------
  // Controller input
  // -------------------------------------------------------------------------

  useEffect(() => {
    const bDown = { current: false };

    return subscribe((msg) => {
      const game = gameRef.current!;

      if (msg.type === "motion") {
        // The only thing the phone's motion is used for is how hard the
        // swing was, which sets ball speed.
        const { ax, ay, az } = msg.sample;
        if (game.phase === "wind" && ax !== null && ay !== null && az !== null) {
          const magnitude = Math.abs(Math.sqrt(ax * ax + ay * ay + az * az) - 9.81);
          game.peakAccel = Math.max(game.peakAccel, magnitude);
        }
        return;
      }

      if (msg.type !== "button") return;

      if (msg.button === "B") {
        if (msg.state === "down" && !bDown.current) {
          bDown.current = true;
          if (game.phase === "aim") {
            game.peakAccel = 0;
            game.heldDir = 0;
            // Drop back out of the close-up so the swing is actually watchable.
            if (game.cameraView === "lineup") {
              game.cameraView = "normal";
              pushHud(game);
            }
            setPhase(game, "wind");
          }
        } else if (msg.state === "up") {
          bDown.current = false;
          if (game.phase === "wind") {
            game.swingFrom = game.pose.armAngle;
            setPhase(game, "swing");
          }
        }
        return;
      }

      // Left/Right are the only buttons that care about being released.
      if (msg.button === "LEFT" || msg.button === "RIGHT") {
        const dir = msg.button === "LEFT" ? -1 : 1;
        if (msg.state === "up") {
          if (game.heldDir === dir) game.heldDir = 0;
          return;
        }
        if (game.phase !== "aim" || game.heldDir === dir) return;
        game.heldDir = dir;
        game.heldSince = performance.now();
        // One fine step on press; holding takes over from there.
        if (game.aimMode === "move") {
          game.targetBowlerX = clamp(game.targetBowlerX + dir * STANCE_STEP, -STANCE_LIMIT, STANCE_LIMIT);
        } else {
          game.aimAngle = clamp(game.aimAngle + dir * AIM_STEP, -AIM_LIMIT, AIM_LIMIT);
        }
        playBlip();
        return;
      }

      if (msg.state !== "down") return;

      switch (msg.button) {
        case "UP":
          // Walk the camera down the lane for a close look at the line.
          if (game.phase === "aim" && game.cameraView !== "lineup") {
            game.cameraView = "lineup";
            playBlip();
            pushHud(game);
          }
          break;
        case "DOWN":
          if (game.phase === "aim" && game.cameraView !== "normal") {
            game.cameraView = "normal";
            playBlip();
            pushHud(game);
          }
          break;
        case "A":
          if (game.phase === "intro") {
            setPhase(game, "aim");
            game.shot = "aim";
          } else if (game.phase === "aim") {
            // Flip Left/Right between sliding the stance and rotating.
            game.aimMode = game.aimMode === "move" ? "rotate" : "move";
            game.heldDir = 0;
            playBlip();
            pushHud(game);
          } else if (game.phase === "final") {
            onExitRef.current();
          }
          break;
        case "ONE":
          // Back to dead centre, square to the lane.
          if (game.phase === "aim") {
            game.targetBowlerX = 0;
            game.aimAngle = 0;
            playBlip();
          }
          break;
        default:
          break;
      }
    });
  }, [subscribe, setPhase, pushHud]);

  // Auto-return to the Wii Menu a while after the game ends; HOME (handled
  // centrally by ScreenApp) and A both work immediately.
  useEffect(() => {
    if (hud.phase !== "final") return;
    const timer = window.setTimeout(() => onExitRef.current(), FINAL_AUTO_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [hud.phase]);

  // -------------------------------------------------------------------------

  const totals = frameTotals(hud.card);
  const total = currentScore(hud.card);

  return (
    <div className="bowling-root">
      <div className="bowling-viewport" ref={containerRef} />

      <div className="bowling-scorecard">
        {hud.card.map((_frame, i) => {
          const isTenth = i === FRAME_COUNT - 1;
          const boxes = isTenth ? [0, 1, 2] : [0, 1];
          return (
            <div key={i} className={`bowling-frame${i === hud.frameIndex ? " is-active" : ""}${isTenth ? " is-tenth" : ""}`}>
              <div className="bowling-frame-number">{i + 1}</div>
              <div className="bowling-frame-rolls">
                {boxes.map((rollIndex) => (
                  <span key={rollIndex} className="bowling-roll">
                    {rollGlyph(hud.card, i, rollIndex)}
                  </span>
                ))}
              </div>
              <div className="bowling-frame-total">{totals[i] ?? ""}</div>
            </div>
          );
        })}
        <div className="bowling-grand-total">
          <span className="bowling-grand-label">Total</span>
          <span className="bowling-grand-value">{total}</span>
        </div>
      </div>

      <div className="bowling-status">
        <span className="bowling-status-frame">Frame {hud.frameIndex + 1}</span>
        <span className="bowling-status-ball">Ball {hud.ballNumber}</span>
      </div>

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
            <div className="bowling-final-score">{total}</div>
            <p className="bowling-final-note">
              {total === 300 ? "A perfect game!" : total >= 200 ? "Fantastic bowling!" : total >= 130 ? "Nice game!" : "Good game!"}
            </p>
            <p className="bowling-final-hint">Press A to return to the Wii Menu</p>
          </div>
        </div>
      )}

      <div className="bowling-hint">
        {hud.phase === "intro"
          ? "A to skip"
          : hud.phase === "aim"
            ? `←/→ ${hud.aimMode === "move" ? "move" : "rotate"} · A to switch · ↑ check your line · ↓ back · 1 to reset · Hold B, swing, release to bowl`
            : hud.phase === "wind"
              ? "Swing the remote forward and release B"
              : "HOME to exit"}
      </div>
    </div>
  );
}
