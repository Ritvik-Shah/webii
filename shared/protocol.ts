// Message protocol relayed through the GameRoom Durable Object between the
// screen (big display) and the controller (phone) clients. The DO never
// interprets these payloads for v1 -- it just relays JSON text frames to the
// other party in the room, plus emits its own "presence" events.

export type Role = "screen" | "controller";

/** A room seats one screen and up to this many phones, numbered from 1. */
export const MAX_PLAYERS = 4;

export interface PresenceMessage {
  type: "presence";
  screenConnected: boolean;
  /** Player numbers currently connected, ascending. Empty means nobody has
   * paired a phone yet. */
  players: number[];
  roomCode: string;
}

/**
 * Sent to a controller alone, right after it connects, telling it which
 * player slot it owns. The phone remembers this so a dropped connection
 * reclaims the same slot rather than shuffling everyone's player number
 * mid-game -- see `wantedPlayer` in useRoomSocket.
 */
export interface AssignedMessage {
  type: "assigned";
  player: number;
  roomCode: string;
}

export interface PointerMessage {
  /** Offset from the phone's calibrated aim center, normalized so ~1.0 unit
   * corresponds to roughly a 90-degree tilt. Absolute, not a delta -- the
   * phone always reports "how far am I currently tilted from center", and
   * the screen maps that straight onto cursor position, like pointing a
   * real Wiimote rather than dragging a trackpad. Positive ox = tilted
   * right, positive oy = tilted down. Not clamped; the screen clamps when
   * mapping to a position. */
  type: "pointer";
  ox: number;
  oy: number;
}

export interface RecenterMessage {
  type: "recenter";
}

// Full Wii Remote face layout: D-pad (digital, no diagonal blending), A, B,
// the two small face buttons (1/2), and Home. Button *meaning* is contextual
// per game, same as the real thing (e.g. 2 lays a mine in Tanks!) -- this
// type just names the physical control that was pressed.
export type ButtonName = "A" | "B" | "ONE" | "TWO" | "HOME" | "UP" | "DOWN" | "LEFT" | "RIGHT";

export interface ButtonMessage {
  type: "button";
  button: ButtonName;
  state: "down" | "up";
}

export interface MotionSample {
  t: number;
  /** Device orientation, degrees. */
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  /** Acceleration including gravity, m/s^2. */
  ax: number | null;
  ay: number | null;
  az: number | null;
}

export interface MotionMessage {
  type: "motion";
  sample: MotionSample;
}

export interface PingMessage {
  type: "ping";
  t: number;
}

export interface PongMessage {
  type: "pong";
  t: number;
}

/** Controller -> screen. */
export type ControllerMessage =
  | PointerMessage
  | RecenterMessage
  | ButtonMessage
  | MotionMessage
  | PingMessage
  | PongMessage;

/**
 * What the screen actually receives: the controller's own message with the
 * sending player's number stamped on by the GameRoom. The stamp is added
 * server-side rather than by the phone so it can't drift out of sync with
 * the slot the room actually assigned.
 */
export type StampedControllerMessage = ControllerMessage & { player?: number };

export interface GameStateMessage {
  type: "game-state";
  channel: string;
  payload: unknown;
}

export interface HapticMessage {
  type: "haptic";
  pattern: number[];
}

/** Screen -> controller: whose turn it is, so every phone can show either
 * "Your turn" or who they're waiting on. */
export interface TurnMessage {
  type: "turn";
  /** Player number now in control, or 0 when nobody is (menus, results). */
  player: number;
  /** Short label for the phone to display, e.g. "Frame 3". */
  label?: string;
}

/** Screen -> controller. Setting `to` routes the message to that one player
 * instead of broadcasting it to every phone in the room. */
export type ScreenMessage = (GameStateMessage | HapticMessage | TurnMessage | PingMessage | PongMessage) & {
  to?: number;
};

export type RelayMessage = ControllerMessage | ScreenMessage;

export type ServerMessage = PresenceMessage | AssignedMessage;

export function isPresence(msg: unknown): msg is PresenceMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "presence";
}

export function isAssigned(msg: unknown): msg is AssignedMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "assigned";
}

/** WebSocket close code the room uses when every player slot is taken. */
export const CLOSE_ROOM_FULL = 4001;
