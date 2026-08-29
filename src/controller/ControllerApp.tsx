import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import type { PresenceMessage, ScreenMessage } from "../../shared/protocol";
import { isPresence } from "../../shared/protocol";
import { useRoomSocket } from "../lib/useRoomSocket";
import { useMotionStream } from "./useMotionStream";
import PermissionGate from "./PermissionGate";
import Wiimote from "./Wiimote";

export default function ControllerApp() {
  const { roomCode = "" } = useParams<{ roomCode: string }>();
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [presence, setPresence] = useState<PresenceMessage | null>(null);

  const onMessage = useCallback((msg: PresenceMessage | ScreenMessage) => {
    if (isPresence(msg)) {
      setPresence(msg);
    } else {
      // ScreenMessage (game-state/haptic) handling arrives in a later phase.
    }
  }, []);

  const { connected, send } = useRoomSocket<PresenceMessage | ScreenMessage>({
    roomCode: permission === "granted" ? roomCode : "",
    role: "controller",
    onMessage,
  });

  const { recenter } = useMotionStream(permission === "granted" ? send : undefined);

  const handleRecenter = useCallback(() => {
    recenter();
    send({ type: "recenter" });
  }, [recenter, send]);

  if (permission !== "granted") {
    return <PermissionGate onGranted={() => setPermission("granted")} />;
  }

  return (
    <Wiimote
      connected={connected}
      screenConnected={presence?.screenConnected ?? false}
      send={send}
      roomCode={roomCode}
      onRecenter={handleRecenter}
    />
  );
}
