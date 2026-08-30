import { useEffect, useRef, useState } from "react";
import "./tanks.css";
import type { GameProps } from "./types";
import type { Mii } from "../mii/Mii";
import { TanksVersus } from "./TanksVersus";
import { useGameCanvas } from "./useGameCanvas";
import { usePointerPosition } from "../usePointerGrid";
import { MiiAvatar } from "../mii/MiiAvatar";
import { playButtonBlip, playLaunchChime } from "../../lib/sound";
import {
  ALIGN_EPS,
  ARENA_H,
  ARENA_W,
  ENEMY_FIRE_MAX,
  ENEMY_FIRE_MIN,
  ENEMY_SPEED,
  EXPLOSION_DURATION,
  EnemyState,
  ExplosionState,
  FIRE_COOLDOWN_MS,
  GAME_OVER_DELAY,
  INVULN_TIME,
  LEVELS,
  LEVEL_CLEAR_DELAY,
  MINE_ARM_TIME,
  MINE_BLAST_RADIUS,
  MINE_COOLDOWN_MS,
  MINE_FUSE_LIFETIME,
  MINE_MAX,
  MINE_RADIUS,
  MineState,
  Phase,
  PlayerState,
  RESPAWN_DELAY,
  SHELL_RADIUS,
  SHELL_SPEED,
  START_LIVES,
  ShellState,
  TANK_RADIUS,
  TANK_SPEED,
  VICTORY_DELAY,
  WallRect,
  drawExplosion,
  drawMine,
  drawReticle,
  drawShell,
  SHELL_COLOR_PLAYER,
  SHELL_COLOR_ENEMY,
  drawTank,
  moveWithCollision,
  pickPatrolTarget,
  playExplosion,
  playShellFire,
  segmentClear,
  updateShell
} from "./tanksCore";

// ---------------------------------------------------------------------------
// Tanks! solo campaign -- fight through the levels in tanksCore's LEVELS.
// Logic runs entirely in mutable refs each animation frame (no per-frame
// React state), matching the pattern useGameCanvas is built for; React state
// is only touched at meaningful transitions (lives lost, level cleared,
// phase changes) so the HUD/overlay re-renders without fighting the loop.
// ---------------------------------------------------------------------------

// --- Component ----------------------------------------------------------

function TanksCampaign({ subscribe, onExit, mii }: { subscribe: GameProps["subscribe"]; onExit: () => void; mii: Mii }) {
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

    for (const shell of shellsRef.current) drawShell(ctx, shell, shell.owner === "player" ? SHELL_COLOR_PLAYER : SHELL_COLOR_ENEMY);
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

/**
 * Tanks! is two different games depending on who's in the room: solo, it's
 * the level-clearing campaign it has always been; with anyone else, it's a
 * free-for-all deathmatch where everyone drives at once.
 */
export function Tanks({ send, subscribe, onExit, players }: GameProps) {
  if (players.length > 1) {
    return <TanksVersus players={players} subscribe={subscribe} send={send} onExit={onExit} />;
  }
  return <TanksCampaign subscribe={subscribe} onExit={onExit} mii={players[0].mii} />;
}
