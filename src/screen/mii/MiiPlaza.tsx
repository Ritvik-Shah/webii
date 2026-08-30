import type { ControllerMessage } from "../../../shared/protocol";
import { usePointerGrid } from "../usePointerGrid";
import { Cursor } from "../Cursor";
import type { Mii } from "./Mii";
import { MiiAvatar } from "./MiiAvatar";
import "./mii-plaza.css";

interface MiiPlazaProps {
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void;
  roster: Mii[];
  onSelectMii: (mii: Mii) => void;
  onNewMii: () => void;
  hostPlayer?: number;
  spectating?: boolean;
}

const COLS = 4;
const ROWS = 3;
// Same "no paging yet" limit the Wii Menu itself has -- one slot is always
// reserved for "New Mii", so up to 11 saved Miis show here at once.
const MAX_SAVED = COLS * ROWS - 1;

/**
 * The Mii Plaza: every Mii you've saved, standing around on a checkered
 * floor, pointer-and-A to walk up to one and edit it (or the always-present
 * "New Mii" tile to start fresh) -- the hub screen real Wii Mii Channel
 * opens on, rather than jumping straight into an editor.
 */
export function MiiPlaza({ subscribe, roster, onSelectMii, onNewMii, hostPlayer, spectating = false }: MiiPlazaProps) {
  const shown = roster.slice(0, MAX_SAVED);
  const tileCount = shown.length + 1; // + the New Mii tile

  const handleSelect = (index: number) => {
    if (index < shown.length) onSelectMii(shown[index]);
    else onNewMii();
  };

  const { cursorRef, gridRef, hoveredIndex } = usePointerGrid(subscribe, COLS, ROWS, handleSelect, hostPlayer);

  return (
    <div className="mii-plaza-root">
      <header className="mii-plaza-header">
        <span className="mii-plaza-title">Mii Plaza</span>
        <span className="mii-plaza-subtitle">
          {roster.length === 0 ? "No Miis yet -- make your first one!" : "Point at a Mii to edit it"}
        </span>
      </header>

      <div className="mii-plaza-floor" ref={gridRef}>
        {shown.map((mii, index) => (
          <div key={mii.id} className={`mii-plaza-tile${index === hoveredIndex ? " mii-plaza-tile-hover" : ""}`}>
            <MiiAvatar mii={mii} size={68} />
            <span className="mii-plaza-name">{mii.name}</span>
          </div>
        ))}
        <div
          className={`mii-plaza-tile mii-plaza-tile-new${tileCount - 1 === hoveredIndex ? " mii-plaza-tile-hover" : ""}`}
        >
          <span className="mii-plaza-new-icon">+</span>
          <span className="mii-plaza-name">New Mii</span>
        </div>
      </div>

      {!spectating && <Cursor ref={cursorRef} />}
      <div className="mii-plaza-hint">Point and tap A to choose · HOME to exit</div>
    </div>
  );
}
