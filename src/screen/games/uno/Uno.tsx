import { useCallback, useEffect, useRef, useState } from "react";
import "./uno.css";
import type { PhoneView } from "../../../../shared/protocol";
import { MiiAvatar } from "../../mii/MiiAvatar";
import type { GameProps } from "../types";
import {
  COLOR_HEX,
  HAND_SIZE,
  UNO_COLORS,
  buildDeck,
  cardLabel,
  drawCards,
  handPoints,
  nextIndex,
  playableCards,
  shuffle,
  type UnoCard,
  type UnoColor,
} from "./rules";

/** How long you get to shout "Uno!" after playing down to one card. The real
 * rule is that somebody has to catch you; a timer is the fair equivalent
 * when the table is a TV. */
const UNO_WINDOW_MS = 3000;

interface UnoState {
  draw: UnoCard[];
  /** Last entry is the face-up top card. */
  discard: UnoCard[];
  hands: UnoCard[][];
  turnIndex: number;
  direction: 1 | -1;
  activeColor: UnoColor;
  /** A wild has been played and is waiting on a colour. */
  awaitingColor: boolean;
  /** Set while a player still owes an "Uno!" call. */
  unoPending: number | null;
  winner: number | null;
  log: string[];
}

function freshState(playerCount: number): UnoState {
  let deck = shuffle(buildDeck());
  const hands: UnoCard[][] = [];
  for (let i = 0; i < playerCount; i++) {
    hands.push(deck.slice(0, HAND_SIZE));
    deck = deck.slice(HAND_SIZE);
  }
  // Turn cards until a plain number shows. The published rule sends an
  // action card back and re-flips; starting on a number avoids having to
  // resolve a Skip or Draw Two before anyone has had a turn.
  let firstIndex = deck.findIndex((card) => card.kind === "number");
  if (firstIndex < 0) firstIndex = 0;
  const first = deck[firstIndex];
  deck = deck.filter((_, i) => i !== firstIndex);

  return {
    draw: deck,
    discard: [first],
    hands,
    turnIndex: 0,
    direction: 1,
    activeColor: first.color ?? "red",
    awaitingColor: false,
    unoPending: null,
    winner: null,
    log: [`Starting card: ${cardLabel(first)}`],
  };
}

