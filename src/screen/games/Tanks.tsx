import { useEffect, useRef, useState } from "react";
import "./tanks.css";
import type { GameProps } from "./types";
import { useGameCanvas } from "./useGameCanvas";
import { usePointerPosition } from "../usePointerGrid";
import { MiiAvatar } from "../mii/MiiAvatar";
import { playButtonBlip, playLaunchChime } from "../../lib/sound";

// ---------------------------------------------------------------------------
// Tanks! -- top-down arena shooter. Logic runs entirely in mutable refs each
// animation frame (no per-frame React state), matching the pattern
// useGameCanvas is built for; React state is only touched at meaningful
// transitions (lives lost, level cleared, phase changes) so the HUD/overlay
// re-renders without fighting the render loop.
// ---------------------------------------------------------------------------

// Local, self-contained WebAudio chimes for this game only -- same
// oscillator + gain-envelope style as src/lib/sound.ts, but scoped here so
// this file doesn't need to touch that shared module.
let tanksAudioCtx: AudioContext | null = null;
function tanksAudio(): AudioContext {
  if (!tanksAudioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    tanksAudioCtx = new Ctor();
  }
  if (tanksAudioCtx.state === "suspended") void tanksAudioCtx.resume();
  return tanksAudioCtx;
}

function playShellFire() {
  const audio = tanksAudio();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "square";
  const start = audio.currentTime;
  osc.frequency.setValueAtTime(520, start);
  osc.frequency.exponentialRampToValueAtTime(160, start + 0.12);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.linearRampToValueAtTime(0.11, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + 0.18);
}

function playExplosion() {
  const audio = tanksAudio();
  const start = audio.currentTime;
  for (const [freq, delay] of [
    [110, 0],
    [70, 0.02],
  ] as const) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, start + delay);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.3, start + delay + 0.3);
    gain.gain.setValueAtTime(0.001, start + delay);
    gain.gain.linearRampToValueAtTime(0.16, start + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.35);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(start + delay);
    osc.stop(start + delay + 0.4);
  }
}

// --- Arena / entity types ---------------------------------------------------

interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SpawnPoint {
  x: number;
  y: number;
}

interface LevelConfig {
  walls: WallRect[];
  playerSpawn: SpawnPoint;
  enemies: SpawnPoint[];
}

interface PlayerState {
  x: number;
  y: number;
  alive: boolean;
  invulnTimer: number;
  respawnTimer: number;
  angle: number;
}

interface EnemyState {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  target: SpawnPoint;
  patrolTimer: number;
  fireTimer: number;
  angle: number;
}

interface ShellState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number;
  alive: boolean;
  owner: "player" | "enemy";
}

interface MineState {
  x: number;
  y: number;
  armTimer: number;
  fuseTimer: number;
  alive: boolean;
}

interface ExplosionState {
  x: number;
  y: number;
  timer: number;
  maxTimer: number;
  radius: number;
}

type Phase = "playing" | "levelClear" | "gameOver" | "victory";

// --- Tuning constants --------------------------------------------------------

// Logical arena size (arbitrary units, not pixels) -- the canvas letterboxes
// this to fit whatever size/aspect the parent gives it, so gameplay tuning
// stays consistent regardless of screen size.
const ARENA_W = 960;
const ARENA_H = 600;

const TANK_RADIUS = 18;
const TANK_SPEED = 150;
const ENEMY_SPEED = 95;

const SHELL_SPEED = 430;
const SHELL_RADIUS = 5;
const MAX_BOUNCES = 3;

const FIRE_COOLDOWN_MS = 350;
const MINE_COOLDOWN_MS = 600;
const MINE_MAX = 3;
const MINE_RADIUS = 8;
const MINE_ARM_TIME = 0.5;
const MINE_FUSE_LIFETIME = 10;
const MINE_BLAST_RADIUS = 56;

const ENEMY_FIRE_MIN = 1.4;
const ENEMY_FIRE_MAX = 2.8;
// How close (arena units) enemy and player need to be on the same row/column
// to count as "aligned" for a shot -- a little looser than tank radius so it
// doesn't require pixel-perfect alignment.
const ALIGN_EPS = 26;

