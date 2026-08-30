import { useCallback, useEffect, useRef, useState } from "react";
import "./target-practice.css";
import type { GameProps } from "./types";
import { TurnRounds, type RoundProps } from "./TurnRounds";
import { useGameCanvas } from "./useGameCanvas";
import { usePointerPosition } from "../usePointerGrid";
import { playButtonBlip, playLaunchChime } from "../../lib/sound";
import { MiiAvatar } from "../mii/MiiAvatar";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const TARGET_POINTS = 100;
const DUCK_POINTS = 400;
// 5+ consecutive hits (see the "miss" definition below) applies this
// multiplier to every hit while the streak holds.
const COMBO_THRESHOLD = 5;
const COMBO_MULTIPLIER = 1.5;

// Forgiveness radius (px) added on top of a target's drawn radius for hit
// testing -- a real Wii Remote pointer isn't pixel-precise either.
const HIT_FORGIVENESS_PX = 10;

const POP_MS = 150;
const FADE_MS = 350;
const HIT_ANIM_MS = 250;
const POPUP_MS = 700;

const DUCK_MIN_INTERVAL_MS = 7000;
const DUCK_MAX_INTERVAL_MS = 13000;
const DUCK_SPEED_PCT_PER_SEC = 55;
const DUCK_RADIUS_PCT = 5.5;

const STAGE_TRANSITION_MS = 2200;
/** How long the "Range Complete!" card sits before the turn is handed on. */
const RANGE_COMPLETE_MS = 3200;

// The inner "range window" targets bounce around in, percent of play area --
// kept inset from the canvas edges so targets never spawn under the HUD.
const PLAY_X_MIN = 14;
const PLAY_X_MAX = 86;
const PLAY_Y_MIN = 26;
const PLAY_Y_MAX = 78;

interface StageConfig {
  label: string;
  durationMs: number;
  targetRadiusPct: number;
  minLifetimeMs: number;
  maxLifetimeMs: number;
  minSpawnIntervalMs: number;
  maxSpawnIntervalMs: number;
  maxConcurrent: number;
  minSpeedPct: number;
  maxSpeedPct: number;
}

// Five stages, each strictly harder than the last: shorter-lived and smaller
// targets, faster spawns, more of them on screen at once, and quicker drift.
const STAGES: StageConfig[] = [
  {
    label: "Warm-Up",
    durationMs: 18000,
    targetRadiusPct: 9,
    minLifetimeMs: 2600,
    maxLifetimeMs: 3400,
    minSpawnIntervalMs: 1000,
    maxSpawnIntervalMs: 1500,
    maxConcurrent: 2,
    minSpeedPct: 8,
    maxSpeedPct: 16,
  },
  {
    label: "Steady Aim",
    durationMs: 20000,
    targetRadiusPct: 7.5,
    minLifetimeMs: 2200,
    maxLifetimeMs: 2900,
    minSpawnIntervalMs: 800,
    maxSpawnIntervalMs: 1200,
    maxConcurrent: 3,
    minSpeedPct: 14,
    maxSpeedPct: 24,
  },
  {
    label: "Quickdraw",
    durationMs: 22000,
    targetRadiusPct: 6.2,
    minLifetimeMs: 1800,
    maxLifetimeMs: 2400,
    minSpawnIntervalMs: 600,
    maxSpawnIntervalMs: 950,
    maxConcurrent: 3,
    minSpeedPct: 22,
    maxSpeedPct: 34,
  },
  {
    label: "Rapid Fire",
    durationMs: 24000,
    targetRadiusPct: 5,
    minLifetimeMs: 1500,
    maxLifetimeMs: 2000,
    minSpawnIntervalMs: 450,
    maxSpawnIntervalMs: 750,
    maxConcurrent: 4,
    minSpeedPct: 32,
    maxSpeedPct: 46,
  },
  {
    label: "Sharpshooter",
    durationMs: 26000,
    targetRadiusPct: 4,
    minLifetimeMs: 1200,
    maxLifetimeMs: 1650,
    minSpawnIntervalMs: 320,
    maxSpawnIntervalMs: 550,
    maxConcurrent: 5,
    minSpeedPct: 44,
    maxSpeedPct: 62,
  },
];

