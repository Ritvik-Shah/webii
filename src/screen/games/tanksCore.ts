// ---------------------------------------------------------------------------
// Tanks! shared core: arena geometry, shell/mine physics, and the drawing
// routines, with no React in sight. Both modes are built on this -- the
// solo campaign in Tanks.tsx and the multiplayer deathmatch in
// TanksVersus.tsx -- so the two play identically and neither has to import
// the other.
// ---------------------------------------------------------------------------

// Local, self-contained WebAudio chimes for this game only -- same
// oscillator + gain-envelope style as src/lib/sound.ts, but scoped here so
// this file doesn't need to touch that shared module.
let tanksAudioCtx: AudioContext | null = null;
export function tanksAudio(): AudioContext {
  if (!tanksAudioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    tanksAudioCtx = new Ctor();
  }
  if (tanksAudioCtx.state === "suspended") void tanksAudioCtx.resume();
  return tanksAudioCtx;
}

export function playShellFire() {
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

export function playExplosion() {
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

export interface WallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface LevelConfig {
  walls: WallRect[];
  playerSpawn: SpawnPoint;
  enemies: SpawnPoint[];
}

export interface PlayerState {
  x: number;
  y: number;
  alive: boolean;
  invulnTimer: number;
  respawnTimer: number;
  angle: number;
}

export interface EnemyState {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  target: SpawnPoint;
  patrolTimer: number;
  fireTimer: number;
  angle: number;
}

/** Everything a shell needs to fly and bounce. Who fired it differs between
 * modes -- the campaign only cares whether it was the player or an enemy,
 * while the deathmatch needs the player number -- so ownership is left to
 * the mode and the physics works on this. */
export interface MovingShell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounces: number;
  alive: boolean;
}

export interface ShellState extends MovingShell {
  owner: "player" | "enemy";
}

export interface MineState {
  x: number;
  y: number;
  armTimer: number;
  fuseTimer: number;
  alive: boolean;
}

export interface ExplosionState {
  x: number;
  y: number;
  timer: number;
  maxTimer: number;
  radius: number;
}

export type Phase = "playing" | "levelClear" | "gameOver" | "victory";

// --- Tuning constants --------------------------------------------------------

// Logical arena size (arbitrary units, not pixels) -- the canvas letterboxes
// this to fit whatever size/aspect the parent gives it, so gameplay tuning
// stays consistent regardless of screen size.
export const ARENA_W = 960;
export const ARENA_H = 600;

export const TANK_RADIUS = 18;
export const TANK_SPEED = 150;
export const ENEMY_SPEED = 95;

export const SHELL_SPEED = 430;
export const SHELL_RADIUS = 5;
export const MAX_BOUNCES = 3;

export const FIRE_COOLDOWN_MS = 350;
export const MINE_COOLDOWN_MS = 600;
export const MINE_MAX = 3;
export const MINE_RADIUS = 8;
export const MINE_ARM_TIME = 0.5;
export const MINE_FUSE_LIFETIME = 10;
export const MINE_BLAST_RADIUS = 56;

export const ENEMY_FIRE_MIN = 1.4;
export const ENEMY_FIRE_MAX = 2.8;
// How close (arena units) enemy and player need to be on the same row/column
// to count as "aligned" for a shot -- a little looser than tank radius so it
// doesn't require pixel-perfect alignment.
export const ALIGN_EPS = 26;

export const INVULN_TIME = 1.5;
export const RESPAWN_DELAY = 1.2;
export const LEVEL_CLEAR_DELAY = 1.8;
export const GAME_OVER_DELAY = 5;
export const VICTORY_DELAY = 6;

export const EXPLOSION_DURATION = 0.35;
export const START_LIVES = 3;

// --- Level data ---------------------------------------------------------
// Five hand-authored levels: walls + enemy spawns escalate in count/density.
// All coordinates are in arena units (0..ARENA_W, 0..ARENA_H).

export const LEVELS: LevelConfig[] = [
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

export function circleIntersectsRect(cx: number, cy: number, r: number, rect: WallRect): boolean {
  const closestX = Math.min(Math.max(cx, rect.x), rect.x + rect.w);
  const closestY = Math.min(Math.max(cy, rect.y), rect.y + rect.h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

export function blocked(cx: number, cy: number, r: number, walls: WallRect[]): boolean {
  if (cx - r < 0 || cx + r > ARENA_W || cy - r < 0 || cy + r > ARENA_H) return true;
  for (const w of walls) {
    if (circleIntersectsRect(cx, cy, r, w)) return true;
  }
  return false;
}

/** Moves a point by (dx, dy), resolving X and Y as independent collision
 * checks so sliding along a wall works instead of a diagonal bump halting
 * movement entirely. */
export function moveWithCollision(
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
export function updateShell(shell: MovingShell, dt: number, walls: WallRect[]) {
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
export function segmentClear(x1: number, y1: number, x2: number, y2: number, walls: WallRect[]): boolean {
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

export function pickPatrolTarget(walls: WallRect[]): SpawnPoint {
  const margin = TANK_RADIUS + 12;
  for (let i = 0; i < 12; i++) {
    const x = margin + Math.random() * (ARENA_W - margin * 2);
    const y = margin + Math.random() * (ARENA_H - margin * 2);
    if (!blocked(x, y, TANK_RADIUS, walls)) return { x, y };
  }
  return { x: ARENA_W / 2, y: ARENA_H / 2 };
}

// --- Rendering ---------------------------------------------------------------

export function drawTank(
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

/** `color` lets each mode tint shells by who fired them: the campaign
 * separates yours from the enemy's, the deathmatch uses each player's own
 * colour. */
export function drawShell(ctx: CanvasRenderingContext2D, shell: MovingShell, color: string) {
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(shell.x, shell.y, SHELL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

export const SHELL_COLOR_PLAYER = "#fff2b0";
export const SHELL_COLOR_ENEMY = "#ff8a5a";

export function drawMine(ctx: CanvasRenderingContext2D, mine: MineState) {
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

export function drawExplosion(ctx: CanvasRenderingContext2D, ex: ExplosionState) {
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

export function drawReticle(ctx: CanvasRenderingContext2D, x: number, y: number) {
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


// ---------------------------------------------------------------------------
// Deathmatch arena (see TanksVersus.tsx). Lives here so the layout can be
// checked without pulling React in.
// ---------------------------------------------------------------------------

/** Kept clear of walls so a respawn can never drop a tank inside one. */
export const SPAWNS = [
  { x: 90, y: 90 },
  { x: ARENA_W - 90, y: ARENA_H - 90 },
  { x: ARENA_W - 90, y: 90 },
  { x: 90, y: ARENA_H - 90 },
  // Two extra respawn points along the mid-edges, clear of the bars at
  // y=96 and y=478 (the first four are also the starting positions).
  { x: ARENA_W / 2, y: 52 },
  { x: ARENA_W / 2, y: ARENA_H - 52 },
];

/** Rotationally symmetric, so no spawn corner is better than another. */
export const VERSUS_WALLS: WallRect[] = [
  { x: ARENA_W / 2 - 40, y: ARENA_H / 2 - 40, w: 80, h: 80 },
  { x: 220, y: 150, w: 26, h: 150 },
  { x: ARENA_W - 246, y: ARENA_H - 300, w: 26, h: 150 },
  { x: 330, y: 96, w: 150, h: 26 },
  { x: ARENA_W - 480, y: ARENA_H - 122, w: 150, h: 26 },
  { x: 150, y: ARENA_H - 210, w: 130, h: 26 },
  { x: ARENA_W - 280, y: 184, w: 130, h: 26 },
  { x: 470, y: 330, w: 26, h: 130 },
  { x: ARENA_W - 496, y: ARENA_H - 460, w: 26, h: 130 },
];



/** The whole deathmatch as drawable state -- what a spectator screen is sent. */
export interface VersusWorld {
  tanks: Tank[];
  shells: VersusShell[];
  mines: VersusMine[];
  explosions: ExplosionState[];
}

export interface VersusShell extends MovingShell {
  owner: number;
}

export interface VersusMine extends MineState {
  owner: number;
}

export interface Tank {
  /** Room player number, which is also how shells and mines are attributed. */
  player: number;
  color: string;
  treadColor: string;
  x: number;
  y: number;
  angle: number;
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  score: number;
  lastFireAt: number;
  lastMineAt: number;
  /** Reticle position in arena units, driven by that player's pointer. */
  aimX: number;
  aimY: number;
  held: Set<string>;
}

/** Darker shade of the Mii's shirt, for the tank treads. */
export function treadShade(hex: string): string {
  const value = hex.replace("#", "");
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  const r = Math.round((num >> 16) * 0.55);
  const g = Math.round(((num >> 8) & 255) * 0.55);
  const b = Math.round((num & 255) * 0.55);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}


/** Draws a deathmatch frame. Pure: the host and every spectator mirror run
 * this over the same world and get the same picture. */
export function drawVersusWorld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  world: VersusWorld,
) {
      // Fit the fixed-size arena into whatever the display gives us.
      const scale = Math.min(width / ARENA_W, height / ARENA_H);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#1b2415";
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate((width - ARENA_W * scale) / 2, (height - ARENA_H * scale) / 2);
      ctx.scale(scale, scale);

      ctx.fillStyle = "#2e3d22";
      ctx.fillRect(0, 0, ARENA_W, ARENA_H);
      ctx.fillStyle = "#57694a";
      for (const wall of VERSUS_WALLS) ctx.fillRect(wall.x, wall.y, wall.w, wall.h);

      for (const mine of world.mines) drawMine(ctx, mine);
      for (const shell of world.shells) {
        const owner = world.tanks.find((t) => t.player === shell.owner);
        drawShell(ctx, shell, owner?.color ?? "#ffffff");
      }

      for (const tank of world.tanks) {
        if (!tank.alive) continue;
        // Faded rather than blinking while the respawn shield is up: every
        // tank starts a match invulnerable at once, and blinking made them
        // all vanish on the same frames.
        ctx.save();
        if (tank.invulnTimer > 0) ctx.globalAlpha = 0.45;
        const turret = Math.atan2(tank.aimY - tank.y, tank.aimX - tank.x);
        drawTank(ctx, tank.x, tank.y, tank.angle, turret, tank.color, tank.treadColor);
        // Player number above each tank, so you can find yourself in a scrum.
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`P${tank.player}`, tank.x, tank.y - TANK_RADIUS - 8);
        ctx.restore();
      }

      for (const ex of world.explosions) drawExplosion(ctx, ex);
      for (const tank of world.tanks) {
        if (tank.alive) drawReticle(ctx, tank.aimX, tank.aimY);
      }

      ctx.restore();
}

/** The solo campaign as drawable state -- what a spectator screen is sent. */
export interface CampaignWorld {
  walls: WallRect[];
  player: PlayerState;
  enemies: EnemyState[];
  shells: ShellState[];
  mines: MineState[];
  explosions: ExplosionState[];
  /** Where the player's reticle is, in arena coordinates. */
  aim: { x: number; y: number };
  /** Hides the reticle outside of play, e.g. on the level-clear card. */
  playing: boolean;
}

/** Draws a campaign frame. Pure: the host and any spectator mirror run this
 * over the same world and get the same picture. */
export function drawCampaignWorld(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  world: CampaignWorld,
) {
  const scale = Math.min(width / ARENA_W, height / ARENA_H);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#161c11";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate((width - ARENA_W * scale) / 2, (height - ARENA_H * scale) / 2);
  ctx.scale(scale, scale);

  ctx.fillStyle = "#28331f";
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  for (const w of world.walls) {
    ctx.fillStyle = "#7d8177";
    ctx.fillRect(w.x, w.y, w.w, w.h);
    ctx.strokeStyle = "#454940";
    ctx.lineWidth = 2;
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  }

  for (const mine of world.mines) drawMine(ctx, mine);

  for (const enemy of world.enemies) {
    if (enemy.alive) drawTank(ctx, enemy.x, enemy.y, enemy.angle, enemy.angle, "#c1503f", "#7a2f24");
  }

  const { player, aim } = world;
  if (player.alive) {
    const blinking = player.invulnTimer > 0 && Math.floor(player.invulnTimer * 10) % 2 === 0;
    if (!blinking) {
      const turretAngle = Math.atan2(aim.y - player.y, aim.x - player.x);
      drawTank(ctx, player.x, player.y, player.angle, turretAngle, "#4f8fd6", "#2a4f7a");
    }
  }

  for (const shell of world.shells) {
    drawShell(ctx, shell, shell.owner === "player" ? SHELL_COLOR_PLAYER : SHELL_COLOR_ENEMY);
  }
  for (const ex of world.explosions) drawExplosion(ctx, ex);
  if (world.playing) drawReticle(ctx, aim.x, aim.y);

  ctx.strokeStyle = "#12160f";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, ARENA_W - 6, ARENA_H - 6);

  ctx.restore();
}
