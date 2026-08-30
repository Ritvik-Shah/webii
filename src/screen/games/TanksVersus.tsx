import { useCallback, useEffect, useRef, useState } from "react";
import "./tanks.css";
import { SNAPSHOT_HZ, type ControllerMessage } from "../../../shared/protocol";
import { POINTER_SENSITIVITY } from "../usePointerGrid";
import { playLaunchChime } from "../../lib/sound";
import type { PlayerInfo } from "./types";
import { TanksVersusHud, type VersusHudState } from "./TanksVersusHud";
import { useGameCanvas } from "./useGameCanvas";
import {
  ARENA_H,
  ARENA_W,
  EXPLOSION_DURATION,
  FIRE_COOLDOWN_MS,
  INVULN_TIME,
  MINE_ARM_TIME,
  MINE_BLAST_RADIUS,
  MINE_COOLDOWN_MS,
  MINE_FUSE_LIFETIME,
  MINE_MAX,
  MINE_RADIUS,
  RESPAWN_DELAY,
  SHELL_RADIUS,
  SHELL_SPEED,
  TANK_RADIUS,
  TANK_SPEED,
  blocked,
  moveWithCollision,
  playExplosion,
  playShellFire,
  updateShell,
  drawVersusWorld,
  treadShade,
  SPAWNS,
  VERSUS_WALLS,
  type Tank,
  type VersusMine,
  type VersusShell,
  type VersusWorld,
  type ExplosionState,
} from "./tanksCore";

// ---------------------------------------------------------------------------
// Tanks! deathmatch -- everyone drives at once rather than taking turns.
//
// Kills score a point, dying costs nothing, and a shell that comes back
// around and hits its own firer costs them one. Respawns are quick and
// nobody is ever eliminated, so a four-player match has all four playing for
// the whole clock instead of watching each other.
// ---------------------------------------------------------------------------

const MATCH_SECONDS = 90;
const COUNTDOWN_SECONDS = 3;
function makeTank(info: PlayerInfo, index: number): Tank {
  const spawn = SPAWNS[index % SPAWNS.length];
  return {
    player: info.player,
    color: info.mii.shirtColor,
    treadColor: treadShade(info.mii.shirtColor),
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    alive: true,
    respawnTimer: 0,
    invulnTimer: INVULN_TIME,
    score: 0,
    lastFireAt: 0,
    lastMineAt: 0,
    aimX: ARENA_W / 2,
    aimY: ARENA_H / 2,
    held: new Set<string>(),
  };
}

/** Respawn as far as possible from anyone still alive, so a player can't
 * simply camp a spawn point. */
function bestSpawn(tanks: Tank[], self: Tank): { x: number; y: number } {
  let best = SPAWNS[0];
  let bestDistance = -1;
  for (const spawn of SPAWNS) {
    if (blocked(spawn.x, spawn.y, TANK_RADIUS, VERSUS_WALLS)) continue;
    let nearest = Infinity;
    for (const other of tanks) {
      if (other === self || !other.alive) continue;
      nearest = Math.min(nearest, Math.hypot(other.x - spawn.x, other.y - spawn.y));
    }
    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = spawn;
    }
  }
  return best;
}

/** What a spectator screen is sent each frame. */
export interface TanksVersusSnapshot {
  kind: "versus";
  world: VersusWorld;
  hud: VersusHudState;
  players: PlayerInfo[];
}

interface TanksVersusProps {
  players: PlayerInfo[];
  publish: (state: unknown) => void;
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void;
  send: (msg: object) => void;
  onExit: () => void;
}

