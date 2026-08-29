import type { ControllerMessage } from "../../../shared/protocol";
import { usePointerGrid } from "../usePointerGrid";
import { Cursor } from "../Cursor";
import "./lane-select.css";

interface LaneSelectProps {
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  onSelect: (lane: number) => void;
}

const COLS = 3;
const ROWS = 2;
const LANE_COUNT = COLS * ROWS;

export function LaneSelect({ subscribe, onSelect }: LaneSelectProps) {
  const handleSelect = (index: number) => {
    if (index >= 0 && index < LANE_COUNT) onSelect(index + 1);
  };

  const { cursorRef, hoveredIndex } = usePointerGrid(subscribe, COLS, ROWS, handleSelect);

  return (
    <div className="lane-select-root">
      <header className="lane-select-header">
        <span className="lane-select-title">Choose your lane</span>
        <span className="lane-select-subtitle">for Wii Sports: Bowling</span>
      </header>
      <div className="lane-select-grid">
        {Array.from({ length: LANE_COUNT }).map((_, index) => (
          <div
            key={index}
            className={`lane-select-tile${index === hoveredIndex ? " lane-select-tile-hover" : ""}`}
          >
            <div className="lane-select-strip">
              <span className="lane-select-pin-dot" />
              <span className="lane-select-pin-dot" />
              <span className="lane-select-pin-dot" />
            </div>
            <span className="lane-select-number">{index + 1}</span>
          </div>
        ))}
      </div>
      <Cursor ref={cursorRef} />
      <div className="lane-select-hint">Point and tap A to choose.</div>
    </div>
  );
}
