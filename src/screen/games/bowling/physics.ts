// Ball and pin simulation. Deliberately 2D-on-the-deck (x/z positions plus a
// tilt angle per pin) rather than a full rigid-body engine: pins are tall
// thin objects that either stay upright or tip over, so tracking "how far
// has this pin tipped, and about which axis" reproduces the look of a real
// rack scattering without dragging in a physics library. The renderer turns
// that tilt straight into a mesh rotation.

import {
  BALL_RADIUS,
  DECK_BACK_Z,
  GUTTER_DEPTH,
  GUTTER_WIDTH,
  LANE_HALF_WIDTH,
  PIN_LAYOUT,
  PIN_RADIUS,
} from "./constants";

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  released: boolean;
  inGutter: boolean;
  /** Accumulated roll angle, radians -- the renderer spins the ball by this. */
  roll: number;
  /** Set once the ball has left the playfield and cannot affect pins again. */
  finished: boolean;
}

export interface PinState {
  id: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  /** Radians away from upright; PI/2 is flat on the deck. */
  tilt: number;
  /** Horizontal axis the pin rotates about as it tips (unit, x/z plane). */
  axisX: number;
  axisZ: number;
  /** Yaw wobble, purely cosmetic. */
  yaw: number;
  /** Knocked clear off the deck or into the pit. */
  gone: boolean;
}

export interface Simulation {
  ball: BallState;
  pins: PinState[];
  /** Leftover time carried between frames so every physics step is exactly
   * FIXED_DT long, whatever the display is doing. */
  accumulator: number;
}

export interface StepEvents {
  /** Combined impact strength of pin contacts this step, 0 if none. */
  impact: number;
  /** True on the step the ball drops into a gutter. */
  enteredGutter: boolean;
}

/** Beyond this tilt a pin is lying down and counts as knocked over. */
const DOWN_TILT = Math.PI / 2 - 0.2;
/** A pin standing this far from upright is still falling, so not settled. */
const SETTLED_TILT_EPS = 0.02;
const SETTLED_SPEED = 0.06;

// Ball 7.26 kg against pin 1.53 kg. For an impulse along the contact normal
// the pin leaves with 2*m_ball/(m_ball+m_pin) = 1.65 of the closing speed and
// the ball loses 2*m_pin/(m_ball+m_pin) = 0.35 of it. Both are damped a
// little for the energy a real collision loses.
//
// BALL_DEFLECT is the one deliberate departure. It was 0.11, which made the
// ball far too heavy to be pushed around -- it ploughed through a rack in a
// dead straight line. The physically correct 0.35 knocks it so far off line
// that a straight ball can't carry a rack at all, which matters here because
// this game has no hook to steer back with. 0.16 is the compromise: the ball
// is visibly shoved off its path (~20 cm through the pocket), a fast ball is
// shoved much less (~9 cm) since the pins are cleared before they can push
// back, and a well-aimed shot still strikes.
const PIN_KICK = 1.55;
const BALL_DEFLECT = 0.16;
/** Pins tip faster the harder they are moving. */
const TIP_RATE = 3.4;
const PIN_FRICTION = 1.9;

export function createSimulation(standingPins: number[]): Simulation {
  return {
    ball: {
      x: 0,
      y: BALL_RADIUS,
      z: 0,
      vx: 0,
      vz: 0,
      released: false,
      inGutter: false,
      roll: 0,
      finished: false,
    },
    accumulator: 0,
    pins: standingPins.map((id) => ({
      id,
      x: PIN_LAYOUT[id].x,
      z: PIN_LAYOUT[id].z,
      y: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      tilt: 0,
      axisX: 1,
      axisZ: 0,
      yaw: 0,
      gone: false,
    })),
  };
}

export function isPinDown(pin: PinState): boolean {
  return pin.gone || pin.tilt >= DOWN_TILT;
}

export function countPinsDown(sim: Simulation): number {
  return sim.pins.reduce((total, pin) => total + (isPinDown(pin) ? 1 : 0), 0);
}

/** Pin ids still standing after the roll -- what gets re-racked for ball two. */
export function standingPinIds(sim: Simulation): number[] {
  return sim.pins.filter((pin) => !isPinDown(pin)).map((pin) => pin.id);
}

