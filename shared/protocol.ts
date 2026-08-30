// Message protocol relayed through the GameRoom Durable Object between the
// screen (big display) and the controller (phone) clients. The DO never
// interprets these payloads for v1 -- it just relays JSON text frames to the
// other party in the room, plus emits its own "presence" events.

/** "screen" is the one host that runs the games; "spectator" is a read-only
 * mirror of it (a second TV in the room, or someone playing from elsewhere
 * who needs a view to go with their phone). */
export type Role = "screen" | "controller" | "spectator";

/** A room seats one screen and up to this many phones, numbered from 1.
 * Ten so the card and party games can take a full table; the action games
 * simply use however many turned up. */
export const MAX_PLAYERS = 10;

/** Seat grids (lobby, player manager) lay out as this many columns. Ten in
 * a single row is unreadable on a TV. */
export const SEAT_COLS = 5;
export const SEAT_ROWS = Math.ceil(MAX_PLAYERS / SEAT_COLS);

export interface PresenceMessage {
  type: "presence";
  screenConnected: boolean;
  /** Player numbers currently connected, ascending. Empty means nobody has
   * paired a phone yet. */
  players: number[];
  /** How many spectator screens are mirroring the host. The host uses this
   * to skip publishing snapshots when nobody is watching. */
  spectators: number;
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
// the two small face buttons (1/2), Minus, and Home. Button *meaning* is contextual
// per game, same as the real thing (e.g. 2 lays a mine in Tanks!) -- this
// type just names the physical control that was pressed.
export type ButtonName = "A" | "B" | "ONE" | "TWO" | "MINUS" | "HOME" | "UP" | "DOWN" | "LEFT" | "RIGHT";

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
  | PhoneActionMessage
  | PingMessage
  | PongMessage;

/**
 * What the screen actually receives: the controller's own message with the
 * sending player's number stamped on by the GameRoom. The stamp is added
 * server-side rather than by the phone so it can't drift out of sync with
 * the slot the room actually assigned.
 */
export type StampedControllerMessage = ControllerMessage & { player?: number };

// ---------------------------------------------------------------------------
// Phone-side game views.
//
// For the motion games the phone is a dumb remote. Card and party games need
// it to show something private -- your hand, your prompt -- and send back a
// structured choice rather than a button press. Rather than shipping a phone
// component per game, the host describes what it wants shown in this small
// vocabulary and the phone renders it. Cards plus buttons covers Uno; buttons
// plus a slider covers poker betting; text entry and a choice list cover the
// Quiplash-style games.
// ---------------------------------------------------------------------------

/** A card in the player's hand. `playable` greys out illegal plays. */
export interface PhoneCard {
  id: string;
  label: string;
  /** Any CSS colour; the phone tints the card with it. */
  color?: string;
  playable?: boolean;
}

export interface PhoneAction {
  id: string;
  label: string;
  style?: "primary" | "danger" | "muted";
  disabled?: boolean;
}

export interface PhoneChoice {
  id: string;
  label: string;
}

/** Free-text entry, for the write-an-answer games. */
export interface PhoneInput {
  placeholder: string;
  maxLength: number;
  submitLabel: string;
}

/** Numeric entry, for bet sizing. */
export interface PhoneSlider {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  submitLabel: string;
}

export interface PhoneView {
  title?: string;
  subtitle?: string;
  /** Shown large and calm -- "waiting for the others", a dealt result. */
  note?: string;
  cards?: PhoneCard[];
  actions?: PhoneAction[];
  choices?: PhoneChoice[];
  input?: PhoneInput;
  slider?: PhoneSlider;
  /** Dims the whole view: it is somebody else's turn. */
  waiting?: boolean;
}

/**
 * Host -> one phone (via `to`): what that player should be looking at.
 * A null view hands the phone back to the ordinary remote.
 */
export interface PhoneViewMessage {
  type: "phone-view";
  view: PhoneView | null;
}

/** Phone -> host: the player chose something in their view. */
export interface PhoneActionMessage {
  type: "action";
  /** Matches the id of the card, action, or choice that was picked. */
  id: string;
  /** Text typed, or a slider amount. */
  value?: string | number;
}

export interface GameStateMessage {
  type: "game-state";
  channel: string;
  payload: unknown;
}

export interface HapticMessage {
  type: "haptic";
  pattern: number[];
}

/**
 * Host screen -> spectator screens: everything needed to draw the current
 * frame. The host stays authoritative and simply describes what it is
 * showing; spectators never simulate anything, which is what keeps them in
 * step without needing the games to be deterministic.
 */
export interface SnapshotMessage {
  type: "snapshot";
  /** Which screen the host is on: "lobby", "menu", "game:bowling", ... */
  view: string;
  /** View-specific render state, shaped by whatever draws that view. */
  state: unknown;
}

/**
 * Host screen -> room: drop a player, freeing their slot. Handled by the
 * room itself rather than relayed. Needed because a phone that drops off
 * without a clean close (screen locked, walked out of wifi) leaves a socket
 * the room still believes is live, and in a turn-based game everyone then
 * waits forever on someone who isn't there.
 */
export interface KickMessage {
  type: "kick";
  player: number;
}

/**
 * Room -> the phone being removed. The close code alone isn't dependable
 * here (hibernatable sockets don't reliably deliver one), and a phone that
 * only sees a bare disconnect would just reconnect and take a slot again --
 * so it's told in a message it cannot miss, and the close follows.
 */
export interface RemovedMessage {
  type: "removed";
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
export type ScreenMessage = (
  | GameStateMessage
  | HapticMessage
  | KickMessage
  | PhoneViewMessage
  | TurnMessage
  | SnapshotMessage
  | PingMessage
  | PongMessage
) & {
  to?: number;
};

export type RelayMessage = ControllerMessage | ScreenMessage;

export type ServerMessage = PresenceMessage | AssignedMessage | RemovedMessage;

export function isPresence(msg: unknown): msg is PresenceMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "presence";
}

export function isAssigned(msg: unknown): msg is AssignedMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "assigned";
}

export function isRemoved(msg: unknown): msg is RemovedMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "removed";
}

export function isPhoneView(msg: unknown): msg is PhoneViewMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "phone-view";
}

export function isSnapshot(msg: unknown): msg is SnapshotMessage {
  return !!msg && typeof msg === "object" && (msg as { type?: string }).type === "snapshot";
}

/** WebSocket close code the room uses when every player slot is taken. */
export const CLOSE_ROOM_FULL = 4001;
/** ...and when the host removes a player from the room. */
export const CLOSE_REMOVED = 4002;

/** How often the host publishes snapshots while a game is running. Mirrors
 * interpolate between snapshots and deliberately draw a little behind live,
 * and that buffer has to be at least one publish interval -- so a faster
 * rate directly buys back latency on the watch screen. 50 Hz keeps the
 * buffer to ~30 ms while staying modest on bandwidth. */
export const SNAPSHOT_HZ = 50;

/** How far behind live a mirror draws, in ms. Just over one publish
 * interval: enough to always have two snapshots to blend between, without
 * adding delay for its own sake. */
export const MIRROR_DELAY_MS = 30;
