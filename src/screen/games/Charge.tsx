import { useEffect, useRef, useState } from "react";
import "./charge.css";
import type { GameProps } from "./types";
import { useGameCanvas } from "./useGameCanvas";
import { useSwing } from "./useSwing";
import { MiiAvatar } from "../mii/MiiAvatar";
import { playButtonBlip, playLaunchChime, playHoverTick } from "../../lib/sound";

// ---------------------------------------------------------------------------
// A scoped one-off "stumble" sound for hurdles -- built the same way as
// src/lib/sound.ts's tone() helper (a simple gain-enveloped oscillator), but
// kept local to this file rather than added to the shared synth since this
// game is the only one that needs a descending "thud".
// ---------------------------------------------------------------------------
let chargeAudioCtx: AudioContext | null = null;
function chargeAudioContext(): AudioContext {
  if (!chargeAudioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    chargeAudioCtx = new Ctor();
  }
  if (chargeAudioCtx.state === "suspended") void chargeAudioCtx.resume();
  return chargeAudioCtx;
}
function playStumbleThud() {
  const audio = chargeAudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sawtooth";
  const start = audio.currentTime;
  osc.frequency.setValueAtTime(180, start);
  osc.frequency.exponentialRampToValueAtTime(65, start + 0.22);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + 0.3);
}

// ---------------------------------------------------------------------------
// Tuning constants -- first pass, unvalidated against a real device. Expect
// to adjust after live playtesting, same spirit as the swing tuning in
// Bowling.tsx and useSwing.ts's own doc comment.
// ---------------------------------------------------------------------------

// Forward speed (world units/sec), modulated by the phone's forward/back
// tilt (pointer.oy). Clamped so the cow always has some forward crawl and
// never goes backward, matching an on-rails feel rather than free-roam.
const NEUTRAL_SPEED = 9;
const ACCEL_PER_OY = 7;
const MIN_SPEED = 4;
const MAX_SPEED = 17;
// Flip to -1 if forward/back ever reads backwards after live testing -- see
// X_SIGN/Y_SIGN in src/controller/useMotionStream.ts for the precedent.
const OY_SIGN = 1;

// Steering: pointer.ox maps to a target lateral position (-1..1 across the
// path), smoothed toward with an exponential lerp so it feels responsive
// without being twitchy. Bumped up from an earlier, less sensitive pass --
// full steering range should be reachable with a small, easy phone tilt so
// there's less large arm/wrist motion (and less chance to overcorrect and
// crash) needed to stay on the path.
const STEER_SCALE = 2.6;
const STEER_SMOOTH_RATE = 7;
// Flip to -1 if left/right ever reads backwards after live testing.
const OX_SIGN = 1;

// Jump gesture (useSwing) -- a quick upward flick is shorter/faster than a
// big swing. Sword Duel's quick-reaction slash used threshold:11/
// cooldownMs:300; tuned a notch lower/faster here since a jump flick is an
// even smaller, snappier motion.
const JUMP_SWING_THRESHOLD = 9;
const JUMP_SWING_COOLDOWN_MS = 250;
const JUMP_DURATION_S = 0.6;

// Hurdle timing forgiveness: being airborne any time while world-progress is
// within this many units of the hurdle counts as clearing it -- jumping
// slightly early or late still works.
const JUMP_FORGIVENESS = 5;

// Scoring.
const HIT_RADIUS = 0.4;
const STREAK_BONUS_EVERY = 3;
const STREAK_BONUS_POINTS = 5;
const REGULAR_POINTS = 1;
const CROWNED_POINTS = 10;

// Hurdle stumble: a forgiving speed penalty + visual reaction rather than an
// instant fail or getting knocked off the path -- a deliberate simplification
// from the real game's "can knock the cow off the path entirely", documented
// here per this project's pattern of flagging honest scope calls.
const STUMBLE_SLOW_FACTOR = 0.35;
const STUMBLE_DURATION_S = 1.1;

const RUN_SECONDS = 90;
const FINAL_HOLD_MS = 5000;

