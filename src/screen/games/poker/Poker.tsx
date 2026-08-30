import { useCallback, useEffect, useRef, useState } from "react";
import "./poker.css";
import type { PhoneView } from "../../../../shared/protocol";
import { MiiAvatar } from "../../mii/MiiAvatar";
import type { GameProps } from "../types";
import {
  applyAction,
  legalActions,
  nextButton,
  potTotal,
  startHand,
  type HandState,
  type Seat,
} from "./betting";
import { SUIT_IS_RED, SUIT_SYMBOL, bestHand, buildDeck, cardLabel, rankName, shuffle } from "./hands";

const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
/** How long the finished hand is left on screen before the next deal. */
const HAND_REVIEW_MS = 6000;

function freshSeats(players: { player: number }[]): Seat[] {
  return players.map((info) => ({
    player: info.player,
    chips: STARTING_CHIPS,
    bet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    hole: [],
  }));
}

function deal(seats: Seat[], button: number): HandState {
  // Anyone out of chips sits the hand out rather than being dealt in.
  return startHand(seats, button, SMALL_BLIND, BIG_BLIND, shuffle(buildDeck()));
}

export function Poker({ send, subscribe, onExit, players, publish }: GameProps) {
  const [button, setButton] = useState(0);
  const [hand, setHand] = useState<HandState>(() => deal(freshSeats(players), 0));

  const playersRef = useRef(players);
  playersRef.current = players;
  const sendRef = useRef(send);
  sendRef.current = send;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const handRef = useRef(hand);
  handRef.current = hand;

  const seatOf = useCallback(
    (playerNumber: number) => handRef.current.seats.findIndex((s) => s.player === playerNumber),
    [],
  );

  // ---------------------------------------------------------------------
  // Phone views: hole cards are only ever sent to the player holding them.
  // ---------------------------------------------------------------------
  useEffect(() => {
    const roster = playersRef.current;
    const legal = hand.street === "done" ? null : legalActions(hand);
    const pot = potTotal(hand);

    hand.seats.forEach((seat, index) => {
      const holeCards = seat.hole.map((card) => ({
        id: `hole:${card.rank}${card.suit}`,
        label: cardLabel(card),
        color: SUIT_IS_RED[card.suit] ? "#c0392b" : "#22262e",
        playable: false,
      }));

      let view: PhoneView;
      if (hand.street === "done") {
        const won = hand.payouts?.filter((p) => p.seat === index).reduce((a, p) => a + p.amount, 0) ?? 0;
        view = {
          title: won > 0 ? `You win ${won}` : seat.folded ? "You folded" : "Hand over",
          note: `You have ${seat.chips} chips.`,
          cards: holeCards,
          waiting: true,
        };
      } else if (seat.folded) {
        view = { title: "You folded", note: `Waiting for the hand to finish.`, waiting: true };
      } else if (index === hand.toAct && legal) {
        view = {
          title: "Your move",
          subtitle: `Pot ${pot} · you have ${seat.chips}`,
          cards: holeCards,
          actions: [
            { id: "fold", label: "Fold", style: "danger" },
            legal.canCheck
              ? { id: "check", label: "Check", style: "muted" }
              : { id: "call", label: `Call ${legal.callAmount}`, style: "muted" },
          ],
          slider: legal.canRaise
            ? {
                id: "raise",
                label: "Raise to",
                min: legal.minRaiseTo,
                max: legal.maxRaiseTo,
                step: SMALL_BLIND,
                value: legal.minRaiseTo,
                submitLabel: legal.maxRaiseTo === legal.minRaiseTo ? "All in" : "Raise",
              }
            : undefined,
        };
      } else {
        view = {
          title: seat.allIn ? "You're all in" : `Player ${hand.seats[hand.toAct].player}'s move`,
          subtitle: `Pot ${pot} · you have ${seat.chips}`,
          cards: holeCards,
          waiting: true,
        };
      }

      sendRef.current({ type: "phone-view", view, to: roster[index]?.player ?? seat.player });
    });
  }, [hand]);

  useEffect(() => {
    return () => {
      for (const info of playersRef.current) {
        sendRef.current({ type: "phone-view", view: null, to: info.player });
      }
    };
  }, []);

  // ---------------------------------------------------------------------
  // Actions from the phones
  // ---------------------------------------------------------------------
  useEffect(() => {
    return subscribe((msg, player) => {
      if (msg.type !== "action") return;
      const current = handRef.current;
      if (current.street === "done") return;
      const index = seatOf(player);
      if (index !== current.toAct) return;

      if (msg.id === "fold") setHand(applyAction(current, { kind: "fold" }));
      else if (msg.id === "check") setHand(applyAction(current, { kind: "check" }));
      else if (msg.id === "call") setHand(applyAction(current, { kind: "call" }));
      else if (msg.id === "raise") setHand(applyAction(current, { kind: "raise", to: Number(msg.value) }));
    });
  }, [subscribe, seatOf]);

  // Once a hand is settled, bank the stacks, move the button, deal again.
  useEffect(() => {
    if (hand.street !== "done") return;
    const timer = window.setTimeout(() => {
      // Chips carry over; everything else about the seat resets.
      const banked = hand.seats.map((seat) => ({ ...seat, bet: 0, committed: 0, folded: false, allIn: false, hole: [] }));
      const withChips = banked.filter((seat) => seat.chips > 0);
      if (withChips.length < 2) return; // one player left holding everything
      const nextBtn = nextButton(banked, button);
      setButton(nextBtn);
      setHand(deal(banked, nextBtn));
    }, HAND_REVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [hand, button]);

  // A on the game-over card returns to the menu.
  const gameOver = hand.street === "done" && hand.seats.filter((s) => s.chips > 0).length < 2;
  useEffect(() => {
    if (!gameOver) return;
    return subscribe((msg) => {
      if (msg.type === "button" && msg.button === "A" && msg.state === "down") onExitRef.current();
    });
  }, [gameOver, subscribe]);

  // Mirror the table to spectators -- community cards and chips only, never
  // anybody's hole cards, unless the hand has been shown down.
  useEffect(() => {
    publish({
      players,
      community: hand.community,
      pot: potTotal(hand),
      button,
      toAct: hand.toAct,
      street: hand.street,
      log: hand.log.slice(0, 6),
      seats: hand.seats.map((seat) => ({
        player: seat.player,
        chips: seat.chips,
        bet: seat.bet,
        folded: seat.folded,
        allIn: seat.allIn,
        hole: hand.street === "done" && !seat.folded ? seat.hole : [],
      })),
      payouts: hand.payouts ?? [],
    });
  }, [hand, button, players, publish]);

  const pot = potTotal(hand);
  const showdown = hand.street === "done";

  return (
    <div className="poker-root">
      <div className="poker-board">
        <div className="poker-community">
          {hand.community.map((card) => (
            <div key={`${card.rank}${card.suit}`} className={`poker-card${SUIT_IS_RED[card.suit] ? " is-red" : ""}`}>
              <span className="poker-rank">{rankName(card.rank)}</span>
              <span className="poker-suit">{SUIT_SYMBOL[card.suit]}</span>
            </div>
          ))}
          {hand.community.length === 0 && <div className="poker-preflop">Pre-flop</div>}
        </div>
        <div className="poker-pot">Pot {pot}</div>
      </div>

      <div className="poker-seats">
        {hand.seats.map((seat, index) => {
          const info = players[index];
          const isUp = index === hand.toAct && !showdown;
          const won = hand.payouts?.filter((p) => p.seat === index).reduce((a, p) => a + p.amount, 0) ?? 0;
          return (
            <div
              key={seat.player}
              className={`poker-seat${isUp ? " is-up" : ""}${seat.folded ? " is-folded" : ""}${won > 0 ? " is-winner" : ""}`}
            >
              <div className="poker-seat-head">
                {info && <MiiAvatar mii={info.mii} size={36} />}
                <span className="poker-seat-name">
                  P{seat.player}
                  {index === button ? " ⬤" : ""}
                </span>
                <span className="poker-seat-chips">{seat.chips}</span>
              </div>
              <div className="poker-seat-state">
                {seat.folded
                  ? "folded"
                  : seat.allIn
                    ? "all in"
                    : seat.bet > 0
                      ? `bet ${seat.bet}`
                      : isUp
                        ? "to act"
                        : ""}
              </div>
              {showdown && !seat.folded && (
                <div className="poker-seat-hole">
                  {seat.hole.map((card) => (
                    <span key={`${card.rank}${card.suit}`} className={SUIT_IS_RED[card.suit] ? "is-red" : ""}>
                      {cardLabel(card)}
                    </span>
                  ))}
                  {hand.community.length === 5 && (
                    <span className="poker-seat-hand">{bestHand([...seat.hole, ...hand.community]).name}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ul className="poker-log">
        {hand.log.slice(0, 5).map((line, i) => (
          <li key={`${line}-${i}`}>{line}</li>
        ))}
      </ul>

      {gameOver && (
        <div className="poker-overlay">
          <div className="poker-final">
            <h2>Player {hand.seats.find((s) => s.chips > 0)?.player} takes it all</h2>
            <p className="poker-hint">Press A to return to the Wii Menu</p>
          </div>
        </div>
      )}

      <div className="poker-hint-bar">Bet from your phone · blinds {SMALL_BLIND}/{BIG_BLIND} · HOME to exit</div>
    </div>
  );
}
