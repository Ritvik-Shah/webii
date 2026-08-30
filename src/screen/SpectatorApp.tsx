import { lazy, Suspense, useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import type { PresenceMessage, ScreenMessage, SnapshotMessage } from "../../shared/protocol";
import { isPresence, isSnapshot } from "../../shared/protocol";
import { useRoomSocket } from "../lib/useRoomSocket";
import { PairingScreen } from "./PairingScreen";
import { WiiMenu, type WiiMenuSnapshot } from "./WiiMenu";
import { PlayerManager } from "./PlayerManager";
import { MiiSelect } from "./mii/MiiSelect";
import type { MiiSelectSnapshot } from "./mii/MiiSelect";
import { MiiPlaza } from "./mii/MiiPlaza";
import { MiiEditor } from "./mii/MiiEditor";
import type { MiiChannelSnapshot } from "./mii/MiiChannel";
import { TanksVersusSpectator } from "./games/TanksVersusSpectator";
import type { TanksVersusSnapshot } from "./games/TanksVersus";
import { TanksCampaignSpectator } from "./games/TanksCampaignSpectator";
import type { CampaignSnapshot } from "./games/Tanks";
import type { BowlingSnapshot } from "./games/bowling/Bowling";
import type { TurnRoundsSnapshot } from "./games/TurnRounds";
import { TurnRoundsOverlay } from "./games/TurnRoundsOverlay";
import { RangeSpectator } from "./games/RangeSpectator";
import { ChargeSpectator } from "./games/ChargeSpectator";
import type { ChargeSnapshot } from "./games/Charge";
import type { RangeSnapshot } from "./games/TargetPractice";

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

const noSubscribe = () => () => {};
const noOp = () => {};

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

  const basic = snapshot?.state as LobbySnapshot | undefined;
  const players = basic?.players ?? presence?.players ?? [];

  if (snapshot?.view === "lobby" && basic) {
    return <PairingScreen roomCode={basic.roomCode} screenSocketConnected={connected} players={players} subscribe={noSubscribe} onKick={noOp} />;
  }

  if (snapshot?.view === "menu") {
    return <WiiMenu send={noOp} subscribe={noSubscribe} onLaunch={noOp} spectating snapshot={snapshot.state as WiiMenuSnapshot} />;
  }

  if (snapshot?.view === "player-manager") {
    return <PlayerManager players={players} subscribe={noSubscribe} onKick={noOp} />;
  }

  if (snapshot?.view === "mii-select") {
    const state = snapshot.state as MiiSelectSnapshot;
    if (state?.kind === "mii-select") {
      return <MiiSelect key={JSON.stringify(state)} subscribe={noSubscribe} channelTitle={state.channelTitle} players={state.queue} onDone={noOp} spectating initialRoster={state.roster} initialQueue={state.queue} initialPicks={state.picks} />;
    }
  }

  if (snapshot?.view === "mii-channel") {
    const state = snapshot.state as MiiChannelSnapshot;
    if (state?.mode === "editor" && state.editorMii) {
      return <MiiEditor key={JSON.stringify(state.editorMii)} subscribe={noSubscribe} mii={state.editorMii} onSave={noOp} onBack={noOp} />;
    }
    if (state) return <MiiPlaza subscribe={noSubscribe} roster={state.roster} onSelectMii={noOp} onNewMii={noOp} spectating />;
  }

  if (snapshot?.view === "game:bowling") {
    return (
      <Suspense fallback={<div className="screen-loading">Loading alley…</div>}>
        <BowlingSpectator snapshot={snapshot.state as BowlingSnapshot} />
      </Suspense>
    );
  }

  if (snapshot?.view === "game:tanks") {
    const state = snapshot.state as TanksVersusSnapshot | CampaignSnapshot;
    if (state?.kind === "campaign") return <TanksCampaignSpectator snapshot={state} />;
    if (state?.kind === "versus") return <TanksVersusSpectator snapshot={state} />;
  }

  // The take-turns games publish a common wrapper snapshot: between rounds
  // it's the hand-off or results card, and during a round it carries that
  // game's own state.
  const turns = snapshot?.state as TurnRoundsSnapshot | undefined;
  if (turns?.kind === "turn-rounds") {
    if (turns.stage !== "playing") return <TurnRoundsOverlay snapshot={turns} spectating />;
    if (snapshot?.view === "game:target" && turns.round) {
      return <RangeSpectator snapshot={turns.round as RangeSnapshot} />;
    }
    if (snapshot?.view === "game:charge" && turns.round) {
      return (
        <ChargeSpectator
          snapshot={turns.round as ChargeSnapshot}
          mii={turns.players[turns.activeIndex].mii}
        />
      );
    }
    // A round is running for a game whose in-play view doesn't mirror yet.
    return (
      <div className="spectator-idle">
        <h1 className="spectator-title">{turns.title}</h1>
        <p className="spectator-room">Watching room {roomCode}</p>
        <p className="spectator-status">
          Player {turns.players[turns.activeIndex]?.player} is playing — this game's round doesn't mirror yet
        </p>
      </div>
    );
  }

  // Everything else (lobby, menu, Mii select) gets a status card rather than
  // a blank screen.
  const lobby = basic;
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
