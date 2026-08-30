import { useCallback, useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import { usePointerGrid } from "../usePointerGrid";
import { Cursor } from "../Cursor";
import type { PlayerInfo } from "../games/types";
import { MII_ROSTER, type Mii } from "./Mii";
import { loadCustomMiis } from "./miiStorage";
import { MiiAvatar } from "./MiiAvatar";
import "./mii-select.css";

interface MiiSelectProps {
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void;
  /** Shown in the header, e.g. "Bowling" -- context for which channel is
   * about to launch. */
  channelTitle: string;
  /** Player numbers in the room, in join order. */
  players: number[];
  onDone: (picks: PlayerInfo[]) => void;
}

const COLS = 4;
const ROWS = 3;
const MAX_TILES = COLS * ROWS;

// Anyone who's made their own Mii in the Mii Channel sees those first (most
// likely what they actually want to play as); the preset roster fills
// whatever slots are left, so there's always something to pick even before
// creating a Mii of your own.
function buildRoster(): Mii[] {
  const custom = loadCustomMiis();
  const combined = [...custom, ...MII_ROSTER];
  return combined.slice(0, MAX_TILES);
}

/**
 * Players pick one at a time rather than all at once: with up to four
 * cursors on one grid it stops being clear whose is whose, and the games
 * that follow are turn-based anyway. Only the player currently up has their
 * remote wired to the cursor.
 */
export function MiiSelect({ subscribe, channelTitle, players, onDone }: MiiSelectProps) {
  const [roster] = useState<Mii[]>(buildRoster);
  // Frozen on mount: someone joining or dropping mid-pick shouldn't reorder
  // or resize the queue that's already underway.
  const [queue] = useState<number[]>(() => (players.length > 0 ? players : [1]));
  const [picks, setPicks] = useState<PlayerInfo[]>([]);

  const currentPlayer = queue[picks.length];

  const handleSelect = useCallback(
    (index: number) => {
      const mii = roster[index];
      if (!mii || currentPlayer === undefined) return;
      const next = [...picks, { player: currentPlayer, mii }];
      if (next.length >= queue.length) onDone(next);
      else setPicks(next);
    },
    [roster, picks, queue.length, currentPlayer, onDone],
  );

  const { cursorRef, gridRef, hoveredIndex } = usePointerGrid(subscribe, COLS, ROWS, handleSelect, currentPlayer);

  return (
    <div className="mii-select-root">
      <header className="mii-select-header">
        <span className="mii-select-title">
          {queue.length > 1 ? `Player ${currentPlayer} — choose your Mii` : "Choose your Mii"}
        </span>
        <span className="mii-select-subtitle">for {channelTitle}</span>
      </header>

      {queue.length > 1 && (
        <div className="mii-select-queue">
          {queue.map((player, i) => {
            const pick = picks[i];
            const state = pick ? " is-done" : player === currentPlayer ? " is-active" : "";
            return (
              <div key={player} className={`mii-select-queue-item${state}`}>
                <span className="mii-select-queue-label">P{player}</span>
                {pick ? <MiiAvatar mii={pick.mii} size={34} /> : <span className="mii-select-queue-wait">—</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="mii-select-grid" ref={gridRef}>
        {roster.map((mii, index) => (
          <div
            key={mii.id}
            className={`mii-select-tile${index === hoveredIndex ? " mii-select-tile-hover" : ""}`}
          >
            <MiiAvatar mii={mii} size={72} />
            <span className="mii-select-name">{mii.name}</span>
          </div>
        ))}
      </div>
      <Cursor ref={cursorRef} />
      <div className="mii-select-hint">
        {queue.length > 1
          ? `Player ${currentPlayer}: point and tap A to choose`
          : "Point and tap A to choose. Make your own in the Mii Channel!"}
      </div>
    </div>
  );
}
