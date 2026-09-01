import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ControllerMessage } from "../../../../shared/protocol";
import { MiiAvatar } from "../../mii/MiiAvatar";
import type { Mii } from "../../mii/Mii";
import type { GameProps } from "../types";
import { useGameCanvas } from "../useGameCanvas";
import "./fishing.css";
import {
  BITE_WINDOW,
  REEL_FULL,
  ROUND_SECONDS,
  SPECIES_BY_ID,
  TENSION_LIMIT,
  anglerFor,
  castLine,
  crankSpeed,
  createLake,
  standings,
  stepLake,
  strike,
  type Lake,
} from "./lake";

// Fishing.
//
// This is the channel that leans hardest on the phone actually being a Wii
// Remote, because it asks four completely different things of it and none of
// them is a button:
//
//   cast   an overhand flick; how hard decides how deep
//   hook   a sharp jerk upward, inside a window you cannot see coming
//   reel   winding your wrist in circles, measured as angular speed
//   ease   *stopping* winding, because the line will snap if you don't
//
// and it answers back through the one channel nothing else here has used:
// the phone buzzes in your hand when a fish takes the bait, and again,
// faster, when the line is about to go.
//
// Everybody fishes at once from their own spot along the pier, so a room of
// ten never waits for a turn.

const PIER_FRACTION = 0.17;
/** Acceleration (m/s^2, gravity removed) that counts as a flick. */
const FLICK_THRESHOLD = 11;
/** ...and where a flick stops counting as harder. */
const FLICK_FULL = 34;
/** How quickly the measured crank speed follows the wrist. Too smooth and
 * easing off comes too late to save the line. */
const CRANK_TAU = 0.12;
const WARN_EVERY_MS = 260;

interface Motion {
  alpha: number;
  beta: number;
  gamma: number;
  t: number;
}

export interface FishingSnapshot {
  kind: "fishing";
  lake: Lake;
  now: number;
  /** The anglers themselves. A watch screen has no other way to know who is
   * standing on the pier. */
  miis: Record<number, Mii>;
}

