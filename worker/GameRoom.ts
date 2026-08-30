import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_REMOVED,
  CLOSE_ROOM_FULL,
  MAX_PLAYERS,
  type AssignedMessage,
  type PresenceMessage,
  type RemovedMessage,
  type Role,
} from "../shared/protocol";

interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
}

/**
 * Relay between one screen and up to MAX_PLAYERS phones.
 *
 * There are three kinds of socket: the one host screen that runs the games,
 * the phones, and any number of read-only spectator screens that mirror the
 * host. Snapshots from the host go only to spectators; everything else the
 * host sends goes to the phones.
 *
 * The room owns player numbering: each controller socket is tagged with its
 * slot, and every frame it sends is stamped with that number on the way to
 * the screen -- so the screen can always tell who pressed what without
 * trusting a phone to label itself. Screen-to-controller frames may carry a
 * `to` field to reach one player instead of the whole room.
 *
 * Uses the WebSocket Hibernation API, so an idle room costs no compute
 * between messages. The player numbers live on the socket tags rather than
 * in memory, which is what lets a hibernated room wake up and still know
 * who everyone is.
 */
export class GameRoom extends DurableObject<Env> {
  private roomCode = "";

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role !== "screen" && role !== "controller" && role !== "spectator") {
      return new Response("role must be 'screen', 'controller' or 'spectator'", { status: 400 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{3,8})\/ws$/);
    this.roomCode = match ? match[1].toUpperCase() : this.roomCode;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === "spectator") {
      // Any number of read-only mirrors; they send nothing and simply
      // receive the host's snapshots.
      this.ctx.acceptWebSocket(server, ["spectator"]);
      this.broadcastPresence();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (role === "screen") {
      // Still exactly one screen; a rejoin replaces the old one.
      for (const existing of this.ctx.getWebSockets("screen")) {
        existing.close(4000, "replaced by new connection");
      }
      this.ctx.acceptWebSocket(server, ["screen"]);
      this.broadcastPresence();
      return new Response(null, { status: 101, webSocket: client });
    }

    // A reconnecting phone asks for the slot it held before, so a dropped
    // connection mid-game doesn't renumber everyone.
    const wanted = Number(url.searchParams.get("want"));
    const player = this.claimPlayerSlot(Number.isInteger(wanted) ? wanted : 0);

    if (player === 0) {
      // Accept, then close with a reason. Rejecting the upgrade outright
      // surfaces in the browser as a generic network error, which the phone
      // can't tell apart from being offline.
      server.accept();
      server.close(CLOSE_ROOM_FULL, "room is full");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, ["controller", playerTag(player)]);

    const assigned: AssignedMessage = { type: "assigned", player, roomCode: this.roomCode };
    server.send(JSON.stringify(assigned));
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    const role = this.roleOf(ws);
    if (!role) return;

    // Spectators are strictly read-only; anything they send is ignored.
    if (role === "spectator") return;

    if (role === "controller") {
      // Stamp the sender's player number before handing it to the screen.
      const player = this.playerOf(ws);
      let payload: string;
      try {
        payload = JSON.stringify({ ...JSON.parse(message), player });
      } catch {
        return; // malformed frame, drop it
      }
      for (const screen of this.ctx.getWebSockets("screen")) {
        screen.send(payload);
      }
      return;
    }

    // Host screen -> either the spectator mirrors (snapshots) or the phones
    // (everything else, optionally addressed to a single player).
    let parsed: { to?: number; type?: string };
    try {
      parsed = JSON.parse(message) as { to?: number; type?: string };
    } catch {
      return;
    }

    if (parsed.type === "kick") {
      // The room acts on this itself rather than relaying it: closing the
      // socket is what actually frees the slot.
      const target = typeof (parsed as { player?: number }).player === "number" ? (parsed as { player: number }).player : 0;
      if (target >= 1 && target <= MAX_PLAYERS) {
        for (const victim of this.ctx.getWebSockets(playerTag(target))) {
          // Tell them first: the close code on its own doesn't reliably
          // reach the client, and a phone that just sees a dropped socket
          // reconnects and takes a slot straight back.
          try {
            victim.send(JSON.stringify({ type: "removed" } satisfies RemovedMessage));
          } catch {
            // Already gone; the close below is then a no-op.
          }
          victim.close(CLOSE_REMOVED, "removed by the host");
        }
        this.broadcastPresence();
      }
      return;
    }

    if (parsed.type === "snapshot") {
      for (const viewer of this.ctx.getWebSockets("spectator")) {
        if (!isOpen(viewer)) continue;
        try {
          viewer.send(message);
        } catch {
          // Viewer vanished mid-send; its close handler will tidy up.
        }
      }
      return;
    }

    const to = typeof parsed.to === "number" ? parsed.to : 0;
    const targets = to > 0 ? this.ctx.getWebSockets(playerTag(to)) : this.ctx.getWebSockets("controller");
    for (const peer of targets) {
      if (isOpen(peer)) peer.send(message);
    }
  }

  async webSocketClose(ws: WebSocket) {
    // Deliberately does NOT call ws.close() again. The socket is already
    // closing, and a bare close() here overrode the code we had just sent --
    // which is why a removed player's phone never learned it was removed and
    // silently reconnected instead.
    // The closing socket is still listed by getWebSockets() at this point in
    // production (though not in the local dev runtime), so it has to be
    // excluded explicitly or the roster still shows the player who just left.
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcastPresence(ws);
  }

  /**
   * Grant `wanted` if that slot is free, otherwise the lowest free one.
   * Returns 0 when every slot is taken.
   */
  private claimPlayerSlot(wanted: number): number {
    const taken = new Set(this.connectedPlayers(null));
    if (wanted >= 1 && wanted <= MAX_PLAYERS && !taken.has(wanted)) return wanted;
    for (let player = 1; player <= MAX_PLAYERS; player++) {
      if (!taken.has(player)) return player;
    }
    return 0;
  }

  /** Player numbers with a live socket, ignoring `leaving` (the socket
   * currently being torn down) and anything already closing. */
  private connectedPlayers(leaving: WebSocket | null): number[] {
    const players: number[] = [];
    for (let player = 1; player <= MAX_PLAYERS; player++) {
      const live = this.ctx
        .getWebSockets(playerTag(player))
        .some((ws) => ws !== leaving && isOpen(ws));
      if (live) players.push(player);
    }
    return players;
  }

  private roleOf(ws: WebSocket): Role | null {
    const tags = this.ctx.getTags(ws);
    if (tags.includes("screen")) return "screen";
    if (tags.includes("controller")) return "controller";
    if (tags.includes("spectator")) return "spectator";
    return null;
  }

  private playerOf(ws: WebSocket): number {
    for (const tag of this.ctx.getTags(ws)) {
      if (tag.startsWith("p")) {
        const player = Number(tag.slice(1));
        if (Number.isInteger(player)) return player;
      }
    }
    return 0;
  }

  private broadcastPresence(leaving: WebSocket | null = null) {
    const presence: PresenceMessage = {
      type: "presence",
      screenConnected: this.ctx.getWebSockets("screen").some((ws) => ws !== leaving && isOpen(ws)),
      players: this.connectedPlayers(leaving),
      spectators: this.ctx.getWebSockets("spectator").filter((ws) => ws !== leaving && isOpen(ws)).length,
      roomCode: this.roomCode,
    };
    const payload = JSON.stringify(presence);
    for (const ws of [
      ...this.ctx.getWebSockets("screen"),
      ...this.ctx.getWebSockets("controller"),
      ...this.ctx.getWebSockets("spectator"),
    ]) {
      if (ws === leaving || !isOpen(ws)) continue;
      try {
        ws.send(payload);
      } catch {
        // Socket went away between the check and the send; the close
        // handler will broadcast again.
      }
    }
  }
}

function playerTag(player: number): string {
  return `p${player}`;
}

/** WebSocket.OPEN, without relying on the constant being present on the
 * hibernation-API socket objects. */
function isOpen(ws: WebSocket): boolean {
  return ws.readyState === 1;
}
