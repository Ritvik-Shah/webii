import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./party.css";
import type { PhoneView } from "../../../../shared/protocol";
import { MiiAvatar } from "../../mii/MiiAvatar";
import type { GameProps } from "../types";
import { standings } from "./core";
import { FAKIN_TASKS, pickSome } from "./content";

// Everyone in the room is told what to do, except one person who is only
// told there is a task. Do it, look around, then vote on who was bluffing.
// The screen never shows the task, so the faker cannot read it off the TV.

const DOING_SECONDS = 25;
const VOTE_SECONDS = 30;
const REVEAL_MS = 7000;
const ROUNDS = 4;
/** Points for catching the faker, and for the faker getting away with it. */
const CAUGHT_POINTS = 500;
const ESCAPE_POINTS = 1000;

type Phase = "intro" | "doing" | "voting" | "reveal" | "final";

export function FakinIt({ send, subscribe, onExit, players, publish }: GameProps) {
  const count = players.length;
  const [phase, setPhase] = useState<Phase>(count < 3 ? "final" : "intro");
  const [points, setPoints] = useState<number[]>(() => players.map(() => 0));
  const [roundIndex, setRoundIndex] = useState(0);
  const [tasks] = useState<string[]>(() => pickSome(FAKIN_TASKS, ROUNDS));
  const [faker, setFaker] = useState(() => Math.floor(Math.random() * Math.max(1, count)));
  const [votes, setVotes] = useState<Map<number, number>>(new Map());
  const [clock, setClock] = useState(DOING_SECONDS);

  const task = tasks[Math.min(roundIndex, tasks.length - 1)];
  const playersRef = useRef(players);
  playersRef.current = players;
  const sendRef = useRef(send);
  sendRef.current = send;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // ---------------------------------------------------------------------
  // Phone views -- this is the whole game: the task goes to every phone but
  // one, and only that phone knows it is the odd one out.
  // ---------------------------------------------------------------------
  useEffect(() => {
    playersRef.current.forEach((info, index) => {
      let view: PhoneView;

      if (phase === "intro") {
        view = { title: "Fakin' It", note: "Everyone gets an instruction. Almost everyone.", waiting: true };
      } else if (phase === "doing") {
        view =
          index === faker
            ? {
                title: "You're the faker",
                note: "Everyone else was told what to do. Work it out and blend in.",
                subtitle: `${clock}s`,
              }
            : { title: task, subtitle: `Do it now · ${clock}s`, note: "One person wasn't told. Watch closely." };
      } else if (phase === "voting") {
        view = {
          title: "Who was faking?",
          choices: playersRef.current
            .map((p, i) => ({ p, i }))
            .filter(({ i }) => i !== index)
            .map(({ p, i }) => ({ id: `vote:${i}`, label: `Player ${p.player} · ${p.mii.name}` })),
          waiting: votes.has(index),
        };
      } else if (phase === "final") {
        view = {
          title: count < 3 ? "Needs three players" : "Game over",
          note: count < 3 ? "Fakin' It needs at least three people." : `You finished with ${points[index]} points.`,
          actions: [{ id: "exit", label: "Back to the Wii Menu", style: "primary" }],
        };
      } else {
        view = { title: "Watch the screen", waiting: true };
      }

      sendRef.current({ type: "phone-view", view, to: info.player });
    });
  }, [phase, task, faker, clock, votes, points, count]);

  useEffect(() => {
    return () => {
      for (const info of playersRef.current) {
        sendRef.current({ type: "phone-view", view: null, to: info.player });
      }
    };
  }, []);

  const handleAction = useCallback((playerNumber: number, id: string) => {
    const index = playersRef.current.findIndex((p) => p.player === playerNumber);
    if (index < 0) return;

    if (id === "exit") {
      if (phaseRef.current === "final") onExitRef.current();
      return;
    }
    if (id.startsWith("vote:") && phaseRef.current === "voting") {
      const choice = Number(id.slice(5));
      setVotes((current) => {
        if (current.has(index) || choice === index) return current;
        const next = new Map(current);
        next.set(index, choice);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    return subscribe((msg, player) => {
      if (msg.type === "action") handleAction(player, msg.id);
    });
  }, [subscribe, handleAction]);

  useEffect(() => {
    if (phase === "intro") {
      const timer = window.setTimeout(() => {
        setClock(DOING_SECONDS);
        setPhase("doing");
      }, 3500);
      return () => window.clearTimeout(timer);
    }
    if (phase !== "doing" && phase !== "voting") return;
    const timer = window.setInterval(() => {
      setClock((value) => {
        if (value > 1) return value - 1;
        window.clearInterval(timer);
        setPhase((current) => {
          if (current === "doing") {
            setClock(VOTE_SECONDS);
            return "voting";
          }
          return "reveal";
        });
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, roundIndex]);

  useEffect(() => {
    if (phase === "voting" && votes.size >= count) setPhase("reveal");
  }, [phase, votes, count]);

  // Score: catching the faker pays, and surviving pays the faker more.
  useEffect(() => {
    if (phase !== "reveal") return;
    const gained = new Array(count).fill(0);
    let caught = 0;
    for (const [voter, choice] of votes) {
      if (choice === faker) {
        gained[voter] += CAUGHT_POINTS;
        caught += 1;
      }
    }
    // Escaping means fewer than half the voters pointed at them.
    if (caught * 2 < votes.size) gained[faker] += ESCAPE_POINTS;
    setPoints((current) => current.map((p, i) => p + gained[i]));

    const timer = window.setTimeout(() => {
      const next = roundIndex + 1;
      if (next >= ROUNDS) {
        setPhase("final");
        return;
      }
      setRoundIndex(next);
      setFaker(Math.floor(Math.random() * count));
      setVotes(new Map());
      setClock(DOING_SECONDS);
      setPhase("doing");
    }, REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    // The task is deliberately left out of the spectator snapshot: a watch
    // screen in the same room would hand the faker the answer.
    publish({ phase, points, players, clock, roundIndex, votes: [...votes.entries()], faker: phase === "reveal" || phase === "final" ? faker : -1 });
  }, [phase, points, players, clock, roundIndex, votes, faker, publish]);

  const table = useMemo(() => standings(points), [points]);
  const accusations = useMemo(() => {
    const counts = new Array(count).fill(0);
    for (const choice of votes.values()) counts[choice] = (counts[choice] ?? 0) + 1;
    return counts;
  }, [votes, count]);
  const caught = (accusations[faker] ?? 0) * 2 >= votes.size && votes.size > 0;

  return (
    <div className="party-root">
      <header className="party-header">
        <span className="party-title">Fakin' It</span>
        <span className="party-round">
          {phase === "final" ? "Final scores" : `Round ${Math.min(roundIndex + 1, ROUNDS)} of ${ROUNDS}`}
        </span>
      </header>

      {phase === "intro" && (
        <div className="party-centre">
          <h2 className="party-big">Check your phone</h2>
          <p className="party-sub">Everyone is told what to do. One of you isn't.</p>
        </div>
      )}

      {phase === "doing" && (
        <div className="party-centre">
          <h2 className="party-big">Do what your phone says</h2>
          <div className="party-clock">{clock}</div>
          <p className="party-sub">Watch everyone else while you do it.</p>
        </div>
      )}

      {phase === "voting" && (
        <div className="party-centre">
          <h2 className="party-big">Who was faking?</h2>
          <p className="party-sub">
            {votes.size} of {count} votes · {clock}s
          </p>
        </div>
      )}

      {phase === "reveal" && (
        <div className="party-centre">
          <p className="party-prompt">The instruction was: {task}</p>
          <h2 className="party-big">
            {players[faker]?.mii.name} was faking — {caught ? "caught!" : "and got away with it"}
          </h2>
          <div className="party-list">
            {players.map((info, i) => (
              <div key={info.player} className={`party-answer${i === faker ? " is-sweep" : ""}`}>
                P{info.player} · {info.mii.name}
                <span className="party-points">{accusations[i] ?? 0} votes</span>
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

      <div className="party-hint">Your instruction is on your phone · tap Home on a phone to exit</div>
    </div>
  );
}