/** True once nothing is still moving, so the roll's result is final. */
export function isSettled(sim: Simulation): boolean {
  if (!sim.ball.finished) return false;
  return sim.pins.every((pin) => {
    if (pin.gone) return pin.y < -2;
    const speed = Math.hypot(pin.vx, pin.vz);
    if (speed > SETTLED_SPEED) return false;
    // Mid-topple pins are still animating even if they have stopped sliding.
    return pin.tilt < SETTLED_TILT_EPS || pin.tilt >= DOWN_TILT;
  });
}

/**
 * Fixed physics timestep. The simulation used to advance by whatever the
 * display gave it, so the same throw behaved differently at 30 fps and
 * 144 fps -- and at low frame rates a fast ball could move most of a
 * contact radius in one step, making hits feel unreliable. `advance`
 * subdivides the frame into these, so the physics is identical everywhere.
 */
const FIXED_DT = 1 / 240;

/**
 * Advance the simulation by a frame's worth of time, in fixed substeps.
 * This is what games should call; `step` is a single substep.
 */
export function advance(sim: Simulation, dt: number): StepEvents {
  // Carry the remainder rather than running a short final step: a partial
  // step is what made 60 fps and 144 fps produce different racks even after
  // the timestep was nominally fixed. Capped so a backgrounded tab doesn't
  // try to catch up on minutes of physics at once.
  sim.accumulator = Math.min(sim.accumulator + dt, 0.1);
  const merged: StepEvents = { impact: 0, enteredGutter: false };
  while (sim.accumulator >= FIXED_DT) {
    const events = step(sim, FIXED_DT);
    merged.impact = Math.max(merged.impact, events.impact);
    merged.enteredGutter = merged.enteredGutter || events.enteredGutter;
    sim.accumulator -= FIXED_DT;
  }
  return merged;
}

export function step(sim: Simulation, dt: number): StepEvents {
  const events: StepEvents = { impact: 0, enteredGutter: false };
  const { ball } = sim;

  if (ball.released && !ball.finished) {
    stepBall(ball, dt, events);
    if (!ball.inGutter) collideBallWithPins(sim, events);
  }

  collidePins(sim);
  stepPins(sim, dt);

  return events;
}

function stepBall(ball: BallState, dt: number, events: StepEvents) {
  ball.x += ball.vx * dt;
  ball.z += ball.vz * dt;

  const speed = Math.hypot(ball.vx, ball.vz);
  ball.roll += (speed / BALL_RADIUS) * dt;

  // Lane friction: gentle on the boards, heavy once it is bouncing down a gutter.
  const drag = ball.inGutter ? 0.55 : 0.09;
  const decay = Math.max(0, 1 - drag * dt);
  ball.vx *= decay;
  ball.vz *= decay;

  if (!ball.inGutter && Math.abs(ball.x) > LANE_HALF_WIDTH - BALL_RADIUS * 0.35) {
    ball.inGutter = true;
    ball.vx = 0;
    events.enteredGutter = true;
  }

  if (ball.inGutter) {
    const targetX = Math.sign(ball.x) * (LANE_HALF_WIDTH + GUTTER_WIDTH / 2);
    const targetY = BALL_RADIUS - GUTTER_DEPTH;
    ball.x += (targetX - ball.x) * Math.min(1, 9 * dt);
    ball.y += (targetY - ball.y) * Math.min(1, 9 * dt);
  }

  // Past the deck the ball has dropped into the pit; stop simulating it.
  if (ball.z < DECK_BACK_Z - 0.4 || speed < 0.35) {
    ball.finished = true;
  }
}

function collideBallWithPins(sim: Simulation, events: StepEvents) {
  const { ball } = sim;
  const contact = BALL_RADIUS + PIN_RADIUS;

  for (const pin of sim.pins) {
    if (pin.gone || pin.tilt >= DOWN_TILT) continue;
    const dx = pin.x - ball.x;
    const dz = pin.z - ball.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= contact || dist === 0) continue;

    const nx = dx / dist;
    const nz = dz / dist;
    const closing = (ball.vx - pin.vx) * nx + (ball.vz - pin.vz) * nz;
    if (closing <= 0) continue;

    // Separate first so a grazing hit cannot tunnel through on the next step.
    const overlap = contact - dist;
    pin.x += nx * overlap;
    pin.z += nz * overlap;

    pin.vx += nx * closing * PIN_KICK;
    pin.vz += nz * closing * PIN_KICK;
    // A little tangential scatter -- identical hits should not produce
    // identical racks, and real pins deflect off each other's shoulders.
    pin.vx += -nz * closing * 0.12 * (Math.random() - 0.5);
    pin.vz += nx * closing * 0.12 * (Math.random() - 0.5);
    pin.vy = Math.min(2.4, closing * 0.16);

    ball.vx -= nx * closing * BALL_DEFLECT;
    ball.vz -= nz * closing * BALL_DEFLECT;

    startTopple(pin);
    events.impact = Math.max(events.impact, Math.min(1, closing / 8));
  }
}

