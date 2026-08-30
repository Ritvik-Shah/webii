import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { ControllerMessage, PresenceMessage, StampedControllerMessage } from "../../shared/protocol";
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
import type { PlayerInfo } from "./games/types";
import { TargetPractice } from "./games/TargetPractice";
import { Tanks } from "./games/Tanks";
import { Charge } from "./games/Charge";
import { NesUpload } from "./nes/NesUpload";
import { NesGame1, NesGame2 } from "./nes/BundledGames";
import { NdsChannel } from "./nds/NdsChannel";
import type { GameProps } from "./games/types";

// Bowling is the only channel that pulls in three.js, and it roughly doubles
// the bundle. Loading it on demand keeps the menu and every other channel
// as light as they were before it existed.
const Bowling = lazy(() => import("./games/bowling/Bowling").then((m) => ({ default: m.Bowling })));

const GAME_SCREENS: Record<string, ComponentType<GameProps>> = {
  bowling: Bowling,
  target: TargetPractice,
  tanks: Tanks,
  charge: Charge,
  "nes-upload": NesUpload,
  "nes-1": NesGame1,
  "nes-2": NesGame2,
  "nds-channel": NdsChannel,
};

type ScreenView =
  | { kind: "lobby" }
  | { kind: "menu" }
  | { kind: "mii-channel" }
  | { kind: "mii-select"; channelId: string }
  | { kind: "game"; channelId: string; players: PlayerInfo[] };

export function ScreenApp() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [view, setView] = useState<ScreenView>({ kind: "lobby" });

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

  const onMessage = useCallback((msg: PresenceMessage | StampedControllerMessage) => {
    if (isPresence(msg)) {
      setPresence(msg);
      return;
    }
    const player = msg.player ?? 0;
    // HOME always returns to the Wii Menu, from any view (game or Mii
    // select), handled centrally here so individual screens don't each need
    // to listen for it.
    if (msg.type === "button" && msg.button === "HOME" && msg.state === "down") {
      setView({ kind: "menu" });
    }
    busRef.current!.emit(msg as ControllerMessage, player);
  }, []);

  const { connected, send } = useRoomSocket<PresenceMessage | StampedControllerMessage>({
    roomCode: roomCode ?? "",
    role: "screen",
    onMessage,
  });

  const players = presence?.players ?? [];
  const spectators = presence?.spectators ?? 0;
  // The lowest-numbered connected player drives shared screens (the lobby,
  // the Wii Menu) so four remotes don't fight over one cursor.
  const hostPlayer = players[0];

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

  const handleMiiSelected = useCallback((picks: PlayerInfo[]) => {
    setView((current) => {
      if (current.kind !== "mii-select") return current;
      return { kind: "game", channelId: current.channelId, players: picks };
    });
  }, []);

  const subscribe = busRef.current.subscribe;

  // Snapshots are what spectator screens draw from. Skipped entirely when
  // nobody is watching, so a normal session pays nothing for the feature.
  const spectatorsRef = useRef(spectators);
  spectatorsRef.current = spectators;
  const publishAs = useCallback(
    (view: string) => (state: unknown) => {
      if (spectatorsRef.current > 0) send({ type: "snapshot", view, state });
    },
    [send],
  );

  // The non-game screens don't need mirroring frame by frame -- a spectator
  // only needs to know what the host is busy with.
  useEffect(() => {
    if (spectators === 0 || view.kind === "game") return;
    const publish = publishAs(view.kind);
    const tick = () => publish({ players, roomCode });
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [spectators, view, players, roomCode, publishAs]);

  // In the lobby, the host's A press starts the session. Kept here rather
  // than inside PairingScreen so the lobby stays a pure display component.
  useEffect(() => {
    if (view.kind !== "lobby" || hostPlayer === undefined) return;
    return subscribe((msg, player) => {
      if (player !== hostPlayer) return;
      if (msg.type === "button" && msg.button === "A" && msg.state === "down") {
        setView({ kind: "menu" });
      }
    });
  }, [view.kind, hostPlayer, subscribe]);

  // Everyone left: fall back to the lobby so the room can be re-joined.
  useEffect(() => {
    if (players.length === 0 && view.kind !== "lobby") setView({ kind: "lobby" });
  }, [players.length, view.kind]);

  const renderMain = () => {
    if (roomCode === null) {
      return <div className="screen-loading">Loading Webii…</div>;
    }
    if (view.kind === "lobby" || players.length === 0) {
      return <PairingScreen roomCode={roomCode} screenSocketConnected={connected} players={players} />;
    }

    switch (view.kind) {
      case "menu":
        return <WiiMenu send={send} subscribe={subscribe} onLaunch={handleLaunch} hostPlayer={hostPlayer} />;
      case "mii-channel":
        return <MiiChannel subscribe={subscribe} onExit={() => setView({ kind: "menu" })} />;
      case "mii-select": {
        const channel = CHANNELS.find((c) => c.id === view.channelId);
        return (
          <MiiSelect
            subscribe={subscribe}
            channelTitle={channel?.title ?? "the game"}
            players={players}
            onDone={handleMiiSelected}
          />
        );
      }
      case "game": {
        const GameScreen = GAME_SCREENS[view.channelId];
        if (!GameScreen) return null;
        return (
          <Suspense fallback={<div className="screen-loading">Loading channel…</div>}>
            <GameScreen
              send={send}
              subscribe={subscribe}
              onExit={() => setView({ kind: "menu" })}
              players={view.players}
              publish={publishAs(`game:${view.channelId}`)}
              spectators={spectators}
            />
          </Suspense>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="screen-root">
      {renderMain()}
      {players.length > 0 && <DebugOverlay subscribe={subscribe} />}
    </div>
  );
}
