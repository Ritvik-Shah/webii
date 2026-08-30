import { useCallback, useEffect, useRef, useState } from "react";
import type { Role } from "../../shared/protocol";

interface UseRoomSocketOptions<TIncoming> {
  /** Pass an empty string to intentionally stay disconnected (e.g. waiting on permission). */
  roomCode: string;
  role: Role;
  onMessage: (msg: TIncoming) => void;
  /** Controller only: the player slot to ask the room for. Read fresh at each
   * connection attempt, so reclaiming a slot after a dropped connection
   * doesn't itself tear the socket down and reconnect. */
  wantPlayer?: number;
  /** Called when the server closes deliberately (e.g. the room is full),
   * with its close code, so the UI can explain what happened. */
  onRejected?: (code: number) => void;
}

export function useRoomSocket<TIncoming = unknown>({
  roomCode,
  role,
  onMessage,
  wantPlayer,
  onRejected,
}: UseRoomSocketOptions<TIncoming>) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const wantPlayerRef = useRef(wantPlayer);
  wantPlayerRef.current = wantPlayer;
  const onRejectedRef = useRef(onRejected);
  onRejectedRef.current = onRejected;

  useEffect(() => {
    if (!roomCode) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const want = wantPlayerRef.current;
      const wantParam = want && want > 0 ? `&want=${want}` : "";
      const ws = new WebSocket(`${proto}://${location.host}/api/room/${roomCode}/ws?role=${role}${wantParam}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data as string) as TIncoming);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = (event) => {
        setConnected(false);
        if (cancelled) return;
        if (event.code >= 4001) {
          // A deliberate refusal (room full). Retrying would just be refused
          // again, so report it and stop.
          onRejectedRef.current?.(event.code);
          return;
        }
        const delay = Math.min(1000 * 2 ** attempt, 5000);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomCode, role]);

  const send = useCallback((message: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send };
}
