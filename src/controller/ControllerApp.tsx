import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import type { AssignedMessage, PresenceMessage, ScreenMessage, TurnMessage } from "../../shared/protocol";
import { CLOSE_ROOM_FULL, MAX_PLAYERS, isAssigned, isPresence } from "../../shared/protocol";
import { useRoomSocket } from "../lib/useRoomSocket";
import { useMotionStream } from "./useMotionStream";
import PermissionGate from "./PermissionGate";
import Wiimote from "./Wiimote";

/**
 * Remember the slot this phone was given, so a dropped connection reclaims
 * the same player number instead of renumbering everyone mid-game. Scoped
 * per room code and to this tab, so a different room starts clean.
 */
function slotKey(roomCode: string) {
  return `webii-player-${roomCode}`;
}

function rememberedSlot(roomCode: string): number {
  try {
    const raw = sessionStorage.getItem(slotKey(roomCode));
    const player = Number(raw);
    return Number.isInteger(player) && player >= 1 && player <= MAX_PLAYERS ? player : 0;
  } catch {
    return 0;
  }
}

export default function ControllerApp() {
  const { roomCode = "" } = useParams<{ roomCode: string }>();
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [player, setPlayer] = useState<number>(() => rememberedSlot(roomCode));
  const [roomFull, setRoomFull] = useState(false);
  const [turn, setTurn] = useState<TurnMessage | null>(null);

  const onMessage = useCallback(
    (msg: PresenceMessage | AssignedMessage | ScreenMessage) => {
      if (isPresence(msg)) {
        setPresence(msg);
        return;
      }
      if (isAssigned(msg)) {
        setPlayer(msg.player);
        try {
          sessionStorage.setItem(slotKey(roomCode), String(msg.player));
        } catch {
          // Storage unavailable -- we just lose slot stickiness on reconnect.
        }
        return;
      }
      if (msg.type === "turn") {
        setTurn(msg);
        return;
      }
      if (msg.type === "haptic" && navigator.vibrate) {
        navigator.vibrate(msg.pattern);
      }
    },
    [roomCode],
  );

  const onRejected = useCallback((code: number) => {
    if (code === CLOSE_ROOM_FULL) setRoomFull(true);
  }, []);

  const { connected, send } = useRoomSocket<PresenceMessage | AssignedMessage | ScreenMessage>({
    roomCode: permission === "granted" ? roomCode : "",
    role: "controller",
    onMessage,
    wantPlayer: player,
    onRejected,
  });

  const { recenter } = useMotionStream(permission === "granted" ? send : undefined);

  const handleRecenter = useCallback(() => {
    recenter();
    send({ type: "recenter" });
  }, [recenter, send]);

  if (permission !== "granted") {
    return <PermissionGate onGranted={() => setPermission("granted")} />;
  }

  if (roomFull) {
    return (
      <div className="controller-notice">
        <h1>Room is full</h1>
        <p>
          Room {roomCode} already has {MAX_PLAYERS} players. Ask someone to close their remote, then
          reload this page to take their slot.
        </p>
      </div>
    );
  }

  return (
    <Wiimote
      connected={connected}
      screenConnected={presence?.screenConnected ?? false}
      send={send}
      roomCode={roomCode}
      player={player}
      turn={turn}
      onRecenter={handleRecenter}
    />
  );
}
