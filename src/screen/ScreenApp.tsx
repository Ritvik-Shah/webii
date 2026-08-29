import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { ControllerMessage, PresenceMessage } from "../../shared/protocol";
import { isPresence } from "../../shared/protocol";
import { createEventBus, type EventBus } from "../lib/eventBus";
import { fetchNewRoomCode } from "../lib/roomCode";
import { useRoomSocket } from "../lib/useRoomSocket";
import { PairingScreen } from "./PairingScreen";
import { WiiMenu } from "./WiiMenu";
import { Tennis } from "./games/Tennis";
import { Bowling } from "./games/Bowling";
import { SwordDuel } from "./games/SwordDuel";
import type { GameProps } from "./games/types";

const GAME_SCREENS: Record<string, ComponentType<GameProps>> = {
  tennis: Tennis,
  bowling: Bowling,
  sword: SwordDuel,
};

export function ScreenApp() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);

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
      return;
    }
    // HOME always returns to the Wii Menu, from any game, handled centrally
    // here so individual games don't each need to listen for it.
    if (msg.type === "button" && msg.button === "HOME" && msg.state === "down") {
      setActiveChannel(null);
    }
    busRef.current!.emit(msg);
  }, []);

  const { connected, send } = useRoomSocket<PresenceMessage | ControllerMessage>({
    roomCode: roomCode ?? "",
    role: "screen",
    onMessage,
  });

  const ActiveGame = activeChannel ? GAME_SCREENS[activeChannel] : null;

  return (
    <div className="screen-root">
      {roomCode === null ? (
        <div className="screen-loading">Loading Webii…</div>
      ) : !presence?.controllerConnected ? (
        <PairingScreen roomCode={roomCode} screenSocketConnected={connected} />
      ) : ActiveGame ? (
        <ActiveGame send={send} subscribe={busRef.current.subscribe} onExit={() => setActiveChannel(null)} />
      ) : (
        <WiiMenu send={send} subscribe={busRef.current.subscribe} onLaunch={setActiveChannel} />
      )}
    </div>
  );
}
