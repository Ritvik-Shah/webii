import { useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import { usePointerGrid } from "../usePointerGrid";
import { Cursor } from "../Cursor";
import { MII_ROSTER, type Mii } from "./Mii";
import { loadCustomMiis } from "./miiStorage";
import { MiiAvatar } from "./MiiAvatar";
import "./mii-select.css";

interface MiiSelectProps {
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  /** Shown in the header, e.g. "Wii Sports: Bowling" -- just context for
   * which channel the player is about to launch. */
  channelTitle: string;
  onSelect: (mii: Mii) => void;
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

export function MiiSelect({ subscribe, channelTitle, onSelect }: MiiSelectProps) {
  const [roster] = useState<Mii[]>(buildRoster);

  const handleSelect = (index: number) => {
    const mii = roster[index];
    if (mii) onSelect(mii);
  };

  const { cursorRef, gridRef, hoveredIndex } = usePointerGrid(subscribe, COLS, ROWS, handleSelect);

  return (
    <div className="mii-select-root">
      <header className="mii-select-header">
        <span className="mii-select-title">Choose your Mii</span>
        <span className="mii-select-subtitle">for {channelTitle}</span>
      </header>
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
      <div className="mii-select-hint">Point and tap A to choose. Make your own in the Mii Channel!</div>
    </div>
  );
}