const INVULN_TIME = 1.5;
const RESPAWN_DELAY = 1.2;
const LEVEL_CLEAR_DELAY = 1.8;
const GAME_OVER_DELAY = 5;
const VICTORY_DELAY = 6;

const EXPLOSION_DURATION = 0.35;
const START_LIVES = 3;

// --- Level data ---------------------------------------------------------
// Five hand-authored levels: walls + enemy spawns escalate in count/density.
// All coordinates are in arena units (0..ARENA_W, 0..ARENA_H).

const LEVELS: LevelConfig[] = [
  // Level 1 -- open arena, a couple of cover blocks, two enemies.
  {
    walls: [
      { x: 440, y: 260, w: 80, h: 80 },
      { x: 150, y: 120, w: 140, h: 24 },
      { x: 670, y: 456, w: 140, h: 24 },
    ],
    playerSpawn: { x: 80, y: 520 },
    enemies: [
      { x: 860, y: 80 },
      { x: 860, y: 520 },
    ],
  },
  // Level 2 -- a loose cross of cover with a passable gap in the middle,
  // three enemies.
  {
    walls: [
      { x: 440, y: 70, w: 80, h: 190 },
      { x: 440, y: 340, w: 80, h: 190 },
      { x: 110, y: 280, w: 200, h: 40 },
      { x: 650, y: 280, w: 200, h: 40 },
    ],
    playerSpawn: { x: 80, y: 520 },
    enemies: [
      { x: 880, y: 70 },
      { x: 880, y: 300 },
      { x: 880, y: 530 },
    ],
  },
  // Level 3 -- small rooms with chokepoints, four enemies.
  {
    walls: [
      { x: 200, y: 0, w: 24, h: 220 },
      { x: 200, y: 380, w: 24, h: 220 },
      { x: 500, y: 150, w: 24, h: 300 },
      { x: 740, y: 0, w: 24, h: 220 },
      { x: 740, y: 380, w: 24, h: 220 },
      { x: 340, y: 260, w: 280, h: 24 },
    ],
    playerSpawn: { x: 80, y: 300 },
    enemies: [
      { x: 900, y: 80 },
      { x: 900, y: 300 },
      { x: 900, y: 520 },
      { x: 460, y: 50 },
    ],
  },
  // Level 4 -- winding corridors, five enemies.
  {
    walls: [
      { x: 120, y: 120, w: 280, h: 24 },
      { x: 120, y: 120, w: 24, h: 200 },
      { x: 560, y: 120, w: 280, h: 24 },
      { x: 816, y: 120, w: 24, h: 200 },
      { x: 300, y: 300, w: 24, h: 220 },
      { x: 636, y: 300, w: 24, h: 220 },
      { x: 300, y: 496, w: 360, h: 24 },
      { x: 460, y: 220, w: 40, h: 40 },
    ],
    playerSpawn: { x: 80, y: 540 },
    enemies: [
      { x: 880, y: 60 },
      { x: 880, y: 300 },
      { x: 880, y: 550 },
      { x: 480, y: 60 },
      { x: 60, y: 60 },
    ],
  },
  // Level 5 -- tight vertical-bar maze, six enemies, final level.
  {
    walls: [
      { x: 160, y: 0, w: 24, h: 180 },
      { x: 160, y: 280, w: 24, h: 320 },
      { x: 340, y: 100, w: 24, h: 400 },
      { x: 520, y: 0, w: 24, h: 220 },
      { x: 520, y: 340, w: 24, h: 260 },
      { x: 700, y: 100, w: 24, h: 400 },
      { x: 860, y: 0, w: 24, h: 180 },
      { x: 860, y: 280, w: 24, h: 320 },
    ],
    playerSpawn: { x: 80, y: 300 },
    enemies: [
      { x: 240, y: 60 },
      { x: 420, y: 550 },
      { x: 600, y: 60 },
      { x: 780, y: 550 },
      { x: 930, y: 180 },
      { x: 930, y: 430 },
    ],
  },
];

// --- Geometry / physics helpers ---------------------------------------------

