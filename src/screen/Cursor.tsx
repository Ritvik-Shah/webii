import { forwardRef } from "react";

/**
 * On-screen pointer standing in for the Wii's IR pointer.
 *
 * Position is applied imperatively by the parent (WiiMenu) via
 * `ref.current.style.left` / `.style.top` on every pointer tick, so this
 * component intentionally renders no inline positioning style itself --
 * base centering (translate(-50%, -50%)) lives in the .wii-cursor CSS class.
 */
export const Cursor = forwardRef<HTMLDivElement>(function Cursor(_props, ref) {
  return (
    <div ref={ref} className="wii-cursor">
      <svg className="wii-cursor-glyph" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="#ffffff" fillOpacity="0.9" stroke="#0b3d91" strokeWidth="2.5" />
        <circle cx="16" cy="16" r="3" fill="#0b3d91" />
      </svg>
    </div>
  );
});

Cursor.displayName = "Cursor";