// Spawn design: obstacles are generated procedurally as progress advances,
// keeping a lookahead window filled rather than precomputing a fixed course.
const MIN_GAP = 45;
const MAX_GAP = 85;
const SPAWN_LOOKAHEAD = 140;
const DESPAWN_BEHIND = 20;
// Narrowed from an earlier, wider pass -- a tighter path means less extreme
// steering is needed to line up with (or dodge) obstacles.
const PATH_HALF_WIDTH = 0.62;
const CLUSTER_SPACING = 9;
// Spawn-type weights (cumulative probabilities out of 1.0): hurdle, then
// rare crowned scarecrow, then chained cluster, then (the remainder) a
// single regular scarecrow -- regular singles are intentionally the most
// common.
const P_HURDLE = 0.16;
const P_CROWNED = 0.09;
const P_CLUSTER = 0.2;

// Rendering / perspective.
const VISIBLE_RANGE = 140;
const HORIZON_FRAC = 0.32;
const CAMERA_BOTTOM_FRAC = 0.86;
const POST_SPACING = 12;

type ObstacleKind = "scarecrow" | "hurdle";
type ScarecrowSub = "regular" | "crowned";
type ObstacleStatus = "pending" | "hit" | "missed" | "cleared" | "stumbled";

interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** Only meaningful for scarecrows; hurdles just leave this "regular". */
  sub: ScarecrowSub;
  /** World-progress position along the path. */
  progress: number;
  /** Lateral position, -1..1. Hurdles span (conceptually) the whole path
   * width, so this is always 0 for them -- steering alone can't dodge one,
   * only a well-timed jump clears it. */
  x: number;
  status: ObstacleStatus;
}

interface EngineState {
  progress: number;
  elapsed: number;
  lastDisplayedSecond: number;
  steer: number;
  targetSteer: number;
  ox: number;
  oy: number;
  jumpTimer: number;
  stumbleTimer: number;
  score: number;
  streak: number;
  bestStreak: number;
  nextSpawnProgress: number;
  nextObstacleId: number;
  obstacles: Obstacle[];
}