function circleIntersectsRect(cx: number, cy: number, r: number, rect: WallRect): boolean {
  const closestX = Math.min(Math.max(cx, rect.x), rect.x + rect.w);
  const closestY = Math.min(Math.max(cy, rect.y), rect.y + rect.h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

function blocked(cx: number, cy: number, r: number, walls: WallRect[]): boolean {
  if (cx - r < 0 || cx + r > ARENA_W || cy - r < 0 || cy + r > ARENA_H) return true;
  for (const w of walls) {
    if (circleIntersectsRect(cx, cy, r, w)) return true;
  }
  return false;
}

/** Moves a point by (dx, dy), resolving X and Y as independent collision
 * checks so sliding along a wall works instead of a diagonal bump halting
 * movement entirely. */
function moveWithCollision(
  pos: { x: number; y: number },
  dx: number,
  dy: number,
  radius: number,
  walls: WallRect[],
) {
  const nx = pos.x + dx;
  if (!blocked(nx, pos.y, radius, walls)) pos.x = nx;
  const ny = pos.y + dy;
  if (!blocked(pos.x, ny, radius, walls)) pos.y = ny;
}

/** Advances a shell one frame, reflecting velocity per-axis on collision
 * (same simplified per-axis approach as tank movement above -- correct for
 * axis-aligned walls and the arena's outer bounds). */
function updateShell(shell: ShellState, dt: number, walls: WallRect[]) {
  const dx = shell.vx * dt;
  const dy = shell.vy * dt;

  const nx = shell.x + dx;
  if (blocked(nx, shell.y, SHELL_RADIUS, walls)) {
    shell.vx = -shell.vx;
    shell.bounces += 1;
  } else {
    shell.x = nx;
  }

  const ny = shell.y + dy;
  if (blocked(shell.x, ny, SHELL_RADIUS, walls)) {
    shell.vy = -shell.vy;
    shell.bounces += 1;
  } else {
    shell.y = ny;
  }

  if (shell.bounces > MAX_BOUNCES) shell.alive = false;
}

/** Simple point-sampled raycast: true if no wall lies on the segment. Not
 * pixel-perfect, but sufficient for "can this enemy see the player". */
function segmentClear(x1: number, y1: number, x2: number, y2: number, walls: WallRect[]): boolean {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(dist / 12));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    for (const w of walls) {
      if (px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h) return false;
    }
  }
  return true;
}

function pickPatrolTarget(walls: WallRect[]): SpawnPoint {
  const margin = TANK_RADIUS + 12;
  for (let i = 0; i < 12; i++) {
    const x = margin + Math.random() * (ARENA_W - margin * 2);
    const y = margin + Math.random() * (ARENA_H - margin * 2);
    if (!blocked(x, y, TANK_RADIUS, walls)) return { x, y };
  }
  return { x: ARENA_W / 2, y: ARENA_H / 2 };
}

// --- Rendering ---------------------------------------------------------------

