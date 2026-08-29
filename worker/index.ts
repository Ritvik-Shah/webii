export { GameRoom } from "./GameRoom";

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// Excludes 0/O/1/I to avoid ambiguity when a player types the code by hand.
const ROOM_CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateRoomCode(length = 4): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/new-room" && request.method === "GET") {
      return Response.json({ roomCode: generateRoomCode() });
    }

    const roomMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{3,8})\/ws$/);
    if (roomMatch) {
      const roomCode = roomMatch[1].toUpperCase();
      const id = env.GAME_ROOM.idFromName(roomCode);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
