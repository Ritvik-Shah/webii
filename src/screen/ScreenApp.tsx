import { useCallback, useEffect, useRef, useState } from "react";
import type { ControllerMessage, PresenceMessage } from "../../shared/protocol";
import { isPresence } from "../../shared/protocol";
import { createEventBus, type EventBus } from "../lib/eventBus";
import { fetchNewRoomCode } from "../lib/roomCode";
import { useRoomSocket } from "../lib/useRoomSocket";
import { PairingScreen } from "./PairingScreen";
import { WiiMenu } from "./WiiMenu";

export function ScreenApp() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);

  const busRef = useRef<EventBus<ControllerMessage> | null>(null);
  if (!busRef.current) busRef.current = createEventBus<ControllerMessage>();

  useEffect(() => {
    let cancelled = false;
    fetchNewRoomCode()
      .then((code) => {
        if (!cancelled) setRoomCode(code);
      })
      .catch(() => {
        // Room code fetch failed; stay on the loading state for now.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onMessage = useCallback((msg: PresenceMessage | ControllerMessage) => {
    if (isPresence(msg)) {
      setPresence(msg);
    } else {
      busRef.current!.emit(msg as ControllerMessage);
    }
  }, []);

  const { connected, send } = useRoomSocket<PresenceMessage | ControllerMessage>({
    roomCode: roomCode ?? "",
    role: "screen",
    onMessage,
  });

  return (
    <div className="screen-root">
      {roomCode === null ? (
        <div className="screen-loading">Loading Webii…</div>
      ) : !presence?.controllerConnected ? (
        <PairingScreen roomCode={roomCode} screenSocketConnected={connected} />
      ) : (
        <WiiMenu send={send} subscribe={busRef.current.subscribe} />
      )}
    </div>
  );
}
