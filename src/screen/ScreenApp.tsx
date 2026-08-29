import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { ControllerMessage, PresenceMessage } from "../../shared/protocol";
import { isPresence } from "../../shared/protocol";
import { createEventBus, type EventBus } from "../lib/eventBus";
import { fetchNewRoomCode } from "../lib/roomCode";
import { useRoomSocket } from "../lib/useRoomSocket";
import { PairingScreen } from "./PairingScreen";
import { WiiMenu } from "./WiiMenu";
import { DebugOverlay } from "./DebugOverlay";
import { CHANNELS } from "./channels";
import { MiiSelect } from "./mii/MiiSelect";
import { MiiChannel } from "./mii/MiiChannel";
import type { Mii } from "./mii/Mii";
import { TargetPractice } from "./games/TargetPractice";
import { Tanks } from "./games/Tanks";
import { Charge } from "./games/Charge";
import { NesUpload } from "./nes/NesUpload";
import { NesGame1, NesGame2 } from "./nes/BundledGames";
import { NdsChannel } from "./nds/NdsChannel";
import type { GameProps } from "./games/types";

const GAME_SCREENS: Record<string, ComponentType<GameProps>> = {
  target: TargetPractice,
  tanks: Tanks,
  charge: Charge,
  "nes-upload": NesUpload,
  "nes-1": NesGame1,
  "nes-2": NesGame2,
  "nds-channel": NdsChannel,
};

type ScreenView =
  | { kind: "menu" }
  | { kind: "mii-channel" }
  | { kind: "mii-select"; channelId: string }
  | { kind: "game"; channelId: string; mii: Mii };

export function ScreenApp() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [view, setView] = useState<ScreenView>({ kind: "menu" });

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
    // HOME always returns to the Wii Menu, from any view (game or Mii
    // select), handled centrally here so individual screens don't each need
    // to listen for it.
    if (msg.type === "button" && msg.button === "HOME" && msg.state === "down") {
      setView({ kind: "menu" });
    }
    busRef.current!.emit(msg);
  }, []);

  const { connected, send } = useRoomSocket<PresenceMessage | ControllerMessage>({
    roomCode: roomCode ?? "",
    role: "screen",
    onMessage,
  });

  const handleLaunch = useCallback((channelId: string) => {
    // The Mii Channel IS the "pick/make a Mii" experience -- routing it
    // through Mii Select first would be circular, so it skips straight to
    // the editor.
    if (channelId === "mii") {
      setView({ kind: "mii-channel" });
    } else {
      setView({ kind: "mii-select", channelId });
    }
  }, []);

  const handleMiiSelected = useCallback((mii: Mii) => {
    setView((current) => {
      if (current.kind !== "mii-select") return current;
      return { kind: "game", channelId: current.channelId, mii };
    });
  }, []);

  const subscribe = busRef.current.subscribe;

  const renderMain = () => {
    if (roomCode === null) {
      return <div className="screen-loading">Loading Webii…</div>;
    }
    if (!presence?.controllerConnected) {
      return <PairingScreen roomCode={roomCode} screenSocketConnected={connected} />;
    }

    switch (view.kind) {
      case "menu":
        return <WiiMenu send={send} subscribe={subscribe} onLaunch={handleLaunch} />;
      case "mii-channel":
        return <MiiChannel subscribe={subscribe} onExit={() => setView({ kind: "menu" })} />;
      case "mii-select": {
        const channel = CHANNELS.find((c) => c.id === view.channelId);
        return (
          <MiiSelect
            subscribe={subscribe}
            channelTitle={channel?.title ?? "the game"}
            onSelect={handleMiiSelected}
          />
        );
      }
      case "game": {
        const GameScreen = GAME_SCREENS[view.channelId];
        if (!GameScreen) return null;
        return (
          <GameScreen send={send} subscribe={subscribe} onExit={() => setView({ kind: "menu" })} mii={view.mii} />
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="screen-root">
      {renderMain()}
      {presence?.controllerConnected && <DebugOverlay subscribe={subscribe} />}
    </div>
  );
}