function drawTank(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bodyAngle: number,
  turretAngle: number,
  bodyColor: string,
  treadColor: string,
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.save();
  ctx.rotate(bodyAngle);
  ctx.fillStyle = treadColor;
  ctx.fillRect(-TANK_RADIUS, -TANK_RADIUS * 0.85, TANK_RADIUS * 2, TANK_RADIUS * 1.7);
  ctx.restore();

  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(0, 0, TANK_RADIUS * 0.72, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.rotate(turretAngle);
  ctx.fillStyle = "#20241f";
  ctx.fillRect(0, -3, TANK_RADIUS + 12, 6);
  ctx.restore();

  ctx.restore();
}

function drawShell(ctx: CanvasRenderingContext2D, shell: ShellState) {
  ctx.beginPath();
  ctx.fillStyle = shell.owner === "player" ? "#fff2b0" : "#ff8a5a";
  ctx.arc(shell.x, shell.y, SHELL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function drawMine(ctx: CanvasRenderingContext2D, mine: MineState) {
  const armed = mine.armTimer <= 0;
  const urgent = armed && mine.fuseTimer < 3 && Math.floor(mine.fuseTimer * 6) % 2 === 0;
  ctx.beginPath();
  ctx.fillStyle = !armed ? "#8a8a5a" : urgent ? "#ff3b3b" : "#c4a13b";
  ctx.arc(mine.x, mine.y, MINE_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawExplosion(ctx: CanvasRenderingContext2D, ex: ExplosionState) {
  const t = 1 - ex.timer / ex.maxTimer;
  const radius = ex.radius * t;
  ctx.beginPath();
  ctx.strokeStyle = `rgba(255, 170, 60, ${1 - t})`;
  ctx.lineWidth = 4;
  ctx.arc(ex.x, ex.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = `rgba(255, 220, 120, ${(1 - t) * 0.5})`;
  ctx.arc(ex.x, ex.y, radius * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = "#f5f5f5";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 18, y);
  ctx.lineTo(x - 6, y);
  ctx.moveTo(x + 6, y);
  ctx.lineTo(x + 18, y);
  ctx.moveTo(x, y - 18);
  ctx.lineTo(x, y - 6);
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x, y + 18);
  ctx.stroke();
  ctx.restore();
}

// --- Component ----------------------------------------------------------

export function Tanks({ send: _send, subscribe, onExit, mii }: GameProps) {
  const [phase, setPhaseState] = useState<Phase>("playing");
  const [lives, setLivesState] = useState(START_LIVES);
  const [levelIndex, setLevelIndexState] = useState(0);

  // Ref mirrors of the above, read by the frame loop for control flow so
  // there's no one-frame lag waiting on React's async re-render.
  const phaseRef = useRef<Phase>("playing");
  const livesRef = useRef(START_LIVES);
  const levelIndexRef = useRef(0);

  function setPhase(p: Phase) {
    phaseRef.current = p;
    setPhaseState(p);
  }
  function setLives(n: number) {
    livesRef.current = n;
    setLivesState(n);
  }
  function setLevelIndex(n: number) {
    levelIndexRef.current = n;
    setLevelIndexState(n);
  }

  const playerRef = useRef<PlayerState>({
    x: LEVELS[0].playerSpawn.x,
    y: LEVELS[0].playerSpawn.y,
    alive: true,
    invulnTimer: INVULN_TIME,
    respawnTimer: 0,
    angle: -Math.PI / 2,
  });
  const enemiesRef = useRef<EnemyState[]>([]);
  const wallsRef = useRef<WallRect[]>(LEVELS[0].walls);
  const shellsRef = useRef<ShellState[]>([]);
  const minesRef = useRef<MineState[]>([]);
  const explosionsRef = useRef<ExplosionState[]>([]);

  const bannerTimerRef = useRef(0);
  const exitCalledRef = useRef(false);

  const heldKeysRef = useRef<Set<"UP" | "DOWN" | "LEFT" | "RIGHT">>(new Set());
  const lastFireAtRef = useRef(0);
  const lastMineAtRef = useRef(0);

  const reticleRef = usePointerPosition(subscribe);

  function loadLevel(index: number) {
    const level = LEVELS[index];
    wallsRef.current = level.walls;
    enemiesRef.current = level.enemies.map((spawn, i) => ({
      id: i,
      x: spawn.x,
      y: spawn.y,
      alive: true,
      target: { x: spawn.x, y: spawn.y },
      patrolTimer: 0,
      fireTimer: ENEMY_FIRE_MIN + Math.random() * (ENEMY_FIRE_MAX - ENEMY_FIRE_MIN),
      angle: 0,
    }));
    shellsRef.current = [];
    minesRef.current = [];
    explosionsRef.current = [];
    playerRef.current = {
      x: level.playerSpawn.x,
      y: level.playerSpawn.y,
      alive: true,
      invulnTimer: INVULN_TIME,
      respawnTimer: 0,
      angle: -Math.PI / 2,
    };
    bannerTimerRef.current = 0;
  }

  // Mount: load level 1. Nothing here needs cleanup -- it's a one-shot ref
  // reset, not a subscription or timer.
  useEffect(() => {
    loadLevel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reticleArenaPos() {
    const r = reticleRef.current;
    return { x: (r.x / 100) * ARENA_W, y: (r.y / 100) * ARENA_H };
  }

  function fireShell() {
    if (phaseRef.current !== "playing") return;
    const player = playerRef.current;
    if (!player.alive) return;
    const now = performance.now();
    if (now - lastFireAtRef.current < FIRE_COOLDOWN_MS) return;
    lastFireAtRef.current = now;

    const target = reticleArenaPos();
    const angle = Math.atan2(target.y - player.y, target.x - player.x);
    const spawnDist = TANK_RADIUS + SHELL_RADIUS + 2;
    shellsRef.current.push({
      x: player.x + Math.cos(angle) * spawnDist,
      y: player.y + Math.sin(angle) * spawnDist,
      vx: Math.cos(angle) * SHELL_SPEED,
      vy: Math.sin(angle) * SHELL_SPEED,
      bounces: 0,
      alive: true,
      owner: "player",
    });
    playShellFire();
  }

  function dropMine() {
    if (phaseRef.current !== "playing") return;
    const player = playerRef.current;
    if (!player.alive) return;
    const now = performance.now();
    if (now - lastMineAtRef.current < MINE_COOLDOWN_MS) return;
    const activeMines = minesRef.current.filter((m) => m.alive).length;
    if (activeMines >= MINE_MAX) return;
    lastMineAtRef.current = now;
    minesRef.current.push({
      x: player.x,
      y: player.y,
      armTimer: MINE_ARM_TIME,
      fuseTimer: MINE_FUSE_LIFETIME,
      alive: true,
    });
    playButtonBlip();
  }

  function hitPlayer() {
    const player = playerRef.current;
    if (!player.alive || player.invulnTimer > 0) return;
    player.alive = false;
    playExplosion();
    const nextLives = Math.max(0, livesRef.current - 1);
    setLives(nextLives);
    if (nextLives <= 0) {
      setPhase("gameOver");
      bannerTimerRef.current = GAME_OVER_DELAY;
    } else {
      player.respawnTimer = RESPAWN_DELAY;
    }
  }

  // Controller input: D-pad held-state (continuous movement), B (fire,
  // edge-triggered), TWO (mine, edge-triggered). Aim comes from
  // usePointerPosition above, not from here.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== "button") return;
      switch (msg.button) {
        case "UP":
        case "DOWN":
        case "LEFT":
        case "RIGHT":
          if (msg.state === "down") heldKeysRef.current.add(msg.button);
          else heldKeysRef.current.delete(msg.button);
          break;
        case "B":
          if (msg.state === "down") fireShell();
          break;
        case "TWO":
          if (msg.state === "down") dropMine();
          break;
        default:
          break;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  function simulate(dt: number) {
    const walls = wallsRef.current;
    const player = playerRef.current;
    const enemies = enemiesRef.current;

    // --- player movement ---
    if (player.alive) {
      let dx = 0;
      let dy = 0;
      const held = heldKeysRef.current;
      if (held.has("UP")) dy -= 1;
      if (held.has("DOWN")) dy += 1;
      if (held.has("LEFT")) dx -= 1;
      if (held.has("RIGHT")) dx += 1;
      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        dx /= len;
        dy /= len;
        moveWithCollision(player, dx * TANK_SPEED * dt, dy * TANK_SPEED * dt, TANK_RADIUS, walls);
        player.angle = Math.atan2(dy, dx);
      }
      if (player.invulnTimer > 0) player.invulnTimer = Math.max(0, player.invulnTimer - dt);
    } else if (player.respawnTimer > 0) {
      player.respawnTimer = Math.max(0, player.respawnTimer - dt);
      if (player.respawnTimer === 0) {
        const spawn = LEVELS[levelIndexRef.current].playerSpawn;
        player.x = spawn.x;
        player.y = spawn.y;
        player.alive = true;
        player.invulnTimer = INVULN_TIME;
      }
    }

    // --- enemy patrol + fire ---
    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      enemy.patrolTimer -= dt;
      const ddx = enemy.target.x - enemy.x;
      const ddy = enemy.target.y - enemy.y;
      const d = Math.hypot(ddx, ddy);
      if (d < 14 || enemy.patrolTimer <= 0) {
        enemy.target = pickPatrolTarget(walls);
        enemy.patrolTimer = 4 + Math.random() * 3;
      } else {
        const nx = ddx / d;
        const ny = ddy / d;
        moveWithCollision(enemy, nx * ENEMY_SPEED * dt, ny * ENEMY_SPEED * dt, TANK_RADIUS, walls);
        enemy.angle = Math.atan2(ddy, ddx);
      }

      enemy.fireTimer -= dt;
      if (enemy.fireTimer <= 0 && player.alive) {
        const alignedX = Math.abs(enemy.x - player.x) < ALIGN_EPS;
        const alignedY = Math.abs(enemy.y - player.y) < ALIGN_EPS;
        if ((alignedX || alignedY) && segmentClear(enemy.x, enemy.y, player.x, player.y, walls)) {
          const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
          const spawnDist = TANK_RADIUS + SHELL_RADIUS + 2;
          shellsRef.current.push({
            x: enemy.x + Math.cos(angle) * spawnDist,
            y: enemy.y + Math.sin(angle) * spawnDist,
            vx: Math.cos(angle) * SHELL_SPEED,
            vy: Math.sin(angle) * SHELL_SPEED,
            bounces: 0,
            alive: true,
            owner: "enemy",
          });
          enemy.fireTimer = ENEMY_FIRE_MIN + Math.random() * (ENEMY_FIRE_MAX - ENEMY_FIRE_MIN);
        } else {
          enemy.fireTimer = 0.35;
        }
      }
    }

    // --- shells: move, bounce, hit ---
    const shells = shellsRef.current;
    for (const shell of shells) {
      if (!shell.alive) continue;
      updateShell(shell, dt, walls);
      if (!shell.alive) continue;

      if (shell.owner === "player") {
        for (const enemy of enemies) {
          if (!enemy.alive) continue;
          if (Math.hypot(shell.x - enemy.x, shell.y - enemy.y) < SHELL_RADIUS + TANK_RADIUS) {
            enemy.alive = false;
            shell.alive = false;
            explosionsRef.current.push({ x: enemy.x, y: enemy.y, timer: EXPLOSION_DURATION, maxTimer: EXPLOSION_DURATION, radius: 30 });
            playExplosion();
            break;
          }
        }
      } else if (player.alive && player.invulnTimer <= 0) {
        if (Math.hypot(shell.x - player.x, shell.y - player.y) < SHELL_RADIUS + TANK_RADIUS) {
          shell.alive = false;
          hitPlayer();
        }
      }
    }
    shellsRef.current = shells.filter((s) => s.alive);

    // --- mines: arm, fuse, detonate ---
    const mines = minesRef.current;
    for (const mine of mines) {
      if (!mine.alive) continue;
      if (mine.armTimer > 0) {
        mine.armTimer = Math.max(0, mine.armTimer - dt);
        continue;
      }
      mine.fuseTimer -= dt;
      let detonate = mine.fuseTimer <= 0;
      if (!detonate && player.alive && player.invulnTimer <= 0) {
        if (Math.hypot(mine.x - player.x, mine.y - player.y) < MINE_RADIUS + TANK_RADIUS) detonate = true;
      }
      if (!detonate) {
        for (const enemy of enemies) {
          if (enemy.alive && Math.hypot(mine.x - enemy.x, mine.y - enemy.y) < MINE_RADIUS + TANK_RADIUS) {
            detonate = true;
            break;
          }
        }
      }
      if (detonate) {
        mine.alive = false;
        explosionsRef.current.push({ x: mine.x, y: mine.y, timer: EXPLOSION_DURATION, maxTimer: EXPLOSION_DURATION, radius: MINE_BLAST_RADIUS });
        playExplosion();
        if (player.alive && player.invulnTimer <= 0 && Math.hypot(mine.x - player.x, mine.y - player.y) < MINE_BLAST_RADIUS + TANK_RADIUS) {
          hitPlayer();
        }
        for (const enemy of enemies) {
          if (enemy.alive && Math.hypot(mine.x - enemy.x, mine.y - enemy.y) < MINE_BLAST_RADIUS + TANK_RADIUS) {
            enemy.alive = false;
          }
        }
      }
    }
    minesRef.current = mines.filter((m) => m.alive);

    // --- explosions: fade out ---
    explosionsRef.current = explosionsRef.current.filter((e) => {
      e.timer -= dt;
      return e.timer > 0;
    });

    // --- level clear check ---
    if (enemies.length > 0 && enemies.every((e) => !e.alive)) {
      const isLast = levelIndexRef.current >= LEVELS.length - 1;
      playLaunchChime();
      if (isLast) {
        // Real Tanks! awards a 1-up every 5 levels cleared -- with only 5
        // levels here, that fires exactly once, right at the finish.
        setLives(livesRef.current + 1);
        setPhase("victory");
        bannerTimerRef.current = VICTORY_DELAY;
      } else {
        setPhase("levelClear");
        bannerTimerRef.current = LEVEL_CLEAR_DELAY;
      }
    }
  }

  function draw(ctx: CanvasRenderingContext2D, dt: number, width: number, height: number) {
    const scale = Math.min(width / ARENA_W, height / ARENA_H);
    const offsetX = (width - ARENA_W * scale) / 2;
    const offsetY = (height - ARENA_H * scale) / 2;

    ctx.fillStyle = "#0a0e0a";
    ctx.fillRect(0, 0, width, height);

    if (phaseRef.current === "playing") {
      simulate(dt);
    } else {
      bannerTimerRef.current -= dt;
      if (bannerTimerRef.current <= 0) {
        if (phaseRef.current === "levelClear") {
          const next = levelIndexRef.current + 1;
          loadLevel(next);
          setLevelIndex(next);
          setPhase("playing");
        } else if (!exitCalledRef.current) {
          exitCalledRef.current = true;
          onExit();
        }
      }
    }

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // arena floor
    ctx.fillStyle = "#28331f";
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);

    // walls
    for (const w of wallsRef.current) {
      ctx.fillStyle = "#7d8177";
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = "#454940";
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    for (const mine of minesRef.current) drawMine(ctx, mine);

    for (const enemy of enemiesRef.current) {
      if (enemy.alive) drawTank(ctx, enemy.x, enemy.y, enemy.angle, enemy.angle, "#c1503f", "#7a2f24");
    }

    const player = playerRef.current;
    const target = reticleArenaPos();
    if (player.alive) {
      const blinking = player.invulnTimer > 0 && Math.floor(player.invulnTimer * 10) % 2 === 0;
      if (!blinking) {
        const turretAngle = Math.atan2(target.y - player.y, target.x - player.x);
        drawTank(ctx, player.x, player.y, player.angle, turretAngle, "#4f8fd6", "#2a4f7a");
      }
    }

    for (const shell of shellsRef.current) drawShell(ctx, shell);
    for (const ex of explosionsRef.current) drawExplosion(ctx, ex);

    if (phaseRef.current === "playing") drawReticle(ctx, target.x, target.y);

    ctx.strokeStyle = "#12160f";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, ARENA_W - 6, ARENA_H - 6);

    ctx.restore();
  }

  const canvasRef = useGameCanvas(draw);

  return (
    <div className="tanks-root">
      <div className="tanks-canvas-wrap">
        <canvas ref={canvasRef} className="tanks-canvas" />
      </div>

      <div className="tanks-hud-lives">
        <span className="tanks-hud-label">Lives</span>
        <span className="tanks-hud-value">x{lives}</span>
      </div>

      <div className="tanks-hud-level">
        <span className="tanks-hud-label">Level</span>
        <span className="tanks-hud-value">
          {levelIndex + 1} / {LEVELS.length}
        </span>
      </div>

      <div className="tanks-hud-mii">
        <MiiAvatar mii={mii} size={52} pose="idle" />
      </div>

      {phase !== "playing" && (
        <div className="tanks-overlay">
          {phase === "levelClear" && <div className="tanks-banner">Level {levelIndex + 1} Clear!</div>}
          {phase === "gameOver" && (
            <div className="tanks-banner tanks-banner-bad">
              Game Over
              <span className="tanks-banner-sub">Reached Level {levelIndex + 1}</span>
            </div>
          )}
          {phase === "victory" && (
            <div className="tanks-banner tanks-banner-good">
              1-UP! All 5 Levels Cleared!
              <span className="tanks-banner-sub">Great shooting, Commander</span>
            </div>
          )}
        </div>
      )}

      <div className="tanks-hint">D-pad move · point to aim · B fire · 2 lay mine · HOME to exit</div>
    </div>
  );
}
