import { useEffect, useRef, useState, type RefObject } from "react";
import type { ControllerMessage } from "../../shared/protocol";
import { playHoverTick } from "../lib/sound";

/** Screen-percent moved per normalized pointer offset unit (~90 degrees of tilt). */
export const POINTER_SENSITIVITY = 100;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function indexForPosition(x: number, y: number, cols: number, rows: number) {
  const col = clamp(Math.floor((x / 100) * cols), 0, cols - 1);
  const row = clamp(Math.floor((y / 100) * rows), 0, rows - 1);
  return row * cols + col;
}

/**
 * Shared phone-pointer-driven grid cursor: tracks an absolute cursor
 * position from `pointer`/`recenter` messages (written imperatively to a
 * DOM ref -- no re-render per pointer tick), derives which grid cell it's
 * hovering (only re-rendering when that actually changes, with a hover
 * chime), and edge-triggers `onSelect(index)` on an A-button down press.
 *
 * Used by the Wii Menu and any other pointer-navigated grid screen (Mii
 * select, lane select) so this logic lives in exactly one place instead of
 * being copy-pasted per screen.
 */
export function usePointerGrid(
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void,
  cols: number,
  rows: number,
  onSelect: (index: number) => void,
): { cursorRef: RefObject<HTMLDivElement | null>; hoveredIndex: number } {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef({ x: 50, y: 50 });
  const hoveredIndexRef = useRef(indexForPosition(50, 50, cols, rows));
  const aDownRef = useRef(false);
  const [hoveredIndex, setHoveredIndex] = useState(hoveredIndexRef.current);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    // Grid shape changed (a different screen mounted) -- reset to center.
    hoveredIndexRef.current = indexForPosition(50, 50, cols, rows);
    setHoveredIndex(hoveredIndexRef.current);

    function applyPosition(x: number, y: number) {
      positionRef.current = { x, y };
      const el = cursorRef.current;
      if (el) {
        el.style.left = `${x}%`;
        el.style.top = `${y}%`;
      }
      const nextIndex = indexForPosition(x, y, cols, rows);
      if (nextIndex !== hoveredIndexRef.current) {
        hoveredIndexRef.current = nextIndex;
        setHoveredIndex(nextIndex);
        playHoverTick();
      }
    }

    function handler(msg: ControllerMessage) {
      switch (msg.type) {
        case "pointer": {
          const nextX = clamp(50 + msg.ox * POINTER_SENSITIVITY, 0, 100);
          const nextY = clamp(50 + msg.oy * POINTER_SENSITIVITY, 0, 100);
          applyPosition(nextX, nextY);
          break;
        }
        case "recenter": {
          applyPosition(50, 50);
          break;
        }
        case "button": {
          if (msg.button === "A") {
            if (msg.state === "down" && !aDownRef.current) {
              aDownRef.current = true;
              onSelectRef.current(hoveredIndexRef.current);
            } else if (msg.state === "up") {
              aDownRef.current = false;
            }
          }
          break;
        }
        default:
          break;
      }
    }

    return subscribe(handler);
  }, [subscribe, cols, rows]);

  return { cursorRef, hoveredIndex };
}

/**
 * Free-aim variant for canvas games that need a continuous reticle/turret
 * position rather than grid-cell hovering (Target Practice's gun sight,
 * Tanks!'s turret crosshair). Returns a plain ref -- NOT React state -- so
 * canvas games (which already redraw every animation frame) can read
 * `posRef.current` directly in their draw loop without this hook forcing an
 * extra re-render on every pointer tick (~30/sec). `x`/`y` are percent of
 * the play area, 0-100, same absolute-offset-from-calibrated-center mapping
 * as `usePointerGrid`.
 */
export function usePointerPosition(
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void,
): RefObject<{ x: number; y: number }> {
  const posRef = useRef({ x: 50, y: 50 });

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "pointer") {
        posRef.current = {
          x: clamp(50 + msg.ox * POINTER_SENSITIVITY, 0, 100),
          y: clamp(50 + msg.oy * POINTER_SENSITIVITY, 0, 100),
        };
      } else if (msg.type === "recenter") {
        posRef.current = { x: 50, y: 50 };
      }
    });
  }, [subscribe]);

  return posRef;
}