function createEngineState(): EngineState {
  return {
    progress: 0,
    elapsed: 0,
    lastDisplayedSecond: RUN_SECONDS,
    steer: 0,
    targetSteer: 0,
    ox: 0,
    oy: 0,
    jumpTimer: 0,
    stumbleTimer: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    nextSpawnProgress: randRange(MIN_GAP, MAX_GAP),
    nextObstacleId: 1,
    obstacles: [],
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Spawns one obstacle "slot" at `atProgress` (a single scarecrow, a rare
 * crowned scarecrow, a hurdle, or a chained cluster of 2-4 scarecrows) and
 * returns the world-progress at which the next slot should spawn. */
function spawnGroup(st: EngineState, atProgress: number): number {
  const roll = Math.random();
  const nextId = () => st.nextObstacleId++;

  if (roll < P_HURDLE) {
    st.obstacles.push({ id: nextId(), kind: "hurdle", sub: "regular", progress: atProgress, x: 0, status: "pending" });
    return atProgress + randRange(MIN_GAP, MAX_GAP);
  }
  if (roll < P_HURDLE + P_CROWNED) {
    st.obstacles.push({
      id: nextId(),
      kind: "scarecrow",
      sub: "crowned",
      progress: atProgress,
      x: randRange(-PATH_HALF_WIDTH, PATH_HALF_WIDTH),
      status: "pending",
    });
    return atProgress + randRange(MIN_GAP, MAX_GAP);
  }
  if (roll < P_HURDLE + P_CROWNED + P_CLUSTER) {
    // Chained cluster: 2-4 scarecrows in a tight row, all in the same lane
    // so a held steering line can chain the whole streak.
    const count = 2 + Math.floor(Math.random() * 3);
    const laneX = randRange(-PATH_HALF_WIDTH * 0.6, PATH_HALF_WIDTH * 0.6);
    let last = atProgress;
    for (let i = 0; i < count; i++) {
      st.obstacles.push({ id: nextId(), kind: "scarecrow", sub: "regular", progress: last, x: laneX, status: "pending" });
      if (i < count - 1) last += CLUSTER_SPACING;
    }
    return last + randRange(MIN_GAP, MAX_GAP);
  }
  // Regular single scarecrow -- the most common spawn.
  st.obstacles.push({
    id: nextId(),
    kind: "scarecrow",
    sub: "regular",
    progress: atProgress,
    x: randRange(-PATH_HALF_WIDTH, PATH_HALF_WIDTH),
    status: "pending",
  });
  return atProgress + randRange(MIN_GAP, MAX_GAP);
}

interface Projection {
  y: number;
  laneHalfWidth: number;
  scale: number;
}

/** Cheap perspective approximation (not physically accurate, just a
 * pleasant-looking falloff): distance 0 = right at the camera (t=1, wide,
 * low on screen), distance >= VISIBLE_RANGE = at the horizon (t=0, narrow,
 * high on screen). Squaring gives near objects a satisfying growth curve. */
function projectPoint(distance: number, width: number, height: number): Projection {
  const tLin = clamp(1 - distance / VISIBLE_RANGE, 0, 1);
  const t = tLin * tLin;
  const horizonY = height * HORIZON_FRAC;
  const bottomY = height * CAMERA_BOTTOM_FRAC;
  return {
    y: horizonY + t * (bottomY - horizonY),
    laneHalfWidth: width * (0.035 + t * 0.4),
    scale: 0.12 + t * 1.0,
  };
}

// ---------------------------------------------------------------------------
// Drawing helpers -- warm yarn/craft palette, soft rounded shapes with a
// blurred canvas shadow standing in for fuzzy felted material. This is
// explicitly a lighter-touch visual pass per the project's scope notes.
// ---------------------------------------------------------------------------

function drawSkyAndGround(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const horizonY = height * HORIZON_FRAC;
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, "#bfe3f0");
  sky.addColorStop(1, "#f3e0b8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizonY);

  // Soft craft-paper sun.
  ctx.save();
  ctx.shadowColor = "rgba(255, 214, 120, 0.9)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#ffe082";
  ctx.beginPath();
  ctx.arc(width * 0.82, horizonY * 0.35, Math.min(width, height) * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const ground = ctx.createLinearGradient(0, horizonY, 0, height);
  ground.addColorStop(0, "#c9a06a");
  ground.addColorStop(1, "#8a6339");
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizonY, width, height - horizonY);
}

function drawFencePost(ctx: CanvasRenderingContext2D, x: number, proj: Projection) {
  const postH = 26 * proj.scale;
  const postW = 5 * proj.scale;
  ctx.save();
  ctx.shadowColor = "rgba(90, 60, 30, 0.5)";
  ctx.shadowBlur = 3 * proj.scale;
  ctx.fillStyle = "#5c3d20";
  ctx.beginPath();
  ctx.roundRect(x - postW / 2, proj.y - postH, postW, postH, postW / 2);
  ctx.fill();
  ctx.restore();
}

function drawGroundRung(ctx: CanvasRenderingContext2D, width: number, proj: Projection) {
  ctx.save();
  ctx.strokeStyle = `rgba(255, 244, 214, ${0.18 * proj.scale})`;
  ctx.lineWidth = Math.max(1, 2 * proj.scale);
  ctx.beginPath();
  ctx.moveTo(width / 2 - proj.laneHalfWidth * 0.92, proj.y);
  ctx.lineTo(width / 2 + proj.laneHalfWidth * 0.92, proj.y);
  ctx.stroke();
  ctx.restore();
}

/** Layered overlapping circles standing in for a "yarn ball" fuzzy texture,
 * used for the scarecrow/cow bodies -- a cheap craft-material approximation. */
function drawYarnBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 0.7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.5, y - r * 0.2, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.5, y - r * 0.15, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Obstacle sprites are sized off `proj.scale` (0.12-1.0, purely a distance
// falloff) multiplied by this world-to-pixel factor, computed once per frame
// from canvas size -- the same idea `drawCow` uses for its own baseScale.
// Previously each obstacle multiplied plain `proj.scale` directly, which
// left them just a few pixels across regardless of canvas size while the
// cow scaled properly, making the cow look enormous next to tiny targets.
function worldScale(width: number, height: number): number {
  return Math.min(width, height) * 0.0095;
}

function drawScarecrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  proj: Projection,
  sub: ScarecrowSub,
  status: ObstacleStatus,
  sizeScale: number,
) {
  const s = proj.scale * sizeScale;
  const y = proj.y;
  const knocked = status === "hit";
  ctx.save();
  ctx.translate(x, y);
  if (knocked) ctx.rotate((Math.PI / 2) * 0.85);
  const bodyColor = sub === "crowned" ? "#c4453b" : "#c9a15a";
  const baseY = knocked ? -6 * s : 0;

  // Pole + crossbar (drawn behind the body).
  ctx.save();
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = Math.max(1, 2.4 * s);
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  ctx.lineTo(0, baseY - 34 * s);
  ctx.moveTo(-11 * s, baseY - 22 * s);
  ctx.lineTo(11 * s, baseY - 22 * s);
  ctx.stroke();
  ctx.restore();

  drawYarnBlob(ctx, 0, baseY - 12 * s, 9 * s, bodyColor);
  drawYarnBlob(ctx, 0, baseY - 30 * s, 7 * s, "#f0d5a8");

  if (sub === "crowned") {
    ctx.save();
    ctx.fillStyle = "#ffd54a";
    ctx.beginPath();
    ctx.moveTo(-6 * s, baseY - 36 * s);
    ctx.lineTo(0, baseY - 46 * s);
    ctx.lineTo(6 * s, baseY - 36 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawHurdle(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  proj: Projection,
  status: ObstacleStatus,
  sizeScale: number,
) {
  const s = proj.scale * sizeScale;
  const y = proj.y;
  const halfSpan = proj.laneHalfWidth * 1.05;
  const stumbled = status === "stumbled";

  ctx.save();
  ctx.translate(centerX, 0);

  // High-contrast caution bar (previously a brown that blended straight
  // into the ground/fence palette, which is a big part of why hurdles were
  // easy to miss) with a striped accent, like a real hazard bar.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 3 * s;
  ctx.fillStyle = "#e0522f";
  ctx.beginPath();
  ctx.roundRect(-halfSpan, y - 8 * s, halfSpan * 2, 6 * s, 3 * s);
  ctx.fill();
  ctx.fillStyle = "#fff4e0";
  const stripeW = 6 * s;
  for (let sx = -halfSpan + 2 * s; sx < halfSpan - stripeW; sx += stripeW * 2.2) {
    ctx.fillRect(sx, y - 8 * s, stripeW, 6 * s);
  }
  ctx.fillStyle = "#5c3d20";
  ctx.beginPath();
  ctx.roundRect(-halfSpan, y - 22 * s, 5 * s, 22 * s, 2 * s);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(halfSpan - 5 * s, y - 22 * s, 5 * s, 22 * s, 2 * s);
  ctx.fill();
  ctx.restore();

  // A tall warning flag well above the bar itself -- reads from much
  // further away than the bar alone would, so a hurdle is spotted with
  // plenty of time to react instead of appearing suddenly at jump range.
  const poleTopY = y - 46 * s;
  ctx.save();
  ctx.strokeStyle = "#3a2515";
  ctx.lineWidth = Math.max(1, 1.6 * s);
  ctx.beginPath();
  ctx.moveTo(0, y - 8 * s);
  ctx.lineTo(0, poleTopY);
  ctx.stroke();
  const wave = Math.sin(performance.now() * 0.006 + centerX * 0.05) * 3 * s;
  ctx.fillStyle = "#ffd54a";
  ctx.beginPath();
  ctx.moveTo(0, poleTopY);
  ctx.lineTo(14 * s + wave, poleTopY + 5 * s);
  ctx.lineTo(0, poleTopY + 10 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (stumbled) {
    ctx.save();
    ctx.fillStyle = "rgba(196, 69, 59, 0.4)";
    ctx.beginPath();
    ctx.arc(0, y - 16 * s, 22 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

interface CowScreen {
  x: number;
  y: number;
  scale: number;
}

function drawCow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  steer: number,
  jumpFrac: number,
  stumbleFrac: number,
): CowScreen {
  // Shrunk relative to an earlier pass, and now expressed off the same
  // worldScale() the obstacles use (see the comment above drawScarecrow) so
  // the cow and the things it's dodging/collecting are drawn to a
  // consistent scale instead of the cow scaling with canvas size while
  // obstacles stayed pinned to a tiny fixed range.
  const baseScale = worldScale(width, height) * 0.85;
  const lateralRange = width * 0.24;
  const jitter = stumbleFrac > 0 ? Math.sin(performance.now() * 0.08) * 4 * stumbleFrac : 0;
  const x = width / 2 + steer * lateralRange + jitter;
  const jumpLift = Math.sin(Math.PI * jumpFrac) * height * 0.1;
  const y = height * CAMERA_BOTTOM_FRAC + height * 0.05 - jumpLift;
  const squash = 1 - Math.sin(Math.PI * jumpFrac) * 0.15;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(squash, 1 / squash);
  ctx.rotate(clamp(steer, -1, 1) * 0.08);

  if (stumbleFrac > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(196, 69, 59, ${0.35 * stumbleFrac})`;
    ctx.beginPath();
    ctx.arc(0, -14 * baseScale, 34 * baseScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Legs (simple stubby ovals).
  ctx.save();
  ctx.fillStyle = "#f3ead9";
  for (const lx of [-9, -3, 3, 9]) {
    ctx.beginPath();
    ctx.ellipse(lx * baseScale, 10 * baseScale, 3 * baseScale, 9 * baseScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Body -- craft-yarn blob in warm cream/brown.
  drawYarnBlob(ctx, 0, -6 * baseScale, 20 * baseScale, "#f3ead9");
  drawYarnBlob(ctx, -10 * baseScale, -14 * baseScale, 9 * baseScale, "#5c3d20");
  drawYarnBlob(ctx, 9 * baseScale, -4 * baseScale, 7 * baseScale, "#5c3d20");

  // Head + ears + horns.
  ctx.save();
  ctx.fillStyle = "#f3ead9";
  ctx.beginPath();
  ctx.arc(0, -30 * baseScale, 11 * baseScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e0c9a6";
  ctx.beginPath();
  ctx.ellipse(-10 * baseScale, -35 * baseScale, 4 * baseScale, 6 * baseScale, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(10 * baseScale, -35 * baseScale, 4 * baseScale, 6 * baseScale, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2b1a0e";
  ctx.beginPath();
  ctx.arc(-4 * baseScale, -31 * baseScale, 1.6 * baseScale, 0, Math.PI * 2);
  ctx.arc(4 * baseScale, -31 * baseScale, 1.6 * baseScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e07a7a";
  ctx.beginPath();
  ctx.ellipse(0, -25 * baseScale, 3 * baseScale, 2 * baseScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();

  return { x, y: y - 34 * baseScale, scale: baseScale };
}

type Phase = "playing" | "final";

interface BannerState {
  id: number;
  text: string;
}

export function Charge({ send, subscribe, onExit, players }: GameProps) {
  // These games are single-player; the host is whoever started them.
  const mii = players[0].mii;
  const engineRef = useRef<EngineState>(createEngineState());
  const riderRef = useRef<HTMLDivElement | null>(null);

  const [phase, setPhase] = useState<Phase>("playing");
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(RUN_SECONDS);
  const [banner, setBanner] = useState<BannerState | null>(null);

  const bannerIdRef = useRef(0);
  const bannerTimeoutRef = useRef<number | null>(null);
  const finalTimeoutRef = useRef<number | null>(null);

  const showBanner = (text: string, ms = 900) => {
    bannerIdRef.current += 1;
    const id = bannerIdRef.current;
    setBanner({ id, text });
    if (bannerTimeoutRef.current !== null) window.clearTimeout(bannerTimeoutRef.current);
    bannerTimeoutRef.current = window.setTimeout(() => {
      setBanner((b) => (b && b.id === id ? null : b));
    }, ms);
  };

  // Track the phone's raw pointer offset continuously -- this is a
  // speed/steer modulation signal, not a screen position, so we subscribe
  // directly rather than going through usePointerPosition.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "pointer") {
        engineRef.current.ox = msg.ox;
        engineRef.current.oy = msg.oy;
      }
    });
  }, [subscribe]);

  useSwing(
    subscribe,
    () => {
      if (phase !== "playing") return;
      engineRef.current.jumpTimer = JUMP_DURATION_S;
    },
    { threshold: JUMP_SWING_THRESHOLD, cooldownMs: JUMP_SWING_COOLDOWN_MS },
  );

  const draw = (ctx: CanvasRenderingContext2D, dt: number, width: number, height: number) => {
    const st = engineRef.current;

    if (phase === "playing") {
      const speed = clamp(NEUTRAL_SPEED + OY_SIGN * st.oy * ACCEL_PER_OY, MIN_SPEED, MAX_SPEED);
      const stumbleFactor = st.stumbleTimer > 0 ? STUMBLE_SLOW_FACTOR : 1;
      st.progress += speed * stumbleFactor * dt;

      st.targetSteer = clamp(OX_SIGN * st.ox * STEER_SCALE, -1, 1);
      st.steer += (st.targetSteer - st.steer) * Math.min(1, STEER_SMOOTH_RATE * dt);

      if (st.jumpTimer > 0) st.jumpTimer = Math.max(0, st.jumpTimer - dt);
      if (st.stumbleTimer > 0) st.stumbleTimer = Math.max(0, st.stumbleTimer - dt);

      while (st.nextSpawnProgress < st.progress + SPAWN_LOOKAHEAD) {
        st.nextSpawnProgress = spawnGroup(st, st.nextSpawnProgress);
      }

      for (const ob of st.obstacles) {
        if (ob.status !== "pending") continue;

        if (ob.kind === "hurdle") {
          const windowStart = ob.progress - JUMP_FORGIVENESS;
          const windowEnd = ob.progress + JUMP_FORGIVENESS;
          if (st.progress >= windowStart && st.jumpTimer > 0) {
            ob.status = "cleared";
          } else if (st.progress > windowEnd) {
            ob.status = "stumbled";
            st.stumbleTimer = STUMBLE_DURATION_S;
            st.streak = 0;
            setStreak(0);
            showBanner("Stumble!");
            playStumbleThud();
            send({ type: "haptic", pattern: [15, 30, 40] });
          }
        } else if (st.progress >= ob.progress) {
          const aligned = Math.abs(st.steer - ob.x) < HIT_RADIUS;
          if (aligned) {
            ob.status = "hit";
            st.streak += 1;
            st.bestStreak = Math.max(st.bestStreak, st.streak);
            const base = ob.sub === "crowned" ? CROWNED_POINTS : REGULAR_POINTS;
            st.score += base;
            let text = ob.sub === "crowned" ? `+${CROWNED_POINTS} CROWNED!` : `+${base}`;
            if (ob.sub === "crowned") {
              playLaunchChime();
              send({ type: "haptic", pattern: [20, 20, 20, 20, 60] });
            } else {
              playButtonBlip();
              send({ type: "haptic", pattern: [12] });
            }
            if (st.streak % STREAK_BONUS_EVERY === 0) {
              st.score += STREAK_BONUS_POINTS;
              text = `STREAK x${st.streak}! +${STREAK_BONUS_POINTS}`;
              playHoverTick();
            }
            showBanner(text);
            setScore(st.score);
            setStreak(st.streak);
            setBestStreak(st.bestStreak);
          } else {
            ob.status = "missed";
            st.streak = 0;
            setStreak(0);
          }
        }
      }

      if (st.obstacles.length > 0 && st.progress - st.obstacles[0].progress > DESPAWN_BEHIND) {
        st.obstacles = st.obstacles.filter((o) => st.progress - o.progress <= DESPAWN_BEHIND);
      }

      st.elapsed += dt;
      const remaining = Math.max(0, RUN_SECONDS - st.elapsed);
      const remainingCeil = Math.ceil(remaining);
      if (remainingCeil !== st.lastDisplayedSecond) {
        st.lastDisplayedSecond = remainingCeil;
        setTimeLeft(remainingCeil);
      }
      if (remaining <= 0) {
        setPhase("final");
      }
    }

    // --- render ---
    drawSkyAndGround(ctx, width, height);

    const baseP = Math.floor((st.progress - 6) / POST_SPACING) * POST_SPACING;
    const count = Math.ceil((VISIBLE_RANGE + 6) / POST_SPACING);
    for (let i = count; i >= 0; i--) {
      const p = baseP + i * POST_SPACING;
      const distance = p - st.progress;
      if (distance < -6 || distance > VISIBLE_RANGE) continue;
      const proj = projectPoint(distance, width, height);
      drawGroundRung(ctx, width, proj);
      drawFencePost(ctx, width / 2 - proj.laneHalfWidth - 4 * proj.scale, proj);
      drawFencePost(ctx, width / 2 + proj.laneHalfWidth + 4 * proj.scale, proj);
    }

    const obstacleSizeScale = worldScale(width, height);
    for (let i = st.obstacles.length - 1; i >= 0; i--) {
      const ob = st.obstacles[i];
      const distance = ob.progress - st.progress;
      if (distance > VISIBLE_RANGE) continue;
      const proj = projectPoint(distance, width, height);
      if (ob.kind === "hurdle") {
        drawHurdle(ctx, width / 2, proj, ob.status, obstacleSizeScale);
      } else {
        const screenX = width / 2 + ob.x * proj.laneHalfWidth;
        drawScarecrow(ctx, screenX, proj, ob.sub, ob.status, obstacleSizeScale);
      }
    }

    const jumpFrac = st.jumpTimer > 0 ? 1 - st.jumpTimer / JUMP_DURATION_S : 0;
    const stumbleFrac = st.stumbleTimer > 0 ? st.stumbleTimer / STUMBLE_DURATION_S : 0;
    const cow = drawCow(ctx, width, height, st.steer, jumpFrac, stumbleFrac);

    const rider = riderRef.current;
    if (rider) {
      // cow.y already has the jump lift baked in (drawCow applies it once
      // internally) -- applying it again here made the rider Mii fly twice
      // as high as the cow body during a jump, visibly desyncing the two.
      rider.style.left = `${cow.x}px`;
      rider.style.top = `${cow.y}px`;
    }
  };

  const canvasRef = useGameCanvas(draw);

  // Once the run ends, hold the final tally briefly then hand control back
  // to the Wii Menu automatically (HOME still works anytime, handled
  // centrally by ScreenApp).
  useEffect(() => {
    if (phase !== "final") return;
    finalTimeoutRef.current = window.setTimeout(() => onExit(), FINAL_HOLD_MS);
    return () => {
      if (finalTimeoutRef.current !== null) window.clearTimeout(finalTimeoutRef.current);
    };
  }, [phase, onExit]);

  // Clear any timers this component owns on unmount (the rAF loop itself is
  // owned and cleaned up by useGameCanvas).
  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current !== null) window.clearTimeout(bannerTimeoutRef.current);
      if (finalTimeoutRef.current !== null) window.clearTimeout(finalTimeoutRef.current);
    };
  }, []);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="charge-root">
      <div className="charge-hud">
        <div className="charge-hud-item">
          <span className="charge-hud-label">Time</span>
          <span className="charge-hud-value">
            {minutes}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
        <div className="charge-hud-item">
          <span className="charge-hud-label">Score</span>
          <span className="charge-hud-value">{score}</span>
        </div>
        <div className="charge-hud-item">
          <span className="charge-hud-label">Streak</span>
          <span className="charge-hud-value">{streak}</span>
        </div>
      </div>

      <div className="charge-canvas-wrap">
        <canvas ref={canvasRef} />
        <div ref={riderRef} className="charge-rider" aria-hidden="true">
          <MiiAvatar mii={mii} size={54} pose="idle" />
        </div>
        {banner && (
          <div key={banner.id} className="charge-banner">
            {banner.text}
          </div>
        )}
        {phase === "final" && (
          <div className="charge-final">
            <div className="charge-final-title">Run complete!</div>
            <div className="charge-final-score">{score} pts</div>
            <div className="charge-final-streak">Best streak: {bestStreak}</div>
            <div className="charge-final-sub">Returning to the Wii Menu…</div>
          </div>
        )}
      </div>

      <div className="charge-hint">
        Tilt forward/back to speed up or brake · tilt left/right to steer · flick up to jump · HOME to exit
      </div>
    </div>
  );
}