export function Uno({ send, subscribe, onExit, players, publish }: GameProps) {
  const [state, setState] = useState<UnoState>(() => freshState(players.length));
  const stateRef = useRef(state);
  stateRef.current = state;
  const playersRef = useRef(players);
  playersRef.current = players;
  const sendRef = useRef(send);
  sendRef.current = send;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const top = state.discard[state.discard.length - 1];

  // ---------------------------------------------------------------------
  // Phone views: each player sees only their own hand.
  // ---------------------------------------------------------------------
  const pushPhoneViews = useCallback((next: UnoState) => {
    const roster = playersRef.current;
    const topCard = next.discard[next.discard.length - 1];

    roster.forEach((info, index) => {
      const hand = next.hands[index] ?? [];
      const yourTurn = index === next.turnIndex && next.winner === null;
      let view: PhoneView;

      if (next.winner !== null) {
        view = {
          title: next.winner === index ? "You went out!" : `Player ${roster[next.winner].player} went out`,
          note: `You were left with ${handPoints(hand)} points of cards.`,
          waiting: true,
        };
      } else if (yourTurn && next.awaitingColor) {
        view = {
          title: "Pick a colour",
          choices: UNO_COLORS.map((color) => ({ id: `color:${color}`, label: color.toUpperCase() })),
        };
      } else if (yourTurn) {
        const playable = new Set(playableCards(hand, topCard, next.activeColor).map((c) => c.id));
        view = {
          title: "Your turn",
          subtitle: `On ${next.activeColor.toUpperCase()} · ${cardLabel(topCard)}`,
          cards: hand.map((card) => ({
            id: `play:${card.id}`,
            label: cardLabel(card),
            color: card.color ? COLOR_HEX[card.color] : "#2b2b33",
            playable: playable.has(card.id),
          })),
          actions: [{ id: "draw", label: playable.size ? "Draw instead" : "Draw a card", style: "primary" }],
        };
      } else {
        view = {
          title: `Player ${roster[next.turnIndex].player}'s turn`,
          subtitle: `On ${next.activeColor.toUpperCase()} · ${cardLabel(topCard)}`,
          cards: hand.map((card) => ({
            id: `play:${card.id}`,
            label: cardLabel(card),
            color: card.color ? COLOR_HEX[card.color] : "#2b2b33",
            playable: false,
          })),
          waiting: true,
        };
      }

      // Owing an "Uno!" overrides everything: shout or get caught.
      if (next.unoPending === index) {
        view = {
          title: "Say it!",
          note: "Tap before the others notice, or draw two.",
          actions: [{ id: "uno", label: "UNO!", style: "danger" }],
        };
      }

      sendRef.current({ type: "phone-view", view, to: info.player });
    });
  }, []);

  useEffect(() => {
    pushPhoneViews(state);
  }, [state, pushPhoneViews]);

  // Hand the phones back to the ordinary remote on the way out.
  useEffect(() => {
    return () => {
      for (const info of playersRef.current) {
        sendRef.current({ type: "phone-view", view: null, to: info.player });
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------
  const advance = useCallback((next: UnoState, skip: boolean) => {
    next.turnIndex = nextIndex(next.turnIndex, next.hands.length, next.direction, skip);
  }, []);

  const applyCard = useCallback(
    (next: UnoState, card: UnoCard, playerIndex: number) => {
      const roster = playersRef.current;
      const who = `Player ${roster[playerIndex].player}`;
      next.discard.push(card);
      next.log.unshift(`${who} played ${cardLabel(card)}`);

      if (card.kind === "wild" || card.kind === "wild4") {
        // Colour comes from the player next; the turn does not move yet.
        next.awaitingColor = true;
        return;
      }

      next.activeColor = card.color ?? next.activeColor;

      if (card.kind === "reverse") {
        next.direction = next.direction === 1 ? -1 : 1;
        // With two players a reverse acts as a skip, or it would hand the
        // turn straight back to the player who played it.
        advance(next, next.hands.length === 2);
        return;
      }
      if (card.kind === "skip") {
        advance(next, true);
        return;
      }
      if (card.kind === "draw2") {
        const victim = nextIndex(next.turnIndex, next.hands.length, next.direction);
        const result = drawCards(next.draw, next.discard, 2);
        next.draw = result.draw;
        next.discard = result.discard;
        next.hands[victim] = [...next.hands[victim], ...result.drawn];
        next.log.unshift(`Player ${roster[victim].player} draws 2 and misses a turn`);
        advance(next, true);
        return;
      }
      advance(next, false);
    },
    [advance],
  );

  const finishWild = useCallback(
    (next: UnoState, color: UnoColor) => {
      const roster = playersRef.current;
      const played = next.discard[next.discard.length - 1];
      next.activeColor = color;
      next.awaitingColor = false;
      // The wild keeps the chosen colour so the table shows it correctly.
      next.discard[next.discard.length - 1] = { ...played, color };
      next.log.unshift(`Colour is now ${color.toUpperCase()}`);

      if (played.kind === "wild4") {
        const victim = nextIndex(next.turnIndex, next.hands.length, next.direction);
        const result = drawCards(next.draw, next.discard, 4);
        next.draw = result.draw;
        next.discard = result.discard;
        next.hands[victim] = [...next.hands[victim], ...result.drawn];
        next.log.unshift(`Player ${roster[victim].player} draws 4 and misses a turn`);
        advance(next, true);
      } else {
        advance(next, false);
      }
    },
    [advance],
  );

  const handleAction = useCallback(
    (playerNumber: number, id: string) => {
      const roster = playersRef.current;
      const playerIndex = roster.findIndex((info) => info.player === playerNumber);
      if (playerIndex < 0) return;

      setState((current) => {
        if (current.winner !== null) return current;
        const next: UnoState = {
          ...current,
          hands: current.hands.map((hand) => [...hand]),
          discard: [...current.discard],
          draw: [...current.draw],
          log: [...current.log],
        };

        // Calling Uno is the one action available out of turn.
        if (id === "uno") {
          if (next.unoPending !== playerIndex) return current;
          next.unoPending = null;
          next.log.unshift(`Player ${playerNumber} called Uno!`);
          return next;
        }

        if (playerIndex !== next.turnIndex) return current;

        if (id.startsWith("color:") && next.awaitingColor) {
          finishWild(next, id.slice(6) as UnoColor);
        } else if (id === "draw" && !next.awaitingColor) {
          const result = drawCards(next.draw, next.discard, 1);
          next.draw = result.draw;
          next.discard = result.discard;
          next.hands[playerIndex] = [...next.hands[playerIndex], ...result.drawn];
          next.log.unshift(`Player ${playerNumber} drew a card`);
          advance(next, false);
        } else if (id.startsWith("play:") && !next.awaitingColor) {
          const cardId = id.slice(5);
          const hand = next.hands[playerIndex];
          const card = hand.find((c) => c.id === cardId);
          if (!card) return current;
          const topCard = next.discard[next.discard.length - 1];
          if (!playableCards(hand, topCard, next.activeColor).some((c) => c.id === cardId)) return current;

          next.hands[playerIndex] = hand.filter((c) => c.id !== cardId);
          applyCard(next, card, playerIndex);

          if (next.hands[playerIndex].length === 0) {
            next.winner = playerIndex;
            next.unoPending = null;
            next.log.unshift(`Player ${playerNumber} went out!`);
          } else if (next.hands[playerIndex].length === 1) {
            next.unoPending = playerIndex;
          }
        } else {
          return current;
        }

        return next;
      });
    },
    [advance, applyCard, finishWild],
  );

  useEffect(() => {
    return subscribe((msg, player) => {
      if (msg.type === "action") handleAction(player, msg.id);
    });
  }, [subscribe, handleAction]);

  // Missed the call: two cards, same as being caught at a real table.
  useEffect(() => {
    if (state.unoPending === null) return;
    const caught = state.unoPending;
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.unoPending !== caught) return current;
        const next = { ...current, hands: current.hands.map((h) => [...h]), log: [...current.log] };
        const result = drawCards(next.draw, next.discard, 2);
        next.draw = result.draw;
        next.discard = result.discard;
        next.hands[caught] = [...next.hands[caught], ...result.drawn];
        next.unoPending = null;
        next.log.unshift(`Player ${playersRef.current[caught].player} forgot to call Uno — draw 2`);
        return next;
      });
    }, UNO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [state.unoPending]);

  // HOME exits centrally; A on the results screen returns to the menu.
  useEffect(() => {
    if (state.winner === null) return;
    return subscribe((msg) => {
      if (msg.type === "button" && msg.button === "A" && msg.state === "down") onExitRef.current();
    });
  }, [state.winner, subscribe]);

  // Mirror the table (never anyone's hand) to spectator screens.
  useEffect(() => {
    publish({
      players,
      counts: state.hands.map((hand) => hand.length),
      top,
      activeColor: state.activeColor,
      direction: state.direction,
      turnIndex: state.turnIndex,
      winner: state.winner,
      log: state.log.slice(0, 6),
      drawCount: state.draw.length,
    });
  }, [state, players, top, publish]);

  const winnerInfo = state.winner === null ? null : players[state.winner];

  return (
    <div className="uno-root">
      <div className="uno-table">
        <div className="uno-pile">
          <div className="uno-card is-top" style={{ background: top.color ? COLOR_HEX[top.color] : "#2b2b33" }}>
            {cardLabel(top)}
          </div>
          <div className="uno-colour" style={{ background: COLOR_HEX[state.activeColor] }}>
            {state.activeColor}
          </div>
          <div className="uno-meta">
            {state.direction === 1 ? "▶ clockwise" : "◀ anticlockwise"} · {state.draw.length} left to draw
          </div>
        </div>

        <div className="uno-players">
          {players.map((info, index) => (
            <div
              key={info.player}
              className={`uno-player${index === state.turnIndex && state.winner === null ? " is-up" : ""}`}
            >
              <MiiAvatar mii={info.mii} size={42} />
              <span className="uno-player-name">
                P{info.player} · {info.mii.name}
              </span>
              <span className="uno-player-count">
                {state.hands[index]?.length ?? 0}
                {state.hands[index]?.length === 1 ? " · UNO" : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      <ul className="uno-log">
        {state.log.slice(0, 5).map((line, i) => (
          <li key={`${line}-${i}`}>{line}</li>
        ))}
      </ul>

      {winnerInfo && (
        <div className="uno-overlay">
          <div className="uno-final">
            <h2>Player {winnerInfo.player} wins!</h2>
            <p>{winnerInfo.mii.name} went out first.</p>
            <ol className="uno-scores">
              {players
                .map((info, i) => ({ info, points: handPoints(state.hands[i]) }))
                .sort((a, b) => a.points - b.points)
                .map(({ info, points }) => (
                  <li key={info.player}>
                    <span>
                      P{info.player} · {info.mii.name}
                    </span>
                    <span>{points} pts left</span>
                  </li>
                ))}
            </ol>
            <p className="uno-hint">Press A to return to the Wii Menu</p>
          </div>
        </div>
      )}

      <div className="uno-hint-bar">Play from your phone · HOME to exit</div>
    </div>
  );
}