export function TanksVersus({ players, subscribe, send, onExit, publish }: TanksVersusProps) {
  const tanksRef = useRef<Tank[]>(players.map(makeTank));
  const shellsRef = useRef<VersusShell[]>([]);
  const minesRef = useRef<VersusMine[]>([]);
  const explosionsRef = useRef<ExplosionState[]>([]);
  const clockRef = useRef({ countdown: COUNTDOWN_SECONDS, remaining: MATCH_SECONDS });

  const [phase, setPhase] = useState<"countdown" | "playing" | "over">("countdown");
  const [scores, setScores] = useState<number[]>(() => players.map(() => 0));
  const [timeLeft, setTimeLeft] = useState(MATCH_SECONDS);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Mirrored for the snapshot, which is built inside the render loop.
  const scoresRef = useRef(scores);
  scoresRef.current = scores;
  const timeLeftRef = useRef(timeLeft);
  timeLeftRef.current = timeLeft;
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const lastPublishRef = useRef(0);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const sendRef = useRef(send);
  sendRef.current = send;

  const tankFor = useCallback((player: number) => tanksRef.current.find((t) => t.player === player), []);

  // Everyone plays at once, so no phone is ever "waiting its turn".
  useEffect(() => {
    sendRef.current({ type: "turn", player: 0, label: "Tanks! deathmatch" });
    return () => sendRef.current({ type: "turn", player: 0 });
  }, []);

  const fire = useCallback(
    (tank: Tank) => {
      const now = performance.now();
      if (!tank.alive || now - tank.lastFireAt < FIRE_COOLDOWN_MS) return;
      tank.lastFireAt = now;
      const angle = Math.atan2(tank.aimY - tank.y, tank.aimX - tank.x);
      shellsRef.current.push({
        x: tank.x + Math.cos(angle) * (TANK_RADIUS + 8),
        y: tank.y + Math.sin(angle) * (TANK_RADIUS + 8),
        vx: Math.cos(angle) * SHELL_SPEED,
        vy: Math.sin(angle) * SHELL_SPEED,
        bounces: 0,
        alive: true,
        owner: tank.player,
      });
      playShellFire();
      sendRef.current({ type: "haptic", pattern: [12], to: tank.player });
    },
    [],
  );

  const dropMine = useCallback((tank: Tank) => {
    const now = performance.now();
    const own = minesRef.current.filter((m) => m.owner === tank.player && m.alive).length;
    if (!tank.alive || own >= MINE_MAX || now - tank.lastMineAt < MINE_COOLDOWN_MS) return;
    tank.lastMineAt = now;
    minesRef.current.push({
      x: tank.x,
      y: tank.y,
      armTimer: MINE_ARM_TIME,
      fuseTimer: MINE_FUSE_LIFETIME,
      alive: true,
      owner: tank.player,
    });
  }, []);

  // One subscription for the whole match: each frame is routed to the tank
  // belonging to the player it was stamped with.
  useEffect(() => {
    return subscribe((msg, player) => {
      const tank = tankFor(player);
      if (!tank) return;

      if (msg.type === "pointer") {
        // Same absolute point-and-aim mapping the other games use, scaled
        // into arena coordinates.
        const px = Math.min(100, Math.max(0, 50 + msg.ox * POINTER_SENSITIVITY));
        const py = Math.min(100, Math.max(0, 50 + msg.oy * POINTER_SENSITIVITY));
        tank.aimX = (px / 100) * ARENA_W;
        tank.aimY = (py / 100) * ARENA_H;
        return;
      }
      if (msg.type === "recenter") {
        tank.aimX = ARENA_W / 2;
        tank.aimY = ARENA_H / 2;
        return;
      }
      if (msg.type !== "button") return;

      if (phaseRef.current === "over") {
        if (msg.button === "A" && msg.state === "down") onExitRef.current();
        return;
      }

      switch (msg.button) {
        case "UP":
        case "DOWN":
        case "LEFT":
        case "RIGHT":
          if (msg.state === "down") tank.held.add(msg.button);
          else tank.held.delete(msg.button);
          break;
        case "B":
          if (msg.state === "down" && phaseRef.current === "playing") fire(tank);
          break;
        case "TWO":
          if (msg.state === "down" && phaseRef.current === "playing") dropMine(tank);
          break;
        default:
          break;
      }
    });
  }, [subscribe, tankFor, fire, dropMine]);

  /** Kill `victim`, credit `killer` (or dock them if they killed themselves). */
  const destroy = useCallback((victim: Tank, killerPlayer: number) => {
    if (!victim.alive || victim.invulnTimer > 0) return;
    victim.alive = false;
    victim.respawnTimer = RESPAWN_DELAY;
    victim.held.clear();
    explosionsRef.current.push({
      x: victim.x,
      y: victim.y,
      timer: EXPLOSION_DURATION,
      maxTimer: EXPLOSION_DURATION,
      radius: TANK_RADIUS * 2.2,
    });
    playExplosion();
    const killer = tanksRef.current.find((t) => t.player === killerPlayer);
    if (killer) killer.score += killer === victim ? -1 : 1;
    setScores(tanksRef.current.map((t) => t.score));
  }, []);

  const step = useCallback(
    (dt: number) => {
      const clock = clockRef.current;
      const tanks = tanksRef.current;

      if (phaseRef.current === "countdown") {
        clock.countdown -= dt;
        const shown = Math.max(0, Math.ceil(clock.countdown));
        setCountdown((prev) => (prev === shown ? prev : shown));
        if (clock.countdown <= 0) {
          setPhase("playing");
          playLaunchChime();
        }
        return;
      }
      if (phaseRef.current !== "playing") return;

      clock.remaining -= dt;
      const wholeSeconds = Math.max(0, Math.ceil(clock.remaining));
      setTimeLeft((prev) => (prev === wholeSeconds ? prev : wholeSeconds));
      if (clock.remaining <= 0) {
        setPhase("over");
        sendRef.current({ type: "turn", player: 0 });
        return;
      }

      // --- tanks ---
      for (const tank of tanks) {
        if (!tank.alive) {
          tank.respawnTimer -= dt;
          if (tank.respawnTimer <= 0) {
            const spawn = bestSpawn(tanks, tank);
            tank.x = spawn.x;
            tank.y = spawn.y;
            tank.alive = true;
            tank.invulnTimer = INVULN_TIME;
          }
          continue;
        }
        if (tank.invulnTimer > 0) tank.invulnTimer = Math.max(0, tank.invulnTimer - dt);

        let dx = 0;
        let dy = 0;
        if (tank.held.has("UP")) dy -= 1;
        if (tank.held.has("DOWN")) dy += 1;
        if (tank.held.has("LEFT")) dx -= 1;
        if (tank.held.has("RIGHT")) dx += 1;
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy);
          dx /= len;
          dy /= len;
          moveWithCollision(tank, dx * TANK_SPEED * dt, dy * TANK_SPEED * dt, TANK_RADIUS, VERSUS_WALLS);
          tank.angle = Math.atan2(dy, dx);
        }
      }

      // --- shells ---
      for (const shell of shellsRef.current) {
        if (!shell.alive) continue;
        updateShell(shell, dt, VERSUS_WALLS);
        if (!shell.alive) continue;
        for (const tank of tanks) {
          if (!tank.alive || tank.invulnTimer > 0) continue;
          if (Math.hypot(tank.x - shell.x, tank.y - shell.y) > TANK_RADIUS + SHELL_RADIUS) continue;
          shell.alive = false;
          destroy(tank, shell.owner);
          break;
        }
      }
      shellsRef.current = shellsRef.current.filter((s) => s.alive);

      // --- mines ---
      for (const mine of minesRef.current) {
        if (!mine.alive) continue;
        if (mine.armTimer > 0) mine.armTimer -= dt;
        mine.fuseTimer -= dt;
        const armed = mine.armTimer <= 0;
        const triggered =
          armed &&
          tanks.some(
            (t) => t.alive && t.invulnTimer <= 0 && Math.hypot(t.x - mine.x, t.y - mine.y) < TANK_RADIUS + MINE_RADIUS,
          );
        if (!triggered && mine.fuseTimer > 0) continue;

        mine.alive = false;
        explosionsRef.current.push({
          x: mine.x,
          y: mine.y,
          timer: EXPLOSION_DURATION,
          maxTimer: EXPLOSION_DURATION,
          radius: MINE_BLAST_RADIUS,
        });
        playExplosion();
        for (const tank of tanks) {
          if (!tank.alive || tank.invulnTimer > 0) continue;
          if (Math.hypot(tank.x - mine.x, tank.y - mine.y) < MINE_BLAST_RADIUS) destroy(tank, mine.owner);
        }
      }
      minesRef.current = minesRef.current.filter((m) => m.alive);

      // --- explosions ---
      for (const ex of explosionsRef.current) ex.timer -= dt;
      explosionsRef.current = explosionsRef.current.filter((ex) => ex.timer > 0);
    },
    [destroy],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, dt: number, width: number, height: number) => {
      step(dt);
      const world: VersusWorld = {
        tanks: tanksRef.current,
        shells: shellsRef.current,
        mines: minesRef.current,
        explosions: explosionsRef.current,
      };
      drawVersusWorld(ctx, width, height, world);

      // Mirror the match to any spectator screens.
      const now = performance.now();
      if (now - lastPublishRef.current >= 1000 / SNAPSHOT_HZ) {
        lastPublishRef.current = now;
        publishRef.current({
          world,
          hud: { scores: scoresRef.current, timeLeft: timeLeftRef.current, phase: phaseRef.current, countdown: countdownRef.current, matchSeconds: MATCH_SECONDS },
          players,
          kind: "versus",
        } satisfies TanksVersusSnapshot);
      }
    },
    [step, players],
  );

  const canvasRef = useGameCanvas(draw);

  useEffect(() => {
    if (phase !== "over") return;
    const timer = window.setTimeout(() => onExitRef.current(), 20000);
    return () => window.clearTimeout(timer);
  }, [phase]);


  return (
    <div className="tanks-root">
      <div className="tanks-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
      <TanksVersusHud
        players={players}
        hud={{ scores, timeLeft, phase, countdown, matchSeconds: MATCH_SECONDS }}
      />
    </div>
  );
}
