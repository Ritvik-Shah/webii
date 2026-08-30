import { lazy, Suspense, useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import type { PresenceMessage, ScreenMessage, SnapshotMessage } from "../../shared/protocol";
import { isPresence, isSnapshot } from "../../shared/protocol";
import { useRoomSocket } from "../lib/useRoomSocket";
import { TanksVersusSpectator } from "./games/TanksVersusSpectator";
import type { TanksVersusSnapshot } from "./games/TanksVersus";
import type { BowlingSnapshot } from "./games/bowling/Bowling";

// Bowling drags in three.js, so a spectator only downloads it if the room is
// actually bowling -- same reasoning as the host side.
const BowlingSpectator = lazy(() =>
  import("./games/bowling/BowlingSpectator").then((m) => ({ default: m.BowlingSpectator })),
);

/** What the non-game screens publish: just enough to say what's going on. */
interface LobbySnapshot {
  players: number[];
  roomCode: string;
}

/**
 * A read-only second screen for a room. Useful two ways: a remote player
 * opens it so they have something to look at while their phone plays, and a
 * room with more than one TV can mirror the game onto both.
 */
export function SpectatorApp() {
  const { roomCode = "" } = useParams<{ roomCode: string }>();
  const [snapshot, setSnapshot] = useState<SnapshotMessage | null>(null);
  const [presence, setPresence] = useState<PresenceMessage | null>(null);

  const onMessage = useCallback((msg: PresenceMessage | ScreenMessage) => {
    if (isPresence(msg)) {
      setPresence(msg);
      return;
    }
    if (isSnapshot(msg)) setSnapshot(msg);
  }, []);

  const { connected } = useRoomSocket<PresenceMessage | ScreenMessage>({
    roomCode,
    role: "spectator",
    onMessage,
  });

  if (snapshot?.view === "game:bowling") {
    return (
      <Suspense fallback={<div className="screen-loading">Loading alley…</div>}>
        <BowlingSpectator snapshot={snapshot.state as BowlingSnapshot} />
      </Suspense>
    );
  }

  if (snapshot?.view === "game:tanks") {
    const state = snapshot.state as TanksVersusSnapshot;
    // Solo Tanks is the campaign, which doesn't publish a world to mirror.
    if (state?.world) return <TanksVersusSpectator snapshot={state} />;
  }

  // Everything else (lobby, menu, Mii select, and the games that don't
  // mirror yet) gets a status card rather than a blank screen.
  const lobby = snapshot?.state as LobbySnapshot | undefined;
  const waitingFor = !connected
    ? "Connecting…"
    : !presence?.screenConnected
      ? "Waiting for the main screen to open this room"
      : snapshot === null
        ? "Connected — waiting for the screen to start something"
        : describe(snapshot.view);

  return (
    <div className="spectator-idle">
      <h1 className="spectator-title">Webii</h1>
      <p className="spectator-room">Watching room {roomCode}</p>
      <p className="spectator-status">{waitingFor}</p>
      {lobby?.players?.length ? (
        <p className="spectator-players">
          {lobby.players.length} player{lobby.players.length === 1 ? "" : "s"} in the room
        </p>
      ) : null}
    </div>
  );
}

function describe(view: string): string {
  if (view === "lobby") return "In the lobby, waiting for players to join";
  if (view === "menu") return "Browsing the Wii Menu";
  if (view === "mii-select") return "Choosing Miis";
  if (view.startsWith("game:")) return `Playing ${view.slice(5)} — this one doesn't mirror yet`;
  return "Watching";
}
