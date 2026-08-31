import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import type { AssignedMessage, PhoneView, PresenceMessage, RemovedMessage, ScreenMessage, TurnMessage } from "../../shared/protocol";
import { CLOSE_REMOVED, CLOSE_ROOM_FULL, MAX_PLAYERS, isAssigned, isPhoneView, isPresence, isRemoved } from "../../shared/protocol";
import { useRoomSocket } from "../lib/useRoomSocket";
import { useWakeLock } from "../lib/useWakeLock";
import { useMotionStream } from "./useMotionStream";
import PermissionGate from "./PermissionGate";
import PhoneGameView from "./PhoneGameView";
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
  // Phones sleep fastest of all, and a remote is often idle between turns.
  // Held only once past the permission gate, which is also the tap that
  // makes the request allowed.
  useWakeLock(permission === "granted");
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [player, setPlayer] = useState<number>(() => rememberedSlot(roomCode));
  const [roomFull, setRoomFull] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [turn, setTurn] = useState<TurnMessage | null>(null);
  // When a card or party game is running, the host drives what this phone
  // shows; a null view hands it back to the ordinary remote.
  const [phoneView, setPhoneView] = useState<PhoneView | null>(null);

  const onMessage = useCallback(
    (msg: PresenceMessage | AssignedMessage | RemovedMessage | ScreenMessage) => {
      if (isPresence(msg)) {
        setPresence(msg);
        return;
      }
      if (isRemoved(msg)) {
        setRemoved(true);
        // Forget the slot so a deliberate rejoin takes a fresh one rather
        // than reclaiming the seat the host just cleared.
        try {
          sessionStorage.removeItem(slotKey(roomCode));
        } catch {
          // Nothing to clean up if storage is unavailable.
        }
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
      if (isPhoneView(msg)) {
        setPhoneView(msg.view);
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

  const onRejected = useCallback(
    (code: number) => {
      if (code === CLOSE_ROOM_FULL) setRoomFull(true);
      if (code === CLOSE_REMOVED) {
        setRemoved(true);
        // Forget the slot, so rejoining takes a fresh one rather than
        // trying to reclaim the seat the host just cleared.
        try {
          sessionStorage.removeItem(slotKey(roomCode));
        } catch {
          // Nothing to clean up if storage is unavailable.
        }
      }
    },
    [roomCode],
  );

  const { connected, send } = useRoomSocket<PresenceMessage | AssignedMessage | RemovedMessage | ScreenMessage>({
    // Blanking the room code keeps the socket closed, so a removed phone
    // doesn't immediately reconnect and retake a slot.
    roomCode: permission === "granted" && !removed ? roomCode : "",
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

  if (removed) {
    return (
      <div className="controller-notice">
        <h1>Removed from the room</h1>
        <p>Player 1 dropped you from room {roomCode}. Reload this page to join again.</p>
      </div>
    );
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

  if (phoneView) {
    return <PhoneGameView view={phoneView} send={send} roomCode={roomCode} player={player} />;
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
