import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./party.css";
import type { PhoneView } from "../../../../shared/protocol";
import { MiiAvatar } from "../../mii/MiiAvatar";
import type { GameProps } from "../types";
import { shuffle, standings } from "./core";
import { TRIVIA, pickSome, type TriviaQuestion } from "./content";

// Write a convincing lie, then pick the truth out of everyone else's lies.
// Points for finding the truth, and points for every person your lie fools.

const LYING_SECONDS = 60;
const VOTE_SECONDS = 25;
const REVEAL_MS = 6000;
const ROUNDS = 3;
const TRUTH_POINTS = 1000;
const FOOLED_POINTS = 500;
const MAX_ANSWER = 60;

type Phase = "intro" | "lying" | "voting" | "reveal" | "final";

/** One option on the voting screen: either somebody's lie or the real answer. */
interface Option {
  text: string;
  /** Player index who wrote it, or -1 for the truth. */
  author: number;
}

export function Fibbage({ send, subscribe, onExit, players, publish }: GameProps) {
  const count = players.length;
  const [phase, setPhase] = useState<Phase>(count < 3 ? "final" : "intro");
  const [points, setPoints] = useState<number[]>(() => players.map(() => 0));
  const [roundIndex, setRoundIndex] = useState(0);
  const [questions] = useState<TriviaQuestion[]>(() => pickSome(TRIVIA, ROUNDS));
  const [lies, setLies] = useState<string[]>(() => players.map(() => ""));
  const [options, setOptions] = useState<Option[]>([]);
  const [votes, setVotes] = useState<Map<number, number>>(new Map());
  const [clock, setClock] = useState(LYING_SECONDS);

  const question = questions[Math.min(roundIndex, questions.length - 1)];
  const playersRef = useRef(players);
  playersRef.current = players;
  const sendRef = useRef(send);
  sendRef.current = send;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const normalise = (text: string) => text.trim().toLowerCase();

  // ---------------------------------------------------------------------
  // Phone views
  // ---------------------------------------------------------------------
  useEffect(() => {
    playersRef.current.forEach((info, index) => {
      let view: PhoneView;

      if (phase === "intro") {
        view = { title: "Fibbage", note: "Write a lie good enough to fool everyone.", waiting: true };
      } else if (phase === "lying") {
        view = lies[index]
          ? { title: "Lie sent", note: "Waiting for everyone else…", waiting: true }
          : {
              title: question.question,
              subtitle: `Invent a convincing answer · ${clock}s left`,
              input: { placeholder: "Your lie…", maxLength: MAX_ANSWER, submitLabel: "Send it" },
            };
      } else if (phase === "voting") {
        // You never see your own lie as an option to pick.
        view = {
          title: "Which one is true?",
          subtitle: question.question,
          choices: options
            .map((option, i) => ({ option, i }))
            .filter(({ option }) => option.author !== index)
            .map(({ option, i }) => ({ id: `vote:${i}`, label: option.text })),
          waiting: votes.has(index),
        };
      } else if (phase === "final") {
        view = {
          title: count < 3 ? "Needs three players" : "Game over",
          note: count < 3 ? "Fibbage needs at least three people." : `You finished with ${points[index]} points.`,
          actions: [{ id: "exit", label: "Back to the Wii Menu", style: "primary" }],
        };
      } else {
        view = { title: "Watch the screen", waiting: true };
      }

      sendRef.current({ type: "phone-view", view, to: info.player });
    });
  }, [phase, lies, options, votes, clock, points, question, count]);

  useEffect(() => {
    return () => {
      for (const info of playersRef.current) {
        sendRef.current({ type: "phone-view", view: null, to: info.player });
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Lies and votes
  // ---------------------------------------------------------------------
  const handleAction = useCallback(
    (playerNumber: number, id: string, value?: string | number) => {
      const index = playersRef.current.findIndex((p) => p.player === playerNumber);
      if (index < 0) return;

      if (id === "exit") {
        if (phaseRef.current === "final") onExitRef.current();
        return;
      }

      if (id === "submit" && phaseRef.current === "lying") {
        const text = String(value ?? "").slice(0, MAX_ANSWER).trim();
        if (!text) return;
        setLies((current) => {
          if (current[index]) return current;
          // A lie that happens to be the truth would give the game away, so
          // it is rejected and they get another go.
          if (normalise(text) === normalise(question.answer)) return current;
          const next = [...current];
          next[index] = text;
          return next;
        });
        return;
      }

      if (id.startsWith("vote:") && phaseRef.current === "voting") {
        const choice = Number(id.slice(5));
        setVotes((current) => {
          if (current.has(index)) return current;
          if (options[choice]?.author === index) return current; // never your own
          const next = new Map(current);
          next.set(index, choice);
          return next;
        });
      }
    },
    [options, question],
  );

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
        setClock(LYING_SECONDS);
        setPhase("lying");
      }, 3500);
      return () => window.clearTimeout(timer);
    }
    if (phase !== "lying" && phase !== "voting") return;
    const timer = window.setInterval(() => {
      setClock((value) => {
        if (value > 1) return value - 1;
        window.clearInterval(timer);
        setPhase((current) => (current === "lying" ? "voting" : "reveal"));
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, roundIndex]);

  // Everyone in early: move on.
  useEffect(() => {
    if (phase === "lying" && lies.every((lie) => lie !== "")) {
      setClock(VOTE_SECONDS);
      setPhase("voting");
    }
    if (phase === "voting" && votes.size >= count) setPhase("reveal");
  }, [phase, lies, votes, count]);

  // Build the ballot once the lies are in.
  useEffect(() => {
    if (phase !== "voting" || options.length > 0) return;
    const written: Option[] = lies
      .map((text, author) => ({ text, author }))
      .filter((o) => o.text !== "");
    setOptions(shuffle([...written, { text: question.answer, author: -1 }]));
  }, [phase, lies, options.length, question]);

  // Score, then next question or finish.
  useEffect(() => {
    if (phase !== "reveal") return;
    const gained = new Array(count).fill(0);
    for (const [voter, choice] of votes) {
      const option = options[choice];
      if (!option) continue;
      if (option.author === -1) gained[voter] += TRUTH_POINTS;
      else gained[option.author] += FOOLED_POINTS;
    }
    setPoints((current) => current.map((p, i) => p + gained[i]));

    const timer = window.setTimeout(() => {
      const next = roundIndex + 1;
      if (next >= ROUNDS) {
        setPhase("final");
        return;
      }
      setRoundIndex(next);
      setLies(playersRef.current.map(() => ""));
      setOptions([]);
      setVotes(new Map());
      setClock(LYING_SECONDS);
      setPhase("lying");
    }, REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    publish({ phase, points, players, clock, roundIndex, question, options, votes: [...votes.entries()] });
  }, [phase, points, players, clock, roundIndex, question, options, votes, publish]);

  const table = useMemo(() => standings(points), [points]);
  const voteCounts = useMemo(() => {
    const counts = new Array(options.length).fill(0);
    for (const choice of votes.values()) counts[choice] = (counts[choice] ?? 0) + 1;
    return counts;
  }, [options, votes]);

  return (
    <div className="party-root">
      <header className="party-header">
        <span className="party-title">Fibbage</span>
        <span className="party-round">
          {phase === "final" ? "Final scores" : `Question ${Math.min(roundIndex + 1, ROUNDS)} of ${ROUNDS}`}
        </span>
      </header>

      {phase === "intro" && (
        <div className="party-centre">
          <h2 className="party-big">Write a convincing lie</h2>
          <p className="party-sub">Fool the others, and spot the real answer.</p>
        </div>
      )}

      {phase === "lying" && (
        <div className="party-centre">
          <p className="party-prompt">{question.question}</p>
          <div className="party-clock">{clock}</div>
          <p className="party-sub">
            {lies.filter(Boolean).length} of {count} lies in
          </p>
        </div>
      )}

      {phase === "voting" && (
        <div className="party-centre">
          <p className="party-prompt">{question.question}</p>
          <div className="party-list">
            {options.map((option, i) => (
              <div key={i} className="party-answer">
                {option.text}
              </div>
            ))}
          </div>
          <p className="party-sub">
            {votes.size} of {count} votes · {clock}s
          </p>
        </div>
      )}

      {phase === "reveal" && (
        <div className="party-centre">
          <p className="party-prompt">{question.question}</p>
          <div className="party-list">
            {options.map((option, i) => (
              <div key={i} className={`party-answer${option.author === -1 ? " is-sweep" : ""}`}>
                {option.text}
                <span className="party-points">
                  {option.author === -1
                    ? `The truth · ${voteCounts[i] ?? 0} found it`
                    : `${players[option.author]?.mii.name ?? "?"} fooled ${voteCounts[i] ?? 0}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "final" && (
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
          <p className="party-sub">Tap Back on any phone to return to the Wii Menu</p>
        </div>
      )}

      <div className="party-hint">Write and vote on your phone · tap Home on a phone to exit</div>
    </div>
  );
}
