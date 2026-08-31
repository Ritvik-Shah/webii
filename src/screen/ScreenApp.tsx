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
import { PlayerManager } from "./PlayerManager";
import type { PlayerInfo } from "./games/types";
import { TargetPractice } from "./games/TargetPractice";
import { Tanks } from "./games/Tanks";
import { Charge } from "./games/Charge";
import { Uno } from "./games/uno/Uno";
import { Poker } from "./games/poker/Poker";
import { Quiplash } from "./games/party/Quiplash";
import { Fibbage } from "./games/party/Fibbage";
import { FakinIt } from "./games/party/FakinIt";
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
  uno: Uno,
  poker: Poker,
  quiplash: Quiplash,
  fibbage: Fibbage,
  fakinit: FakinIt,
  "nes-upload": NesUpload,
  "nes-1": NesGame1,
  "nes-2": NesGame2,
  "nds-channel": NdsChannel,
};

type ScreenView =
  | { kind: "lobby" }
  | { kind: "menu" }
  | { kind: "mii-channel" }
  | { kind: "player-manager" }
  | { kind: "mii-select"; channelId: string }
  | { kind: "game"; channelId: string; players: PlayerInfo[] };

export function ScreenApp() {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);
  const [view, setView] = useState<ScreenView>({ kind: "lobby" });
  const [kickMenuOpen, setKickMenuOpen] = useState(false);
  const [kickTarget, setKickTarget] = useState<number | null>(null);

  const busRef = useRef<EventBus<ControllerMessage> | null>(null);
  if (!busRef.current) busRef.current = createEventBus<ControllerMessage>();
  const sendRef = useRef<(msg: object) => void>(() => {});
  const viewRef = useRef<ScreenView>(view);
  viewRef.current = view;
  const playersRef = useRef<number[]>([]);
  const kickMenuOpenRef = useRef(false);
  kickMenuOpenRef.current = kickMenuOpen;
  const kickTargetRef = useRef<number | null>(null);
  kickTargetRef.current = kickTarget;

  const pickKickTarget = useCallback((direction: 1 | -1) => {
    const candidates = playersRef.current.slice(1);
    if (candidates.length === 0) return;
    const current = kickTargetRef.current;
    const index = current === null ? -1 : candidates.indexOf(current);
    const next = candidates[(index + direction + candidates.length) % candidates.length];
    setKickTarget(next);
  }, []);

  const toggleKickMenu = useCallback(() => {
    if (playersRef.current.length < 2) return;
    setKickMenuOpen((open) => {
      if (!open && !playersRef.current.includes(kickTargetRef.current ?? 0)) {
        setKickTarget(playersRef.current[1]);
      }
      return !open;
    });
  }, []);

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
      playersRef.current = msg.players;
      setPresence(msg);
      return;
    }
    const player = msg.player ?? 0;
    const host = playersRef.current[0];
    if (viewRef.current.kind === "game" && player === host && msg.type === "button" && msg.state === "down") {
      if (msg.button === "MINUS") {
        toggleKickMenu();
        return;
      }
      if (kickMenuOpenRef.current) {
        if (msg.button === "UP") {
          pickKickTarget(-1);
          return;
        }
        if (msg.button === "DOWN") {
          pickKickTarget(1);
          return;
        }
        if (msg.button === "B") {
          const target = kickTargetRef.current;
          if (target !== null && target !== host) sendRef.current({ type: "kick", player: target });
          setKickMenuOpen(false);
          return;
        }
      }
    }
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
  sendRef.current = send;

  const players = presence?.players ?? [];
  const spectators = presence?.spectators ?? 0;
  // The lowest-numbered connected player drives shared screens (the lobby,
  // the Wii Menu) so four remotes don't fight over one cursor.
  const hostPlayer = players[0];

  useEffect(() => {
    if (kickTarget !== null && !players.includes(kickTarget)) setKickTarget(players[1] ?? null);
    if (players.length < 2) setKickMenuOpen(false);
  }, [players, kickTarget]);

  // Only ever removes someone other than the host, so player 1 can't drop
  // themselves and leave the room with nobody able to start it.
  const handleKick = useCallback(
    (player: number) => {
      if (player === hostPlayer) return;
      send({ type: "kick", player });
    },
    [send, hostPlayer],
  );

  const handleLaunch = useCallback((channelId: string) => {
    // The Mii Channel IS the "pick/make a Mii" experience -- routing it
    // through Mii Select first would be circular, so it skips straight to
    // the editor.
    if (channelId === "mii") {
      setView({ kind: "mii-channel" });
    } else if (channelId === "players") {
      setView({ kind: "player-manager" });
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
  // One publisher per view, cached, so a given screen always gets the same
  // function back. The screens that publish their own state list it as an
  // effect dependency, and handing them a fresh closure on every render made
  // those effects re-run -- and re-send -- on every render of this component.
  const publishersRef = useRef(new Map<string, (state: unknown) => void>());
  const publishAs = useCallback((view: string) => {
    const cache = publishersRef.current;
    const existing = cache.get(view);
    if (existing) return existing;
    const publish = (state: unknown) => {
      if (spectatorsRef.current > 0) sendRef.current({ type: "snapshot", view, state });
    };
    cache.set(view, publish);
    return publish;
  }, []);

  // Static screens get a light heartbeat. Interactive screens publish their
  // own current visual state so a watch screen sees the same menu or editor.
  useEffect(() => {
    if (spectators === 0 || view.kind === "game" || view.kind === "menu" || view.kind === "mii-select" || view.kind === "mii-channel") return;
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
      return (
        <PairingScreen
          roomCode={roomCode}
          screenSocketConnected={connected}
          players={players}
          subscribe={subscribe}
          hostPlayer={hostPlayer}
          onKick={handleKick}
        />
      );
    }

    switch (view.kind) {
      case "menu":
        return <WiiMenu send={send} subscribe={subscribe} onLaunch={handleLaunch} hostPlayer={hostPlayer} onSnapshot={publishAs("menu")} />;
      case "mii-channel":
        return <MiiChannel subscribe={subscribe} hostPlayer={hostPlayer} onExit={() => setView({ kind: "menu" })} onSnapshot={publishAs("mii-channel")} />;
      case "player-manager":
        return <PlayerManager players={players} subscribe={subscribe} hostPlayer={hostPlayer} onKick={handleKick} />;
      case "mii-select": {
        const channel = CHANNELS.find((c) => c.id === view.channelId);
        return (
          <MiiSelect
            subscribe={subscribe}
            channelTitle={channel?.title ?? "the game"}
            players={players}
            onDone={handleMiiSelected}
            onSnapshot={publishAs("mii-select")}
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
      {view.kind === "game" && kickMenuOpen && (
        <div className="player-manager" role="dialog" aria-label="Player manager">
          <h2>Player Manager</h2>
          <p>Remove a disconnected player without leaving the game.</p>
          {players.slice(1).map((player) => (
            <div key={player} className={`player-manager-seat${player === kickTarget ? " is-selected" : ""}`}>
              Player {player}{player === kickTarget ? " — B to remove" : ""}
            </div>
          ))}
          <small>Player 1: Up/Down choose · B remove · − close</small>
        </div>
      )}
      {players.length > 0 && <DebugOverlay subscribe={subscribe} />}
    </div>
  );
}
