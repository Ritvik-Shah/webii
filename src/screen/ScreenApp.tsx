import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { ControllerMessage, PresenceMessage } from "../../shared/protocol";
import { isPresence } from "../../shared/protocol";
import { createEventBus, type EventBus } from "../lib/eventBus";
import { fetchNewRoomCode } from "../lib/roomCode";
import { useRoomSocket } from "../lib/useRoomSocket";
import { PairingScreen } from "./PairingScreen";
import { WiiMenu } from "./WiiMenu";
import { CHANNELS } from "./channels";
import { MiiSelect } from "./mii/MiiSelect";
import { LaneSelect } from "./mii/LaneSelect";
import type { Mii } from "./mii/Mii";
import { Tennis } from "./games/Tennis";
import { Bowling } from "./games/Bowling";
import { SwordDuel } from "./games/SwordDuel";
import type { GameProps } from "./games/types";

const GAME_SCREENS: Record<string, ComponentType<GameProps>> = {
  tennis: Tennis,
  bowling: Bowling,
  sword: SwordDuel,
};

// Bowling gets an extra lane-select step between choosing a Mii and playing,
// matching the real game's flow. Every other channel goes straight from Mii
// select into the game.
const CHANNELS_WITH_LANE_SELECT = new Set(["bowling"]);

type ScreenView =
  | { kind: "menu" }
  | { kind: "mii-select"; channelId: string }
  | { kind: "lane-select"; channelId: string; mii: Mii }
  | { kind: "game"; channelId: string; mii: Mii; lane?: number };

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
    // HOME always returns to the Wii Menu, from any view (game, Mii select,
    // lane select), handled centrally here so individual screens don't each
    // need to listen for it.
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
    setView({ kind: "mii-select", channelId });
  }, []);

  const handleMiiSelected = useCallback((mii: Mii) => {
    setView((current) => {
      if (current.kind !== "mii-select") return current;
      const { channelId } = current;
      if (CHANNELS_WITH_LANE_SELECT.has(channelId)) {
        return { kind: "lane-select", channelId, mii };
      }
      return { kind: "game", channelId, mii };
    });
  }, []);

  const handleLaneSelected = useCallback((lane: number) => {
    setView((current) => {
      if (current.kind !== "lane-select") return current;
      return { kind: "game", channelId: current.channelId, mii: current.mii, lane };
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
      case "lane-select":
        return <LaneSelect subscribe={subscribe} onSelect={handleLaneSelected} />;
      case "game": {
        const GameScreen = GAME_SCREENS[view.channelId];
        if (!GameScreen) return null;
        return (
          <GameScreen
            send={send}
            subscribe={subscribe}
            onExit={() => setView({ kind: "menu" })}
            mii={view.mii}
            lane={view.lane}
          />
        );
      }
      default:
        return null;
    }
  };

  return <div className="screen-root">{renderMain()}</div>;
}
