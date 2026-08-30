import type { ControllerMessage } from "../../../shared/protocol";
import type { Mii } from "../mii/Mii";

/** One seated player: their room slot (1-4) and the Mii they picked on the
 * Mii Select screen before the game mounted. */
export interface PlayerInfo {
  player: number;
  mii: Mii;
}

/** Every mini-game gets the same things: a way to talk to the phones, a way
 * to listen to them, a way to hand control back to the Wii Menu, and who is
 * playing. */
export interface GameProps {
  /** Broadcast to every phone, or add `to: <player>` to reach just one. */
  send: (msg: object) => void;
  /**
   * Controller messages, with the sending player's number as a second
   * argument. Handlers that don't care who pressed what can ignore it and
   * respond to every remote -- which is what the single-player games do.
   */
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void;
  /** Call when the player has explicitly asked to leave (e.g. an in-game "A
   * to return to menu" prompt after a match ends). HOME always exits too,
   * but that's handled centrally in ScreenApp -- games don't need to listen
   * for it themselves. */
  onExit: () => void;
  /** In room-join order, so `players[0]` is the host and a solo game can
   * simply use it. Always at least one entry. */
  players: PlayerInfo[];
  /**
   * Publish a render snapshot for spectator screens. A no-op when nobody is
   * watching, so games can call it every frame without checking first.
   */
  publish: (state: unknown) => void;
  /** How many spectator screens are mirroring this game right now. */
  spectators: number;
}
