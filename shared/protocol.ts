// Message protocol relayed through the GameRoom Durable Object between the
// screen (big display) and the controller (phone) clients. The DO never
// interprets these payloads for v1 -- it just relays JSON text frames to the
// other party in the room, plus emits its own "presence" events.

export type Role = "screen" | "controller";

export interface PresenceMessage {
  type: "presence";
  screenConnected: boolean;
  controllerConnected: boolean;
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

export type ButtonName = "A" | "B" | "HOME";

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

export interface GameStateMessage {
  type: "game-state";
  channel: string;
  payload: unknown;
}

export interface HapticMessage {
  type: "haptic";
  pattern: number[];
}

/** Screen -> controller. */
export type ScreenMessage = GameStateMessage | HapticMessage | PingMessage | PongMessage;

export type RelayMessage = ControllerMessage | ScreenMessage;

export type ServerMessage = PresenceMessage;

export function isPresence(msg: unknown): msg is PresenceMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "presence";
}
