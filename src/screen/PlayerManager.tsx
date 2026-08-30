import { useEffect, useRef } from "react";
import type { ControllerMessage } from "../../shared/protocol";
import { MAX_PLAYERS } from "../../shared/protocol";
import { Cursor } from "./Cursor";
import { usePointerGrid } from "./usePointerGrid";

interface PlayerManagerProps {
  players: number[];
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void;
  hostPlayer?: number;
  onKick: (player: number) => void;
}

/** A calm, dedicated place to manage seats without interrupting a game. */
export function PlayerManager({ players, subscribe, hostPlayer, onKick }: PlayerManagerProps) {
  const { cursorRef, gridRef, hoveredIndex } = usePointerGrid(subscribe, MAX_PLAYERS, 1, () => {}, hostPlayer);
  const hoveredRef = useRef(hoveredIndex);
  hoveredRef.current = hoveredIndex;
  const onKickRef = useRef(onKick);
  onKickRef.current = onKick;

  useEffect(() => {
    if (hostPlayer === undefined) return;
    return subscribe((msg, player) => {
      if (player !== hostPlayer || msg.type !== "button" || msg.button !== "B" || msg.state !== "down") return;
      const seat = hoveredRef.current;
      if (seat !== null && players.includes(seat + 1)) onKickRef.current(seat + 1);
    });
  }, [subscribe, hostPlayer, players]);

  return (
    <div className="player-manager-root">
      <header className="player-manager-header">
        <span className="player-manager-title">Player Manager</span>
        <span className="player-manager-subtitle">Manage controllers before starting a game</span>
      </header>
      <div className="player-manager-seats" ref={gridRef}>
        {Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1).map((seat, index) => {
          const connected = players.includes(seat);
          const selected = index === hoveredIndex && connected && seat !== hostPlayer;
          return (
            <div key={seat} className={`player-manager-card${connected ? " is-connected" : ""}${selected ? " is-selected" : ""}`}>
              <span className="player-manager-number">Player {seat}</span>
              <span>{connected ? (selected ? "B to remove" : seat === hostPlayer ? "Host" : "Connected") : "Open"}</span>
            </div>
          );
        })}
      </div>
      <p className="player-manager-hint">Player {hostPlayer ?? 1}: point at a connected player and press B to remove them · HOME to return</p>
      {hostPlayer !== undefined && <Cursor ref={cursorRef} />}
    </div>
  );
}