export function Fishing({ send, subscribe, onExit, players, publish }: GameProps) {
  const playerNumbers = useMemo(() => players.map((p) => p.player), [players]);
  const miisRef = useRef<Record<number, Mii>>({});
  miisRef.current = useMemo(() => Object.fromEntries(players.map((p) => [p.player, p.mii])), [players]);
  const lakeRef = useRef<Lake | null>(null);
  if (!lakeRef.current) lakeRef.current = createLake(playerNumbers);
  const [over, setOver] = useState(false);
  // The lake is a ref that the canvas redraws every frame, which is right
  // for the water and wrong for the scoreboard: the cards and the prompts
  // beneath the canvas are ordinary React, and nothing was re-rendering
  // them, so every score sat at 0.0kg and every prompt still read "Flick to
  // cast" no matter what happened. A slow tick is plenty for text.
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const sendRef = useRef(send);
  sendRef.current = send;
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  /** Smoothed wrist speed per player, in degrees per second. */
  const reelRates = useRef<Record<number, number>>({});
  const lastMotion = useRef<Record<number, Motion>>({});
  const armed = useRef<Record<number, boolean>>({});
  const lastNote = useRef<Record<number, string>>({});
  const lastWarn = useRef<Record<number, number>>({});
  const lastPublish = useRef(0);
  const overRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(bump, 120);
    return () => window.clearInterval(timer);
  }, []);

  const buzz = useCallback((player: number, pattern: number[]) => {
    sendRef.current({ type: "haptic", pattern, to: player });
  }, []);

  // -----------------------------------------------------------------------
  // Reading the phones
  // -----------------------------------------------------------------------
  useEffect(() => {
    return subscribe((msg: ControllerMessage, player: number) => {
      const lake = lakeRef.current!;
      if (msg.type === "motion") {
        const { alpha, beta, gamma, ax, ay, az } = msg.sample;
        if (alpha !== null && beta !== null && gamma !== null) {
          const now = msg.sample.t;
          const prev = lastMotion.current[player];
          if (prev) {
            const dt = Math.min(0.25, Math.max(0.001, (now - prev.t) / 1000));
            const speed = crankSpeed(prev, { alpha, beta, gamma }, dt);
            // Exponential smoothing, so a single noisy sample can't read as
            // a frantic crank and a pause reads as a pause quickly.
            const k = 1 - Math.exp(-dt / CRANK_TAU);
            const current = reelRates.current[player] ?? 0;
            reelRates.current[player] = current + (Math.min(speed, REEL_FULL * 1.6) - current) * k;
          }
          lastMotion.current[player] = { alpha, beta, gamma, t: now };
        }

        // A flick: linear acceleration with gravity taken out.
        if (ax !== null && ay !== null && az !== null) {
          const magnitude = Math.abs(Math.hypot(ax, ay, az) - 9.81);
          if (magnitude > FLICK_THRESHOLD) {
            if (armed.current[player] !== false) {
              armed.current[player] = false;
              const angler = anglerFor(lake, player);
              if (angler) {
                // What a flick means depends entirely on what the line is
                // doing, which is why the same gesture can cast and hook.
                if (angler.phase === "bite" || angler.phase === "fishing" || angler.phase === "sinking") {
                  const result = strike(lake, player);
                  if (result === "hooked") buzz(player, [25, 40, 25, 40, 60]);
                } else if (angler.phase === "ready") {
                  const power = Math.min(1, (magnitude - FLICK_THRESHOLD) / (FLICK_FULL - FLICK_THRESHOLD));
                  castLine(lake, player, power);
                }
              }
            }
          } else if (magnitude < FLICK_THRESHOLD * 0.45) {
            // Re-arm only once the arm has settled, so one throw is one cast.
            armed.current[player] = true;
          }
        }
        return;
      }

      if (msg.type === "button" && msg.state === "down") {
        const angler = anglerFor(lake, player);
        if (!angler) return;
        if (lakeRef.current!.over) {
          if (msg.button === "A") onExitRef.current();
          return;
        }
        // Buttons are a backstop, not the way in: A casts at a middling
        // depth if the flick isn't landing, and the D-pad trims it.
        if (msg.button === "A" && angler.phase === "ready") castLine(lake, player, 0.45);
        if (msg.button === "B" && (angler.phase === "fishing" || angler.phase === "sinking")) {
          angler.phase = "ready";
          angler.depth = 0;
        }
        if (msg.button === "DOWN" && angler.phase === "fishing") {
          angler.targetDepth = Math.min(96, angler.targetDepth + 8);
          angler.phase = "sinking";
        }
        if (msg.button === "UP" && angler.phase === "fishing") {
          angler.depth = Math.max(4, angler.depth - 8);
          angler.targetDepth = angler.depth;
        }
      }
    });
  }, [subscribe, buzz]);

  // -----------------------------------------------------------------------
  // The lake
  // -----------------------------------------------------------------------
  const canvasRef = useGameCanvas((ctx, dt, width, height) => {
    const lake = lakeRef.current!;

    // Wrist speed decays on its own: a phone that has stopped sending
    // motion (screen off, socket blip) must not read as a permanent crank.
    for (const player of playerNumbers) {
      const last = lastMotion.current[player];
      if (!last || performance.now() - last.t > 400) {
        reelRates.current[player] = (reelRates.current[player] ?? 0) * Math.max(0, 1 - dt * 6);
      }
    }

    const events = stepLake(lake, dt, reelRates.current);
    for (const event of events) {
      if (event.kind === "bite") buzz(event.player, [35, 55, 35]);
      if (event.kind === "landed") buzz(event.player, [90]);
      if (event.kind === "snapped") buzz(event.player, [180]);
      if (event.kind === "escaped") buzz(event.player, [60, 40, 60]);
    }

    // The line straining is the one thing the screen cannot tell you fast
    // enough, so the phone does: it buzzes harder the closer you are to
    // losing the fish.
    const now = performance.now();
    for (const angler of lake.anglers) {
      if (angler.phase === "hooked" && angler.tension >= TENSION_LIMIT * 0.88) {
        if (now - (lastWarn.current[angler.player] ?? 0) > WARN_EVERY_MS) {
          lastWarn.current[angler.player] = now;
          buzz(angler.player, [18]);
        }
      }
      // Each phone is told what it should be doing, whenever that changes.
      if (angler.note !== lastNote.current[angler.player]) {
        lastNote.current[angler.player] = angler.note;
        sendRef.current({ type: "turn", player: angler.player, label: angler.note, to: angler.player });
      }
    }

    if (lake.over && !overRef.current) {
      overRef.current = true;
      setOver(true);
    }

    if (now - lastPublish.current > 33) {
      lastPublish.current = now;
      publishRef.current({ kind: "fishing", lake, now, miis: miisRef.current } satisfies FishingSnapshot);
    }

    drawLake(ctx, lake, width, height, now);
  });

  useEffect(() => {
    return () => {
      for (const player of playerNumbers) {
        sendRef.current({ type: "turn", player: 0, label: "", to: player });
      }
    };
  }, [playerNumbers]);

  const lake = lakeRef.current!;
  const pierTop = `${PIER_FRACTION * 100}%`;

  return (
    <div className="fishing-root">
      <div className="fishing-canvas-wrap">
        <canvas ref={canvasRef} />
        {/* The Miis stand on the pier as real avatars rather than being
            painted into the canvas, so they are the same Miis as everywhere
            else in the app. */}
        {players.map((info) => {
          const angler = anglerFor(lake, info.player);
          if (!angler) return null;
          return (
            <div key={info.player} className="fishing-angler" style={{ left: `${angler.x}%`, top: pierTop }}>
              <MiiAvatar mii={info.mii} size={54} />
              <span className="fishing-angler-tag">P{info.player}</span>
            </div>
          );
        })}
      </div>

      <FishingHud lake={lake} />

      {over && (
        <div className="fishing-results">
          <h2>Time!</h2>
          <ol>
            {standings(lake).map((row, rank) => (
              <li key={row.player} className={rank === 0 ? "is-winner" : ""}>
                <span className="fishing-rank">{rank + 1}</span>
                <span className="fishing-who">Player {row.player}</span>
                <span className="fishing-bag">{row.score.toFixed(1)} kg</span>
                <span className="fishing-best">
                  {row.count} caught
                  {row.best ? ` · best ${SPECIES_BY_ID.get(row.best.species)?.name} ${row.best.weight.toFixed(1)}kg` : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="fishing-exit">Press A to head back</p>
        </div>
      )}
    </div>
  );
}

function FishingHud({ lake }: { lake: Lake }) {
  const seconds = Math.ceil(lake.remaining);
  return (
    <>
      <header className="fishing-header">
        <span className="fishing-title">Fishing</span>
        <span className={`fishing-clock${seconds <= 20 ? " is-urgent" : ""}`}>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
        <span className="fishing-hint">
          Flick to cast · jerk up when it bites · wind your wrist to reel · ease off before it snaps
        </span>
      </header>
      <div className="fishing-cards">
        {lake.anglers.map((angler) => (
          <div key={angler.player} className={`fishing-card${angler.phase === "hooked" ? " is-fighting" : ""}`}>
            <span className="fishing-card-player">P{angler.player}</span>
            <span className="fishing-card-score">{angler.score.toFixed(1)}kg</span>
            <span className="fishing-card-note">{angler.noteFor > 0 ? angler.note : ""}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Paints the whole lake. Exported so the spectator mirror can draw the exact
 * same water from a snapshot instead of carrying a second implementation.
 */
export function drawLake(ctx: CanvasRenderingContext2D, lake: Lake, width: number, height: number, now: number) {
  const pierY = height * PIER_FRACTION;
  const depthToY = (depth: number) => pierY + (depth / 100) * (height - pierY);
  const xToPx = (x: number) => (x / 100) * width;

  // --- sky and far shore ---
  const sky = ctx.createLinearGradient(0, 0, 0, pierY);
  sky.addColorStop(0, "#bfe4f5");
  sky.addColorStop(1, "#e8f4e0");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, pierY);

  ctx.fillStyle = "#8fb887";
  ctx.beginPath();
  ctx.moveTo(0, pierY);
  for (let x = 0; x <= width; x += width / 8) {
    ctx.lineTo(x, pierY - 14 - Math.sin(x * 0.004) * 10);
  }
  ctx.lineTo(width, pierY);
  ctx.closePath();
  ctx.fill();

  // --- water ---
  const water = ctx.createLinearGradient(0, pierY, 0, height);
  water.addColorStop(0, "#59b4dd");
  water.addColorStop(0.45, "#1f6e9e");
  water.addColorStop(1, "#08263c");
  ctx.fillStyle = water;
  ctx.fillRect(0, pierY, width, height - pierY);

  // Shafts of light, so the deep end reads as deep.
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 5; i += 1) {
    const x = ((i + 0.5) / 5) * width + Math.sin(now / 3000 + i) * 20;
    ctx.beginPath();
    ctx.moveTo(x - 16, pierY);
    ctx.lineTo(x + 16, pierY);
    ctx.lineTo(x + 60, height);
    ctx.lineTo(x - 60, height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // --- the bed ---
  ctx.fillStyle = "#123b2c";
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += width / 10) {
    ctx.lineTo(x, height - 18 - Math.sin(x * 0.01) * 8);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // --- fish ---
  for (const fish of lake.fish) {
    const species = SPECIES_BY_ID.get(fish.species)!;
    drawFish(ctx, xToPx(fish.x), depthToY(fish.depth), fish.weight, fish.dir, species.color, species.junk, now + fish.seed * 1000);
  }

  // --- lines, bobbers, hooks ---
  for (const angler of lake.anglers) {
    const px = xToPx(angler.x);
    const hookY = depthToY(angler.depth);
    const dip = angler.wobble > 0 ? Math.sin(now / 60) * 4 * angler.wobble : 0;

    if (angler.phase !== "ready" && angler.phase !== "landing") {
      ctx.strokeStyle = angler.phase === "hooked" ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.55)";
      ctx.lineWidth = angler.phase === "hooked" ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(px, pierY - height * 0.06);
      ctx.lineTo(px, hookY);
      ctx.stroke();

      // Bobber, riding the surface and dipping when something is interested.
      ctx.fillStyle = "#e8483f";
      ctx.beginPath();
      ctx.arc(px, pierY + 6 + dip, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(px, pierY + 6 + dip, 6, Math.PI, Math.PI * 2);
      ctx.fill();

      // The hook itself.
      ctx.strokeStyle = "#dfe6ec";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, hookY, 3.5, Math.PI * 0.15, Math.PI * 1.3);
      ctx.stroke();
    }

    if (angler.phase === "bite") {
      const ring = 1 - angler.biteTimer / BITE_WINDOW;
      ctx.strokeStyle = `rgba(255,255,255,${0.85 - ring * 0.7})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, pierY + 6, 10 + ring * 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (angler.phase === "hooked") {
      drawTension(ctx, px, pierY + 22, angler.tension);
    }

    if (angler.phase === "landing" && angler.landing) {
      const t = Math.min(1, angler.landing.t / 1.6);
      const species = SPECIES_BY_ID.get(angler.landing.species)!;
      const y = pierY + 10 - t * (height * 0.14);
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, (t - 0.6) / 0.4);
      drawFish(ctx, px, y, angler.landing.weight, 1, species.color, species.junk, now);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${angler.landing.weight.toFixed(1)}kg`, px, y - 22);
      ctx.restore();
    }
  }

  // --- the pier, drawn last so lines pass behind it ---
  ctx.fillStyle = "#8a6135";
  ctx.fillRect(0, pierY - height * 0.045, width, height * 0.045);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (let x = 0; x < width; x += 46) ctx.fillRect(x, pierY - height * 0.045, 3, height * 0.045);
  ctx.fillStyle = "#6d4b28";
  ctx.fillRect(0, pierY - 4, width, 5);
}

function drawFish(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  weight: number,
  dir: 1 | -1,
  color: string,
  junk: boolean | undefined,
  now: number,
) {
  const length = 12 + weight * 4.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);

  if (junk) {
    // A boot is a boot.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-length * 0.3, -length * 0.35, length * 0.45, length * 0.7, 3);
    ctx.roundRect(-length * 0.3, length * 0.1, length * 0.85, length * 0.25, 3);
    ctx.fill();
    ctx.restore();
    return;
  }

  const wag = Math.sin(now / 180) * 0.35;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, length * 0.5, length * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  ctx.beginPath();
  ctx.moveTo(-length * 0.45, 0);
  ctx.lineTo(-length * 0.78, -length * 0.24 + wag * length * 0.2);
  ctx.lineTo(-length * 0.78, length * 0.24 + wag * length * 0.2);
  ctx.closePath();
  ctx.fill();

  // A paler belly, and an eye, which is most of what makes it read as a fish.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, length * 0.1, length * 0.4, length * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#12222c";
  ctx.beginPath();
  ctx.arc(length * 0.28, -length * 0.05, Math.max(1.2, length * 0.05), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTension(ctx: CanvasRenderingContext2D, x: number, y: number, tension: number) {
  const w = 54;
  const h = 7;
  const fraction = Math.max(0, Math.min(1, tension / 140));
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y, w, h, 3);
  ctx.fill();
  // Green while there is room, red once the line is straining.
  const over = tension >= TENSION_LIMIT;
  ctx.fillStyle = over ? "#ff4d4d" : tension > TENSION_LIMIT * 0.7 ? "#ffb43d" : "#4bd07a";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y, Math.max(2, w * fraction), h, 3);
  ctx.fill();
  // The limit line, so "ease off" has somewhere visible to aim.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(x - w / 2 + w * (TENSION_LIMIT / 140), y - 2, 2, h + 4);
}

export { ROUND_SECONDS };