function collidePins(sim: Simulation) {
  const contact = PIN_RADIUS * 2;
  for (let i = 0; i < sim.pins.length; i++) {
    const a = sim.pins[i];
    if (a.gone) continue;
    for (let j = i + 1; j < sim.pins.length; j++) {
      const b = sim.pins[j];
      if (b.gone) continue;
      // Two pins already flat on the deck just lie there together.
      if (a.tilt >= DOWN_TILT && b.tilt >= DOWN_TILT) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= contact || dist === 0) continue;

      const nx = dx / dist;
      const nz = dz / dist;
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing <= 0) continue;

      const overlap = (contact - dist) / 2;
      a.x -= nx * overlap;
      a.z -= nz * overlap;
      b.x += nx * overlap;
      b.z += nz * overlap;

      // Equal masses: swap the closing component, damped for the energy a
      // real wooden pin loses on impact.
      const transfer = closing * 0.86;
      a.vx -= nx * transfer;
      a.vz -= nz * transfer;
      b.vx += nx * transfer;
      b.vz += nz * transfer;
      b.vy = Math.max(b.vy, Math.min(1.6, transfer * 0.2));

      startTopple(a);
      startTopple(b);
    }
  }
}

/** Lock in the axis a pin tips about, the first time it is set moving. */
function startTopple(pin: PinState) {
  if (pin.tilt > 0.001) return;
  const speed = Math.hypot(pin.vx, pin.vz);
  if (speed < 0.25) return;
  // Tip away from the direction of travel: the rotation axis is horizontal
  // and perpendicular to the velocity.
  pin.axisX = -pin.vz / speed;
  pin.axisZ = pin.vx / speed;
  pin.tilt = 0.02;
  pin.yaw = (Math.random() - 0.5) * 0.6;
}

function stepPins(sim: Simulation, dt: number) {
  for (const pin of sim.pins) {
    if (pin.gone) {
      // Falling into the pit / off the side; the renderer keeps drawing it
      // tumbling out of frame until it is well out of sight.
      pin.vy -= 9.81 * dt;
      pin.y += pin.vy * dt;
      pin.x += pin.vx * dt;
      pin.z += pin.vz * dt;
      pin.tilt += 6 * dt;
      continue;
    }

    pin.x += pin.vx * dt;
    pin.z += pin.vz * dt;

    if (pin.y > 0 || pin.vy > 0) {
      pin.vy -= 9.81 * dt;
      pin.y = Math.max(0, pin.y + pin.vy * dt);
      if (pin.y === 0 && pin.vy < 0) pin.vy = 0;
    }

    const speed = Math.hypot(pin.vx, pin.vz);
    if (pin.tilt > 0 && pin.tilt < Math.PI / 2) {
      // Tipping accelerates as it goes -- gravity takes over past the
      // balance point, so a nudged pin either rights itself or goes all the way.
      pin.tilt = Math.min(Math.PI / 2, pin.tilt + (TIP_RATE * speed + 2.2 * pin.tilt) * dt);
    }

    if (speed > 0) {
      const decay = Math.max(0, 1 - PIN_FRICTION * dt);
      pin.vx *= decay;
      pin.vz *= decay;
      if (Math.hypot(pin.vx, pin.vz) < 0.05) {
        pin.vx = 0;
        pin.vz = 0;
      }
    }

    const offSide = Math.abs(pin.x) > LANE_HALF_WIDTH + GUTTER_WIDTH;
    const offBack = pin.z < DECK_BACK_Z;
    if (offSide || offBack) {
      pin.gone = true;
      pin.vy = 0.4;
    }
  }
}
