import { useEffect, useState } from "react";
import type { ButtonName, ControllerMessage } from "../../shared/protocol";

interface DebugOverlayProps {
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
}

const BUTTONS: ButtonName[] = ["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "ONE", "TWO", "HOME"];

/** Verification tool for Phase 2's acceptance criterion: every control on
 * the phone (D-pad/A/B/1/2/Home + pointer) independently lights up here as
 * it's pressed/moved, so each one can be checked without needing a game
 * wired up yet. Collapsed by default (a small tab in the corner) -- only
 * subscribes to the message bus while expanded, so it costs nothing during
 * normal play. */
export function DebugOverlay({ subscribe }: DebugOverlayProps) {
  const [expanded, setExpanded] = useState(false);
  const [pressed, setPressed] = useState<Partial<Record<ButtonName, boolean>>>({});
  const [pointer, setPointer] = useState({ ox: 0, oy: 0 });

  useEffect(() => {
    if (!expanded) return;
    return subscribe((msg) => {
      if (msg.type === "button") {
        setPressed((prev) => ({ ...prev, [msg.button]: msg.state === "down" }));
      } else if (msg.type === "pointer") {
        setPointer({ ox: msg.ox, oy: msg.oy });
      }
    });
  }, [subscribe, expanded]);

  return (
    <div className={`debug-overlay${expanded ? " debug-overlay-open" : ""}`}>
      <button className="debug-overlay-tab" onClick={() => setExpanded((v) => !v)} aria-label="Toggle control debug overlay">
        🎮
      </button>
      {expanded && (
        <div className="debug-overlay-panel">
          <div className="debug-overlay-row">
            {BUTTONS.map((b) => (
              <span key={b} className={`debug-overlay-btn${pressed[b] ? " debug-overlay-btn-lit" : ""}`}>
                {b}
              </span>
            ))}
          </div>
          <div className="debug-overlay-pointer">
            pointer ox {pointer.ox.toFixed(2)} / oy {pointer.oy.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}
