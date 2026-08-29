import type { ControllerMessage } from "../../../shared/protocol";
import { usePointerGrid } from "../usePointerGrid";
import { Cursor } from "../Cursor";
import { MII_ROSTER, type Mii } from "./Mii";
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
const ROWS = 2;

export function MiiSelect({ subscribe, channelTitle, onSelect }: MiiSelectProps) {
  const handleSelect = (index: number) => {
    const mii = MII_ROSTER[index];
    if (mii) onSelect(mii);
  };

  const { cursorRef, hoveredIndex } = usePointerGrid(subscribe, COLS, ROWS, handleSelect);

  return (
    <div className="mii-select-root">
      <header className="mii-select-header">
        <span className="mii-select-title">Choose your Mii</span>
        <span className="mii-select-subtitle">for {channelTitle}</span>
      </header>
      <div className="mii-select-grid">
        {MII_ROSTER.map((mii, index) => (
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
      <div className="mii-select-hint">Point and tap A to choose.</div>
    </div>
  );
}
