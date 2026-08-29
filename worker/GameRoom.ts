import { DurableObject } from "cloudflare:workers";
import type { PresenceMessage, Role } from "../shared/protocol";

interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
}

/**
 * Pure relay: forwards JSON text frames from the screen socket to the
 * controller socket and vice versa. Uses the WebSocket Hibernation API so an
 * idle paired room costs no compute between messages. No game logic lives
 * here for v1 -- that stays in the screen client.
 */
export class GameRoom extends DurableObject<Env> {
  private roomCode = "";

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role !== "screen" && role !== "controller") {
      return new Response("role must be 'screen' or 'controller'", { status: 400 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 });
    }

    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{3,8})\/ws$/);
    this.roomCode = match ? match[1].toUpperCase() : this.roomCode;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Only one active connection per role -- a rejoin replaces the old one.
    for (const existing of this.ctx.getWebSockets(role)) {
      existing.close(4000, "replaced by new connection");
    }

    this.ctx.acceptWebSocket(server, [role]);
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    const role = this.roleOf(ws);
    if (!role) return;
    const targetRole: Role = role === "screen" ? "controller" : "screen";
    for (const peer of this.ctx.getWebSockets(targetRole)) {
      peer.send(message);
    }
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    this.broadcastPresence();
  }

  async webSocketError() {
    this.broadcastPresence();
  }

  private roleOf(ws: WebSocket): Role | null {
    const tags = this.ctx.getTags(ws);
    if (tags.includes("screen")) return "screen";
    if (tags.includes("controller")) return "controller";
    return null;
  }

  private broadcastPresence() {
    const presence: PresenceMessage = {
      type: "presence",
      screenConnected: this.ctx.getWebSockets("screen").length > 0,
      controllerConnected: this.ctx.getWebSockets("controller").length > 0,
      roomCode: this.roomCode,
    };
    const payload = JSON.stringify(presence);
    for (const ws of [...this.ctx.getWebSockets("screen"), ...this.ctx.getWebSockets("controller")]) {
      ws.send(payload);
    }
  }
}
