import { forwardRef } from "react";

/**
 * On-screen pointer standing in for the Wii's IR pointer.
 *
 * Position is applied imperatively by the parent (WiiMenu) via
 * `ref.current.style.left` / `.style.top` on every pointer tick, so this
 * component intentionally renders no inline positioning style itself --
 * base centering (translate(-50%, -50%)) lives in the .wii-cursor CSS class.
 */
interface CursorProps {
  /** Percent of the screen. Used by spectator mirrors, which receive the
   * position in a snapshot rather than driving it imperatively. */
  x?: number;
  y?: number;
  /** Tints the cursor, so it is obvious which player is driving. */
  color?: string;
  label?: string;
}

export const Cursor = forwardRef<HTMLDivElement, CursorProps>(function Cursor({ x, y, color, label }, ref) {
  const positioned = x !== undefined && y !== undefined;
  return (
    <div
      ref={ref}
      className="wii-cursor"
      style={positioned ? { left: `${x}%`, top: `${y}%` } : undefined}
    >
      <svg className="wii-cursor-glyph" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="#ffffff" fillOpacity="0.9" stroke={color ?? "#0b3d91"} strokeWidth="2.5" />
        <circle cx="16" cy="16" r="3" fill={color ?? "#0b3d91"} />
      </svg>
      {label && <span className="wii-cursor-label">{label}</span>}
    </div>
  );
});

Cursor.displayName = "Cursor";