// ---------------------------------------------------------------------------
// Self-contained WebAudio synth, same oscillator + gain-envelope pattern as
// src/lib/sound.ts but scoped to this file (gunshot/reload/duck cues don't
// belong in the shared menu-chime module).
// ---------------------------------------------------------------------------

let rangeAudioCtx: AudioContext | null = null;

function getRangeAudioCtx(): AudioContext {
  if (!rangeAudioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    rangeAudioCtx = new Ctor();
  }
  if (rangeAudioCtx.state === "suspended") void rangeAudioCtx.resume();
  return rangeAudioCtx;
}

function tone(freq: number, startOffset: number, duration: number, peakGain = 0.12, type: OscillatorType = "sine") {
  const audio = getRangeAudioCtx();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = audio.currentTime + startOffset;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function playGunshot() {
  tone(140, 0, 0.14, 0.2, "square");
  tone(80, 0, 0.09, 0.16, "sawtooth");
}

function playHitPop(isDuck: boolean) {
  if (isDuck) {
    tone(1318.5, 0, 0.1, 0.15, "triangle");
    tone(1760, 0.05, 0.16, 0.13, "triangle");
  } else {
    tone(1046.5, 0, 0.1, 0.13, "triangle");
  }
}

function playDuckAlert() {
  tone(700, 0, 0.07, 0.11, "sine");
  tone(1000, 0.06, 0.09, 0.1, "sine");
}

// ---------------------------------------------------------------------------
// Game world (mutable, kept in a ref -- mutated directly every frame instead
// of via setState, since targets move every frame and a re-render per frame
// would be wasteful; the canvas already redraws every frame regardless).
// ---------------------------------------------------------------------------

type TargetKind = "target" | "duck";

interface RangeTarget {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radiusPct: number;
  spawnedAt: number;
  lifetimeMs: number;
  hit: boolean;
  hitAt?: number;
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  spawnedAt: number;
}

interface World {
  targets: RangeTarget[];
  nextId: number;
  score: number;
  combo: number;
  bestCombo: number;
  stageElapsedMs: number;
  spawnCountdownMs: number;
  duckCountdownMs: number;
  muzzleFlashUntil: number;
  popups: ScorePopup[];
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createWorld(stageNumber: number): World {
  const cfg = STAGES[stageNumber - 1];
  return {
    targets: [],
    nextId: 1,
    score: 0,
    combo: 0,
    bestCombo: 0,
    stageElapsedMs: 0,
    spawnCountdownMs: randomBetween(cfg.minSpawnIntervalMs, cfg.maxSpawnIntervalMs),
    duckCountdownMs: randomBetween(DUCK_MIN_INTERVAL_MS, DUCK_MAX_INTERVAL_MS),
    muzzleFlashUntil: 0,
    popups: [],
  };
}

function spawnTarget(world: World, cfg: StageConfig) {
  const angle = Math.random() * Math.PI * 2;
  const speed = randomBetween(cfg.minSpeedPct, cfg.maxSpeedPct);
  world.targets.push({
    id: world.nextId++,
    kind: "target",
    x: randomBetween(PLAY_X_MIN + 6, PLAY_X_MAX - 6),
    y: randomBetween(PLAY_Y_MIN + 6, PLAY_Y_MAX - 6),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radiusPct: cfg.targetRadiusPct,
    spawnedAt: performance.now(),
    lifetimeMs: randomBetween(cfg.minLifetimeMs, cfg.maxLifetimeMs),
    hit: false,
  });
}

function spawnDuck(world: World) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  playDuckAlert();
  world.targets.push({
    id: world.nextId++,
    kind: "duck",
    x: dir > 0 ? -12 : 112,
    y: randomBetween(14, 24),
    vx: dir * DUCK_SPEED_PCT_PER_SEC,
    vy: 0,
    radiusPct: DUCK_RADIUS_PCT,
    spawnedAt: performance.now(),
    lifetimeMs: 6000,
    hit: false,
  });
}

/**
 * Advances the world by one frame: spawns/moves/expires targets and ducks.
 * A "miss" -- which resets the combo to 0 -- is defined as EITHER a fired
 * shot connecting with nothing (handled in fireShot) OR a target's lifetime
 * running out unhit (handled here). Both count, matching the real game's
 * "don't let it get away" pressure rather than only punishing bad aim.
 */
function updateWorld(world: World, dtSec: number, stageNumber: number) {
  const cfg = STAGES[stageNumber - 1];
  const dtMs = dtSec * 1000;
  const now = performance.now();

  if (world.stageElapsedMs < cfg.durationMs) {
    world.spawnCountdownMs -= dtMs;
    const activeTargetCount = world.targets.filter((t) => t.kind === "target" && !t.hit).length;
    if (world.spawnCountdownMs <= 0 && activeTargetCount < cfg.maxConcurrent) {
      spawnTarget(world, cfg);
      world.spawnCountdownMs = randomBetween(cfg.minSpawnIntervalMs, cfg.maxSpawnIntervalMs);
    }
  }
  world.stageElapsedMs += dtMs;

  const duckActive = world.targets.some((t) => t.kind === "duck" && !t.hit);
  world.duckCountdownMs -= dtMs;
  if (world.duckCountdownMs <= 0 && !duckActive) {
    spawnDuck(world);
    world.duckCountdownMs = randomBetween(DUCK_MIN_INTERVAL_MS, DUCK_MAX_INTERVAL_MS);
  }

  for (const t of world.targets) {
    if (t.hit) continue;
    t.x += t.vx * dtSec;
    t.y += t.vy * dtSec;
    if (t.kind === "target") {
      if (t.x < PLAY_X_MIN || t.x > PLAY_X_MAX) {
        t.vx *= -1;
        t.x = clamp(t.x, PLAY_X_MIN, PLAY_X_MAX);
      }
      if (t.y < PLAY_Y_MIN || t.y > PLAY_Y_MAX) {
        t.vy *= -1;
        t.y = clamp(t.y, PLAY_Y_MIN, PLAY_Y_MAX);
      }
    }
  }

  const survivors: RangeTarget[] = [];
  for (const t of world.targets) {
    if (t.hit) {
      if (now - (t.hitAt ?? now) < HIT_ANIM_MS) survivors.push(t);
      continue;
    }
    const age = now - t.spawnedAt;
    const expired = t.kind === "duck" ? age > t.lifetimeMs || t.x < -20 || t.x > 120 : age > t.lifetimeMs;
    if (expired) {
      world.combo = 0;
      continue;
    }
    survivors.push(t);
  }
  world.targets = survivors;
  world.popups = world.popups.filter((p) => now - p.spawnedAt < POPUP_MS);
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

function drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  sky.addColorStop(0, "#274b52");
  sky.addColorStop(1, "#3a6b6a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height * 0.55);

  const floor = ctx.createLinearGradient(0, height * 0.5, 0, height);
  floor.addColorStop(0, "#5c3d21");
  floor.addColorStop(1, "#2c1c10");
  ctx.fillStyle = floor;
  ctx.fillRect(0, height * 0.5, width, height * 0.5);

  // Wooden enclosure posts framing the range, left/right.
  const postWidth = Math.max(24, width * 0.05);
  const postGrad = ctx.createLinearGradient(0, 0, postWidth, 0);
  postGrad.addColorStop(0, "#3a2415");
  postGrad.addColorStop(1, "#6b4423");
  ctx.fillStyle = postGrad;
  ctx.fillRect(0, 0, postWidth, height);
  ctx.save();
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.fillRect(0, 0, postWidth, height);
  ctx.restore();

  // A faint back-wall target-line and firing-line bar for depth cues.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(postWidth, height * 0.55);
  ctx.lineTo(width - postWidth, height * 0.55);
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, height - 14, width, 14);
}

function drawTargets(ctx: CanvasRenderingContext2D, world: World, width: number, height: number) {
  const now = performance.now();
  const minDim = Math.min(width, height);
  for (const t of world.targets) {
    const px = (t.x / 100) * width;
    const py = (t.y / 100) * height;
    const baseRadius = (t.radiusPct / 100) * minDim;

    let scale = 1;
    let alpha = 1;
    if (t.hit) {
      const p = (now - (t.hitAt ?? now)) / HIT_ANIM_MS;
      scale = 1 + p * 0.8;
      alpha = 1 - p;
    } else {
      const age = now - t.spawnedAt;
      if (age < POP_MS) scale = age / POP_MS;
      const remaining = t.lifetimeMs - age;
      if (remaining < FADE_MS) alpha = Math.max(0, remaining / FADE_MS);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.scale(scale, scale);

    if (t.kind === "duck") {
      ctx.fillStyle = t.hit ? "#ffd65a" : "#c47a2e";
      ctx.beginPath();
      ctx.ellipse(0, 0, baseRadius * 1.15, baseRadius * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.hit ? "#fff2c0" : "#8a5320";
      ctx.beginPath();
      const wingDir = t.vx >= 0 ? -1 : 1;
      ctx.moveTo(wingDir * baseRadius * 0.2, -baseRadius * 0.1);
      ctx.lineTo(wingDir * baseRadius * 1.1, -baseRadius * 0.9);
      ctx.lineTo(wingDir * baseRadius * 0.1, baseRadius * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e8b23a";
      const beakDir = t.vx >= 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(beakDir * baseRadius * 1.1, -baseRadius * 0.1);
      ctx.lineTo(beakDir * baseRadius * 1.5, 0);
      ctx.lineTo(beakDir * baseRadius * 1.1, baseRadius * 0.15);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = t.hit ? "#ffd65a" : "#e04b3f";
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.hit ? "#fff6e0" : "#fdfdfd";
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.hit ? "#ffd65a" : "#e04b3f";
      ctx.beginPath();
      ctx.arc(0, 0, baseRadius * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawPopups(ctx: CanvasRenderingContext2D, world: World, width: number, height: number) {
  const now = performance.now();
  ctx.textAlign = "center";
  ctx.font = "bold 22px 'Trebuchet MS', system-ui, sans-serif";
  for (const p of world.popups) {
    const t = (now - p.spawnedAt) / POPUP_MS;
    const px = (p.x / 100) * width;
    const py = (p.y / 100) * height - t * 40;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = "#ffd65a";
    ctx.fillText(p.text, px, py);
  }
  ctx.globalAlpha = 1;
}

function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number, flashActive: boolean) {
  const size = flashActive ? 26 : 22;
  ctx.save();
  ctx.translate(x, y);
  if (flashActive) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#eafaf6";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-size - 10, 0);
  ctx.lineTo(-size + 6, 0);
  ctx.moveTo(size - 6, 0);
  ctx.lineTo(size + 10, 0);
  ctx.moveTo(0, -size - 10);
  ctx.lineTo(0, -size + 6);
  ctx.moveTo(0, size - 6);
  ctx.lineTo(0, size + 10);
  ctx.stroke();
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, world: World, width: number, stageNumber: number) {
  const cfg = STAGES[stageNumber - 1];

  // Score, top-left.
  ctx.textAlign = "left";
  ctx.fillStyle = "#eafaf6";
  ctx.font = "bold 26px 'Trebuchet MS', system-ui, sans-serif";
  ctx.fillText(`SCORE ${world.score}`, 18, 36);

  // Combo meter, just under the score.
  const comboSegments = 5;
  const segW = 14;
  for (let i = 0; i < comboSegments; i++) {
    ctx.fillStyle = i < Math.min(world.combo, comboSegments) ? "#ffd65a" : "rgba(255,255,255,0.25)";
    ctx.fillRect(18 + i * (segW + 4), 46, segW, 8);
  }
  if (world.combo >= COMBO_THRESHOLD) {
    ctx.fillStyle = "#ffd65a";
    ctx.font = "bold 16px 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillText(`COMBO x${COMBO_MULTIPLIER} (${world.combo})`, 18, 78);
  } else if (world.combo > 0) {
    ctx.fillStyle = "rgba(234,250,246,0.75)";
    ctx.font = "16px 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillText(`Combo ${world.combo}`, 18, 78);
  }

  // Stage label + progress bar, top-right.
  ctx.textAlign = "right";
  ctx.fillStyle = "#eafaf6";
  ctx.font = "bold 22px 'Trebuchet MS', system-ui, sans-serif";
  ctx.fillText(`STAGE ${stageNumber}/${STAGES.length} · ${cfg.label}`, width - 18, 36);
  const barW = 220;
  const progress = clamp(world.stageElapsedMs / cfg.durationMs, 0, 1);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(width - 18 - barW, 46, barW, 8);
  ctx.fillStyle = "#7fd9c9";
  ctx.fillRect(width - 18 - barW, 46, barW * progress, 8);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Phase = "playing" | "stage-clear" | "final";

interface FinalStats {
  score: number;
  bestCombo: number;
}

/**
 * One player's trip through the range. Rendered by TurnRounds, which
 * remounts it per player and collects the final score -- so this component
 * only ever deals with a single run.
 */
function RangeRound({ subscribe, mii, onFinish }: RoundProps) {
  const [stage, setStage] = useState(1);
  const [phase, setPhase] = useState<Phase>("playing");
  const [paused, setPaused] = useState(false);
  const [finalStats, setFinalStats] = useState<FinalStats | null>(null);

  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const worldRef = useRef<World>(createWorld(1));
  const transitioningRef = useRef(false);
  const stageTimeoutRef = useRef<number | null>(null);

  const bDownRef = useRef(false);
  const oneDownRef = useRef(false);
  const lastSizeRef = useRef({ width: 0, height: 0 });

  const reticlePosRef = usePointerPosition(subscribe);

  const fireShot = useCallback(() => {
    if (phaseRef.current !== "playing" || pausedRef.current) return;
    const world = worldRef.current;
    const now = performance.now();
    world.muzzleFlashUntil = now + 90;
    playGunshot();

    const { width, height } = lastSizeRef.current;
    if (width <= 0 || height <= 0) return;
    const reticle = reticlePosRef.current;
    const rx = (reticle.x / 100) * width;
    const ry = (reticle.y / 100) * height;
    const minDim = Math.min(width, height);

    let best: RangeTarget | null = null;
    let bestDist = Infinity;
    for (const t of world.targets) {
      if (t.hit) continue;
      const tx = (t.x / 100) * width;
      const ty = (t.y / 100) * height;
      const rad = (t.radiusPct / 100) * minDim + HIT_FORGIVENESS_PX;
      const d = Math.hypot(rx - tx, ry - ty);
      if (d <= rad && d < bestDist) {
        bestDist = d;
        best = t;
      }
    }

    if (best) {
      world.combo += 1;
      if (world.combo > world.bestCombo) world.bestCombo = world.combo;
      const multiplier = world.combo >= COMBO_THRESHOLD ? COMBO_MULTIPLIER : 1;
      const basePoints = best.kind === "duck" ? DUCK_POINTS : TARGET_POINTS;
      const points = Math.round(basePoints * multiplier);
      world.score += points;
      best.hit = true;
      best.hitAt = now;
      world.popups.push({ x: best.x, y: best.y, text: `+${points}`, spawnedAt: now });
      playHitPop(best.kind === "duck");
    } else {
      // Miss: a shot connected with nothing -- breaks the combo (see the
      // doc comment on updateWorld for the other half of the miss rule).
      world.combo = 0;
    }
  }, [reticlePosRef]);

  const beginStageTransition = useCallback(() => {
    transitioningRef.current = true;
    playLaunchChime();
    setPhase("stage-clear");
    stageTimeoutRef.current = window.setTimeout(() => {
      setStage((currentStage) => {
        const next = currentStage + 1;
        if (next > STAGES.length) {
          setFinalStats({ score: worldRef.current.score, bestCombo: worldRef.current.bestCombo });
          setPhase("final");
          return currentStage;
        }
        const cfg = STAGES[next - 1];
        worldRef.current.targets = [];
        worldRef.current.stageElapsedMs = 0;
        worldRef.current.spawnCountdownMs = randomBetween(cfg.minSpawnIntervalMs, cfg.maxSpawnIntervalMs);
        setPhase("playing");
        transitioningRef.current = false;
        return next;
      });
    }, STAGE_TRANSITION_MS);
  }, []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, dt: number, width: number, height: number) => {
      lastSizeRef.current = { width, height };
      const world = worldRef.current;
      const isPlaying = phase === "playing" && !paused;

      if (isPlaying) {
        updateWorld(world, dt, stage);
      }

      ctx.clearRect(0, 0, width, height);
      drawBackdrop(ctx, width, height);
      drawTargets(ctx, world, width, height);

      const now = performance.now();

      ctx.save();
      ctx.translate(0, height - 34);
      drawHud(ctx, world, width, stage);
      ctx.restore();

      drawPopups(ctx, world, width, height);

      const reticle = reticlePosRef.current;
      const rx = (reticle.x / 100) * width;
      const ry = (reticle.y / 100) * height;
      drawReticle(ctx, rx, ry, now < world.muzzleFlashUntil);

      if (isPlaying && !transitioningRef.current) {
        const cfg = STAGES[stage - 1];
        const spawnWindowOver = world.stageElapsedMs >= cfg.durationMs;
        const noActiveTargets = !world.targets.some((t) => t.kind === "target" && !t.hit);
        if (spawnWindowOver && noActiveTargets) {
          beginStageTransition();
        }
      }
    },
    [phase, paused, stage, reticlePosRef, beginStageTransition],
  );

  const canvasRef = useGameCanvas(draw);

  // Single input subscription for the whole component lifetime -- reads
  // current phase/pause state via refs (mirrored above) so it never needs to
  // resubscribe.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "button") {
        if (msg.button === "B") {
          if (msg.state === "down" && !bDownRef.current) {
            bDownRef.current = true;
            fireShot();
          } else if (msg.state === "up") {
            bDownRef.current = false;
          }
        } else if (msg.button === "ONE") {
          if (msg.state === "down" && !oneDownRef.current) {
            oneDownRef.current = true;
            if (phaseRef.current === "playing") {
              setPaused((p) => !p);
              playButtonBlip();
            }
          } else if (msg.state === "up") {
            oneDownRef.current = false;
          }
        }
      }
    });
  }, [subscribe, fireShot]);

  // The round is over: hand the score up. TurnRounds owns what comes next,
  // whether that's the next player or the results table.
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  useEffect(() => {
    if (phase !== "final" || !finalStats) return;
    const timer = window.setTimeout(() => onFinishRef.current(finalStats.score), RANGE_COMPLETE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, finalStats]);

  // Clean up the one timer this component owns outside the rAF loop (the
  // stage-clear -> next-stage transition); useGameCanvas already handles its
  // own rAF lifecycle.
  useEffect(() => {
    return () => {
      if (stageTimeoutRef.current !== null) window.clearTimeout(stageTimeoutRef.current);
    };
  }, []);

  return (
    <div className="target-practice-root">
      <div className="target-practice-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>

      <div className="target-practice-mii">
        <MiiAvatar mii={mii} size={56} pose="idle" />
      </div>

      {phase === "playing" && paused && (
        <div className="target-practice-overlay">
          <div className="target-practice-panel">
            <h2 className="target-practice-panel-title">Paused</h2>
            <p className="target-practice-panel-text">Press 1 to resume · HOME to exit anytime</p>
          </div>
        </div>
      )}

      {phase === "stage-clear" && (
        <div className="target-practice-overlay">
          <div className="target-practice-panel">
            <h2 className="target-practice-panel-title">Stage {stage} clear!</h2>
            <p className="target-practice-panel-text">Score {worldRef.current.score}</p>
          </div>
        </div>
      )}

      {phase === "final" && finalStats && (
        <div className="target-practice-overlay">
          <div className="target-practice-panel target-practice-final">
            <h2 className="target-practice-panel-title">Range Complete!</h2>
            <div className="target-practice-final-score">{finalStats.score}</div>
            <p className="target-practice-panel-text">Best combo: {finalStats.bestCombo}</p>
          </div>
        </div>
      )}

      <div className="target-practice-hint">B to fire · 1 to pause · HOME to exit</div>
    </div>
  );
}

/**
 * Shooting Range takes turns: each player runs the whole five-stage range,
 * then the scores are ranked. Solo play is exactly as it was.
 */
export function TargetPractice({ send, subscribe, onExit, players }: GameProps) {
  return (
    <TurnRounds
      players={players}
      send={send}
      subscribe={subscribe}
      onExit={onExit}
      title="Shooting Range"
      renderRound={(round) => <RangeRound {...round} />}
    />
  );
}
