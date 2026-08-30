import { useEffect, useRef, useState, type RefObject } from "react";
import type { ControllerMessage } from "../../shared/protocol";
import { playHoverTick } from "../lib/sound";

/** Screen-percent moved per normalized pointer offset unit (~90 degrees of tilt). */
export const POINTER_SENSITIVITY = 100;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Shared phone-pointer-driven grid cursor: tracks an absolute cursor
 * position from `pointer`/`recenter` messages (written imperatively to a
 * DOM ref -- no re-render per pointer tick), derives which grid cell it's
 * hovering (only re-rendering when that actually changes, with a hover
 * chime), and edge-triggers `onSelect(index)` on an A-button down press.
 *
 * `hoveredIndex` is computed from the grid container's real on-screen
 * bounding box (via `gridRef`, which callers must attach to their grid
 * element), not from the cursor's raw screen-percent position -- a layout
 * with a header/padding around the grid (every screen that uses this) means
 * "50% down the screen" and "50% down the grid" are different places, so
 * using the raw percent directly caused the highlighted tile to visibly
 * disagree with where the cursor glyph actually was. `hoveredIndex` is
 * `null` whenever the cursor is genuinely outside the grid's bounds (e.g.
 * over the header) -- no tile is forced to stay highlighted in that case,
 * and A does nothing while it's null.
 *
 * Used by the Wii Menu and any other pointer-navigated grid screen (Mii
 * select, etc.) so this logic lives in exactly one place instead of being
 * copy-pasted per screen.
 */
export function usePointerGrid(
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void,
  cols: number,
  rows: number,
  onSelect: (index: number) => void,
  /** When set, only this player's remote drives the cursor -- everyone
   * else's input is ignored. Used for the host-driven Wii Menu and for
   * taking Mii picks one player at a time. */
  forPlayer?: number,
): { cursorRef: RefObject<HTMLDivElement | null>; gridRef: RefObject<HTMLDivElement | null>; hoveredIndex: number | null } {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef({ x: 50, y: 50 });
  const hoveredIndexRef = useRef<number | null>(null);
  const aDownRef = useRef(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    // Grid shape changed (a different screen mounted) -- nothing's hovered
    // until the next real pointer reading comes in (within ~33ms).
    hoveredIndexRef.current = null;
    setHoveredIndex(null);

    function indexForScreenPercent(xPercent: number, yPercent: number): number | null {
      const grid = gridRef.current;
      if (!grid) return null;
      const rect = grid.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const px = (xPercent / 100) * window.innerWidth;
      const py = (yPercent / 100) * window.innerHeight;
      if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) return null;
      const col = clamp(Math.floor(((px - rect.left) / rect.width) * cols), 0, cols - 1);
      const row = clamp(Math.floor(((py - rect.top) / rect.height) * rows), 0, rows - 1);
      return row * cols + col;
    }

    function applyPosition(x: number, y: number) {
      positionRef.current = { x, y };
      const el = cursorRef.current;
      if (el) {
        el.style.left = `${x}%`;
        el.style.top = `${y}%`;
      }
      const nextIndex = indexForScreenPercent(x, y);
      if (nextIndex !== hoveredIndexRef.current) {
        hoveredIndexRef.current = nextIndex;
        setHoveredIndex(nextIndex);
        if (nextIndex !== null) playHoverTick();
      }
    }

    function handler(msg: ControllerMessage, player: number) {
      if (forPlayer !== undefined && player !== forPlayer) return;
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
              if (hoveredIndexRef.current !== null) onSelectRef.current(hoveredIndexRef.current);
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
  }, [subscribe, cols, rows, forPlayer]);

  return { cursorRef, gridRef, hoveredIndex };
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
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void,
  forPlayer?: number,
): RefObject<{ x: number; y: number }> {
  const posRef = useRef({ x: 50, y: 50 });

  useEffect(() => {
    return subscribe((msg, player) => {
      if (forPlayer !== undefined && player !== forPlayer) return;
      if (msg.type === "pointer") {
        posRef.current = {
          x: clamp(50 + msg.ox * POINTER_SENSITIVITY, 0, 100),
          y: clamp(50 + msg.oy * POINTER_SENSITIVITY, 0, 100),
        };
      } else if (msg.type === "recenter") {
        posRef.current = { x: 50, y: 50 };
      }
    });
  }, [subscribe, forPlayer]);

  return posRef;
}
