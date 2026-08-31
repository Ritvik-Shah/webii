import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./party.css";
import type { PhoneView } from "../../../../shared/protocol";
import { MiiAvatar } from "../../mii/MiiAvatar";
import type { GameProps } from "../types";
import {
  assignPrompts,
  eligibleVoters,
  promptsFor,
  scoreMatchup,
  standings,
  type Matchup,
} from "./core";
import { LAST_LASH_PROMPTS, QUIP_PROMPTS, pickSome } from "./content";

/** Everyone writes both answers inside this one window, as asked. */
const WRITING_SECONDS = 90;
const VOTE_SECONDS = 20;
const REVEAL_MS = 5000;
/** Rounds one and two are worth 1x and 2x; the Last Lash is worth 3x. */
const MULTIPLIERS = [1, 2, 3];
const MAX_ANSWER = 80;

type Phase = "intro" | "writing" | "voting" | "reveal" | "scores" | "final";

interface RoundState {
  index: number;
  matchups: Matchup[];
  /** Which matchup is being voted on or revealed. */
  current: number;
  votes: Map<number, 0 | 1>;
  lastResult: { points: [number, number]; quiplash: -1 | 0 | 1; jinx: boolean } | null;
}

export function Quiplash({ send, subscribe, onExit, players, publish }: GameProps) {
  const count = players.length;
  const [phase, setPhase] = useState<Phase>(count < 3 ? "final" : "intro");
  const [points, setPoints] = useState<number[]>(() => players.map(() => 0));
  const [clock, setClock] = useState(WRITING_SECONDS);
  const [round, setRound] = useState<RoundState>(() => ({
    index: 0,
    matchups: count >= 3 ? assignPrompts(count, pickSome(QUIP_PROMPTS, count)) : [],
    current: 0,
    votes: new Map(),
    lastResult: null,
  }));
  /** Last Lash: everyone answers one prompt, then picks their favourites. */
  const [lastLash, setLastLash] = useState<{ prompt: string; answers: string[] }>(() => ({
    prompt: pickSome(LAST_LASH_PROMPTS, 1)[0],
    answers: players.map(() => ""),
  }));

  const playersRef = useRef(players);
  playersRef.current = players;
  const sendRef = useRef(send);
  sendRef.current = send;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const roundRef = useRef(round);
  roundRef.current = round;
  const lastLashRef = useRef(lastLash);
  lastLashRef.current = lastLash;

  const isLastLash = round.index === 2;
  const matchup = round.matchups[round.current];

  // ---------------------------------------------------------------------
  // Phone views
  // ---------------------------------------------------------------------
  useEffect(() => {
    const roster = playersRef.current;
    roster.forEach((info, index) => {
      let view: PhoneView;

      if (phase === "intro") {
        view = { title: "Quiplash", note: "Answers appear on your phone in a moment.", waiting: true };
      } else if (phase === "writing" && !isLastLash) {
        const mine = promptsFor(round.matchups, index);
        const pending = mine.find((p) => {
          const m = round.matchups[p];
          return m.answers[m.players.indexOf(index) as 0 | 1] === "";
        });
        view =
          pending === undefined
            ? { title: "Both sent", note: "Waiting for everyone else…", waiting: true }
            : {
                title: round.matchups[pending].prompt,
                subtitle: `Prompt ${mine.indexOf(pending) + 1} of ${mine.length} · ${clock}s left`,
                input: { placeholder: "Type something funny…", maxLength: MAX_ANSWER, submitLabel: "Send it" },
              };
      } else if (phase === "writing") {
        view = lastLash.answers[index]
          ? { title: "Sent", note: "Waiting for everyone else…", waiting: true }
          : {
              title: lastLash.prompt,
              subtitle: `The Last Lash · ${clock}s left`,
              input: { placeholder: "Type something funny…", maxLength: MAX_ANSWER, submitLabel: "Send it" },
            };
      } else if (phase === "voting" && !isLastLash && matchup) {
        const isAuthor = matchup.players.includes(index);
        view = isAuthor
          ? { title: "That's yours", note: "You can't vote on your own prompt.", waiting: true }
          : round.votes.has(index)
            ? { title: "Vote counted", note: "Waiting for everyone else…", waiting: true }
            : {
                title: "Which is funnier?",
                subtitle: matchup.prompt,
                choices: [
                  { id: "vote:0", label: matchup.answers[0] || "(no answer)" },
                  { id: "vote:1", label: matchup.answers[1] || "(no answer)" },
                ],
              };
      } else if (phase === "voting" && isLastLash) {
        view = round.votes.has(index)
          ? { title: "Vote counted", note: "Waiting for everyone else…", waiting: true }
          : {
          title: "Pick your favourite",
          subtitle: lastLash.prompt,
          choices: lastLash.answers
            .map((answer, i) => ({ id: `vote:${i}`, label: answer || "(no answer)", i }))
            .filter((c) => c.i !== index)
            .map(({ id, label }) => ({ id, label })),
        };
      } else if (phase === "final") {
        view = {
          title: count < 3 ? "Needs three players" : "Game over",
          note: count < 3 ? "Quiplash needs at least three people." : `You finished with ${points[index]} points.`,
          actions: [{ id: "exit", label: "Back to the Wii Menu", style: "primary" }],
        };
      } else {
        view = { title: "Watch the screen", waiting: true };
      }

      sendRef.current({ type: "phone-view", view, to: info.player });
    });
  }, [phase, round, lastLash, clock, points, isLastLash, matchup, count]);

  useEffect(() => {
    return () => {
      for (const info of playersRef.current) {
        sendRef.current({ type: "phone-view", view: null, to: info.player });
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Answers and votes
  // ---------------------------------------------------------------------
  const handleAction = useCallback(
    (playerNumber: number, id: string, value?: string | number) => {
      const index = playersRef.current.findIndex((p) => p.player === playerNumber);
      if (index < 0) return;

      if (id === "exit") {
        if (phaseRef.current === "final") onExitRef.current();
        return;
      }

      if (id === "submit" && phaseRef.current === "writing") {
        const text = String(value ?? "").slice(0, MAX_ANSWER).trim();
        if (!text) return;
        if (roundRef.current.index === 2) {
          setLastLash((current) => {
            if (current.answers[index]) return current;
            const answers = [...current.answers];
            answers[index] = text;
            return { ...current, answers };
          });
        } else {
          setRound((current) => {
            const matchups = current.matchups.map((m) => ({ ...m, answers: [...m.answers] as [string, string] }));
            const mine = promptsFor(matchups, index);
            const target = mine.find((p) => matchups[p].answers[matchups[p].players.indexOf(index) as 0 | 1] === "");
            if (target === undefined) return current;
            const slot = matchups[target].players.indexOf(index) as 0 | 1;
            matchups[target].answers[slot] = text;
            return { ...current, matchups };
          });
        }
        return;
      }

      if (id.startsWith("vote:") && phaseRef.current === "voting") {
        const choice = Number(id.slice(5));
        setRound((current) => {
          const active = current.matchups[current.current];
          // Authors never vote on their own prompt.
          if (!isLastLashRound(current) && active && active.players.includes(index)) return current;
          if (isLastLashRound(current) && choice === index) return current;
          if (current.votes.has(index)) return current;
          const votes = new Map(current.votes);
          votes.set(index, choice as 0 | 1);
          return { ...current, votes };
        });
      }
    },
    [],
  );

  const isLastLashRound = (state: RoundState) => state.index === 2;

  useEffect(() => {
    return subscribe((msg, player) => {
      if (msg.type === "action") handleAction(player, msg.id, msg.value);
    });
  }, [subscribe, handleAction]);

  // ---------------------------------------------------------------------
  // Phase clock
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (phase === "intro") {
      const timer = window.setTimeout(() => {
        setClock(WRITING_SECONDS);
        setPhase("writing");
      }, 3500);
      return () => window.clearTimeout(timer);
    }
    if (phase !== "writing" && phase !== "voting") return;

    const timer = window.setInterval(() => {
      setClock((value) => {
        if (value > 1) return value - 1;
        window.clearInterval(timer);
        setPhase((current) => (current === "writing" ? "voting" : "reveal"));
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, round.current]);

  // Everyone answered, or everyone voted: move on without waiting out the clock.
  useEffect(() => {
    if (phase === "writing") {
      const done = isLastLash
        ? lastLash.answers.every((a) => a !== "")
        : round.matchups.every((m) => m.answers[0] !== "" && m.answers[1] !== "");
      if (done) {
        setClock(VOTE_SECONDS);
        setPhase("voting");
      }
      return;
    }
    if (phase === "voting") {
      const expected = isLastLash ? count - 1 : eligibleVoters(count, round.matchups[round.current]).length;
      if (round.votes.size >= expected) setPhase("reveal");
    }
  }, [phase, round, lastLash, isLastLash, count]);

  // Score the matchup being revealed, then move to the next one.
  useEffect(() => {
    if (phase !== "reveal") return;

    if (isLastLash) {
      const counts = new Array(count).fill(0);
      for (const choice of round.votes.values()) counts[choice] = (counts[choice] ?? 0) + 1;
      setPoints((current) => current.map((p, i) => p + counts[i] * 100 * MULTIPLIERS[2]));
      const timer = window.setTimeout(() => setPhase("final"), REVEAL_MS);
      return () => window.clearTimeout(timer);
    }

    const active = round.matchups[round.current];
    const result = scoreMatchup(active, round.votes, MULTIPLIERS[round.index], eligibleVoters(count, active).length);
    setPoints((current) => {
      const next = [...current];
      next[active.players[0]] += result.points[0];
      next[active.players[1]] += result.points[1];
      return next;
    });
    setRound((current) => ({ ...current, lastResult: result }));

    const timer = window.setTimeout(() => {
      setRound((current) => {
        const nextIndex = current.current + 1;
        if (nextIndex < current.matchups.length) {
          setClock(VOTE_SECONDS);
          setPhase("voting");
          return { ...current, current: nextIndex, votes: new Map(), lastResult: null };
        }
        setPhase("scores");
        return current;
      });
    }, REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase, round.current, isLastLash, count]);

  // Between rounds: deal the next set of prompts, or go to the Last Lash.
  useEffect(() => {
    if (phase !== "scores") return;
    const timer = window.setTimeout(() => {
      const nextIndex = round.index + 1;
      if (nextIndex > 2) {
        setPhase("final");
        return;
      }
      setRound({
        index: nextIndex,
        matchups: nextIndex === 2 ? [] : assignPrompts(count, pickSome(QUIP_PROMPTS, count)),
        current: 0,
        votes: new Map(),
        lastResult: null,
      });
      if (nextIndex === 2) setLastLash({ prompt: pickSome(LAST_LASH_PROMPTS, 1)[0], answers: players.map(() => "") });
      setClock(WRITING_SECONDS);
      setPhase("writing");
    }, REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase, round.index, count, players]);

  useEffect(() => {
    publish({ phase, points, players, clock, round: round.index, matchup: matchup ?? null, lastLash });
  }, [phase, points, players, clock, round.index, matchup, lastLash, publish]);

  const table = useMemo(() => standings(points), [points]);
  const answeredCount = isLastLash
    ? lastLash.answers.filter(Boolean).length
    : round.matchups.reduce((total, m) => total + (m.answers[0] ? 1 : 0) + (m.answers[1] ? 1 : 0), 0);
  const answersExpected = isLastLash ? count : count * 2;

  return (
    <div className="party-root">
      <header className="party-header">
        <span className="party-title">Quiplash</span>
        <span className="party-round">
          {phase === "final" ? "Final scores" : isLastLash ? "The Last Lash" : `Round ${round.index + 1}`}
        </span>
      </header>

      {phase === "intro" && (
        <div className="party-centre">
          <h2 className="party-big">Get your phones ready</h2>
          <p className="party-sub">Two prompts each. {WRITING_SECONDS} seconds for both.</p>
        </div>
      )}

      {phase === "writing" && (
        <div className="party-centre">
          <div className="party-clock">{clock}</div>
          <p className="party-sub">
            {answeredCount} of {answersExpected} answers in
          </p>
          {isLastLash && <p className="party-prompt">{lastLash.prompt}</p>}
        </div>
      )}

      {phase === "voting" && !isLastLash && matchup && (
        <div className="party-centre">
          <p className="party-prompt">{matchup.prompt}</p>
          <div className="party-duel">
            <div className="party-answer">{matchup.answers[0] || "(no answer)"}</div>
            <span className="party-vs">vs</span>
            <div className="party-answer">{matchup.answers[1] || "(no answer)"}</div>
          </div>
          <p className="party-sub">
            {round.votes.size} of {eligibleVoters(count, matchup).length} votes · {clock}s
          </p>
        </div>
      )}

      {phase === "voting" && isLastLash && (
        <div className="party-centre">
          <p className="party-prompt">{lastLash.prompt}</p>
          <div className="party-list">
            {lastLash.answers.map((answer, i) => (
              <div key={i} className="party-answer">
                {answer || "(no answer)"}
              </div>
            ))}
          </div>
          <p className="party-sub">
            {round.votes.size} of {count} votes · {clock}s
          </p>
        </div>
      )}

      {phase === "reveal" && matchup && !isLastLash && (
        <div className="party-centre">
          <p className="party-prompt">{matchup.prompt}</p>
          <div className="party-duel">
            {[0, 1].map((side) => (
              <div
                key={side}
                className={`party-answer${round.lastResult && round.lastResult.quiplash === side ? " is-sweep" : ""}`}
              >
                {matchup.answers[side] || "(no answer)"}
                <span className="party-points">+{round.lastResult?.points[side] ?? 0}</span>
              </div>
            ))}
          </div>
          {round.lastResult?.jinx && <p className="party-sub">Jinx! Identical answers, no points.</p>}
          {round.lastResult && round.lastResult.quiplash >= 0 && <p className="party-sub">Quiplash! A clean sweep.</p>}
        </div>
      )}

      {(phase === "scores" || phase === "final") && (
        <div className="party-centre">
          <ol className="party-standings">
            {table.map(({ player, points: score }, rank) => (
              <li key={player} className={rank === 0 ? "is-leader" : ""}>
                <span className="party-rank">{rank + 1}</span>
                {players[player] && <MiiAvatar mii={players[player].mii} size={34} />}
                <span className="party-who">
                  P{players[player]?.player} · {players[player]?.mii.name}
                </span>
                <span className="party-score">{score}</span>
              </li>
            ))}
          </ol>
          {phase === "final" && <p className="party-sub">Tap Back on any phone to return to the Wii Menu</p>}
        </div>
      )}

      <div className="party-hint">Answer and vote on your phone · tap Home on a phone to exit</div>
    </div>
  );
}
