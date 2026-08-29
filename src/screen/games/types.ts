import type { ControllerMessage } from "../../../shared/protocol";
import type { Mii } from "../mii/Mii";

/** Every mini-game gets the same things: a way to talk to the phone, a way
 * to listen to it, a way to hand control back to the Wii Menu, and the
 * player's chosen Mii (picked on the Mii Select screen before the game
 * mounts) to render in-scene. */
export interface GameProps {
  send: (msg: object) => void;
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  /** Call when the player has explicitly asked to leave (e.g. an in-game "A
   * to return to menu" prompt after a match ends). HOME always exits too,
   * but that's handled centrally in ScreenApp -- games don't need to listen
   * for it themselves. */
  onExit: () => void;
  mii: Mii;
}
