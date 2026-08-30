import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import type { Mii } from "../mii/Mii";
import type { PlayerInfo } from "./types";
import "./turn-rounds.css";
import { TurnRoundsOverlay } from "./TurnRoundsOverlay";

export type Subscribe = (fn: (msg: ControllerMessage, player: number) => void) => () => void;

/** What a spectator screen is sent for any take-turns game. */
export interface TurnRoundsSnapshot {
  kind: "turn-rounds";
  title: string;
  scoreSuffix?: string;
  stage: "handoff" | "playing" | "results";
  players: PlayerInfo[];
  scores: number[];
  activeIndex: number;
  /** The wrapped game's own snapshot, present only while a round is running. */
  round?: unknown;
}

/** What a single player's round is handed. The round is remounted for each
 * turn, so it never has to reset itself between players. */
export interface RoundProps {
  /** Already filtered to whoever is up -- other remotes are ignored. */
  subscribe: Subscribe;
  /** Addressed to whoever is up, so a round's haptics buzz the phone
   * actually playing rather than everyone in the room. */
  send: (msg: object) => void;
  /** Publish this round's render state for spectator screens. Wrapped so
   * the mirror also learns whose round it is and the running scores. */
  publish: (state: unknown) => void;
  mii: Mii;
  /** Call once when this player's round is over, with their final score. */
  onFinish: (score: number) => void;
}

interface TurnRoundsProps {
  players: PlayerInfo[];
  send: (msg: object) => void;
  subscribe: Subscribe;
  onExit: () => void;
  publish: (state: unknown) => void;
  /** Shown on the hand-off and results cards, e.g. "Shooting Range". */
  title: string;
  /** Unit for the score readout, e.g. "pts". */
  scoreSuffix?: string;
  renderRound: (props: RoundProps) => ReactNode;
}

const RESULTS_AUTO_EXIT_MS = 20000;

/**
 * Runs a single-player game once per player, in turn, then ranks the scores.
 *
 * The wrapped game doesn't need to know multiplayer exists: it plays exactly
 * as it always did, is handed only the active player's input, and reports a
 * score when it's done. Each turn remounts it (via `key`), which is what
 * resets its internal state between players without every game having to
 * grow its own reset path.
 */
export function TurnRounds({
  players,
  send,
  subscribe,
  onExit,
  publish,
  title,
  scoreSuffix,
  renderRound,
}: TurnRoundsProps) {
  const multiplayer = players.length > 1;
  const [index, setIndex] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  // Solo play goes straight in; a room full of people gets a hand-off card
  // so nobody's round starts while they're still passing the phone over.
  const [stage, setStage] = useState<"handoff" | "playing" | "results">(multiplayer ? "handoff" : "playing");

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const sendRef = useRef(send);
  sendRef.current = send;

  const active = players[Math.min(index, players.length - 1)];

  // Keep every phone told whose turn it is.
  useEffect(() => {
    sendRef.current({
      type: "turn",
      player: stage === "results" ? 0 : active.player,
      label: stage === "results" ? undefined : title,
    });
  }, [active.player, stage, title]);

  useEffect(() => {
    return () => sendRef.current({ type: "turn", player: 0 });
  }, []);

  // Scores are kept in a ref as well so the next index can be derived
  // without nesting state updates inside an updater.
  const scoresRef = useRef<number[]>([]);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const indexRef = useRef(index);
  indexRef.current = index;
  const handleFinish = useCallback(
    (score: number) => {
      scoresRef.current = [...scoresRef.current, score];
      const nextIndex = scoresRef.current.length;
      setScores(scoresRef.current);
      setIndex(nextIndex);
      setStage(nextIndex >= players.length ? "results" : "handoff");
    },
    [players.length],
  );

  const publishRef = useRef(publish);
  publishRef.current = publish;

  /** Everything a spectator needs, whatever stage we're at. `round` carries
   * the wrapped game's own state while someone is actually playing. */
  const publishStage = useCallback(
    (round: unknown) => {
      publishRef.current({
        kind: "turn-rounds",
        title,
        scoreSuffix,
        stage: stageRef.current,
        players,
        scores: scoresRef.current,
        activeIndex: indexRef.current,
        round,
      } satisfies TurnRoundsSnapshot);
    },
    [title, scoreSuffix, players],
  );

  // The overlay stages don't animate, so a slow heartbeat is plenty.
  useEffect(() => {
    if (stage === "playing") return;
    publishStage(undefined);
    const timer = window.setInterval(() => publishStage(undefined), 500);
    return () => window.clearInterval(timer);
  }, [stage, publishStage]);

  const roundSend = useCallback(
    (msg: object) => sendRef.current(multiplayer ? { ...msg, to: active.player } : msg),
    [active.player, multiplayer],
  );

  /** Only the player whose turn it is can drive their own round. */
  const roundSubscribe = useCallback<Subscribe>(
    (fn) => subscribe((msg, player) => {
      if (!multiplayer || player === active.player) fn(msg, player);
    }),
    [subscribe, active.player, multiplayer],
  );

  // A to start your round, and A to leave once the results are up.
  useEffect(() => {
    if (stage === "playing") return;
    return subscribe((msg, player) => {
      if (msg.type !== "button" || msg.button !== "A" || msg.state !== "down") return;
      if (stage === "handoff") {
        if (player === active.player) setStage("playing");
      } else {
        onExitRef.current();
      }
    });
  }, [stage, subscribe, active.player]);

  useEffect(() => {
    if (stage !== "results") return;
    const timer = window.setTimeout(() => onExitRef.current(), RESULTS_AUTO_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  if (stage !== "playing") {
    return (
      <TurnRoundsOverlay
        snapshot={{ kind: "turn-rounds", title, scoreSuffix, stage, players, scores, activeIndex: index }}
      />
    );
  }

  // Keyed on the turn, so the wrapped game is genuinely remounted for each
  // player rather than reconciled into the previous player's state.
  return (
    <Fragment key={index}>
      {renderRound({
        subscribe: roundSubscribe,
        send: roundSend,
        publish: publishStage,
        mii: active.mii,
        onFinish: handleFinish,
      })}
    </Fragment>
  );
}
