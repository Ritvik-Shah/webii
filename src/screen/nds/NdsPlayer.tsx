import { useEffect, useRef, useState } from "react";
import type { ControllerMessage, ButtonName } from "../../../shared/protocol";
import { MiiAvatar } from "../mii/MiiAvatar";
import type { Mii } from "../mii/Mii";
import "./nds.css";

// libretro's standard joypad button indices -- stable across every
// libretro core (including melonDS), this is the same index space
// EmulatorJS's own gamepad.js/emulator.js use when calling simulateInput.
const RETRO = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
};

// Our remote has A/B/1/2 + D-pad -- fewer face buttons than a real DS
// (which also has X/Y/L/R). X/Y/L/R are unmapped for v1; most core
// gameplay (movement, A/B confirm-cancel, Start/Select menus) doesn't need
// them. 1/2 stand in for Select/Start, same pairing used for the NES
// Channel.
const BUTTON_MAP: Partial<Record<ButtonName, number>> = {
  UP: RETRO.UP,
  DOWN: RETRO.DOWN,
  LEFT: RETRO.LEFT,
  RIGHT: RETRO.RIGHT,
  A: RETRO.A,
  B: RETRO.B,
  ONE: RETRO.SELECT,
  TWO: RETRO.START,
};

interface EjsGameManager {
  simulateInput: (player: number, index: number, value: number) => void;
}
interface EjsEmulatorWindow extends Window {
  EJS_emulator?: { gameManager?: EjsGameManager };
}

interface NdsPlayerProps {
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  onExit: () => void;
  mii: Mii;
  title: string;
  romFile: File;
  bios7: File;
  bios9: File;
  firmware: File;
}

/**
 * Plays an NDS ROM via EmulatorJS (melonDS core), loaded through their CDN
 * inside an iframe -- EmulatorJS's own docs say it can't run directly on a
 * React/SPA page. The ROM/BIOS files themselves never leave the browser:
 * they're handed to the iframe as blob: URLs built from local File objects.
 *
 * Known gap, unconfirmed against a real device: EmulatorJS's documented
 * config only exposes a single EJS_biosUrl, but melonDS wants three
 * distinct files (bios7/bios9/firmware). We pass bios9 (ARM9) through that
 * slot as the best guess at the most load-bearing one; bios7/firmware are
 * appended as extra query params in case the core looks for sibling files
 * by convention, but this is genuinely unverified and the most likely
 * thing to need a live-debugging pass.
 */
export function NdsPlayer({ subscribe, onExit, mii, title, romFile, bios7, bios9, firmware }: NdsPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const heldRef = useRef<Set<ButtonName>>(new Set());
  const touchRef = useRef({ x: 50, y: 50 });

  const iframeSrc = useRef<string | null>(null);
  if (iframeSrc.current === null) {
    const romUrl = URL.createObjectURL(romFile);
    const bios7Url = URL.createObjectURL(bios7);
    const bios9Url = URL.createObjectURL(bios9);
    const firmwareUrl = URL.createObjectURL(firmware);
    const params = new URLSearchParams({
      rom: romUrl,
      bios9: bios9Url,
      bios7: bios7Url,
      firmware: firmwareUrl,
      name: title,
    });
    // The Workers assets binding auto-redirects the .html extension away
    // (/nds-player.html -> /nds-player); reference the clean URL directly
    // rather than relying on the iframe following that redirect.
    iframeSrc.current = `/nds-player?${params.toString()}`;
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "nds-ready" || e.data?.type === "nds-started") {
        setReady(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Revoke the blob URLs on unmount -- they're only needed for the one
  // iframe load.
  useEffect(() => {
    return () => {
      if (iframeSrc.current) {
        const url = new URL(iframeSrc.current, location.origin);
        for (const key of ["rom", "bios7", "bios9", "firmware"]) {
          const blobUrl = url.searchParams.get(key);
          if (blobUrl) URL.revokeObjectURL(blobUrl);
        }
      }
    };
  }, []);

  const emulatorWindow = () => (iframeRef.current?.contentWindow ?? null) as EjsEmulatorWindow | null;

  const sendButton = (button: number, down: boolean) => {
    const gm = emulatorWindow()?.EJS_emulator?.gameManager;
    gm?.simulateInput(0, button, down ? 1 : 0);
  };

  // Touch screen: the DS's bottom screen needs tap/drag input a fixed
  // button set can't naturally express. We repurpose the Recenter gesture
  // (its usual "fix cursor drift" job doesn't apply during NDS play, no
  // Wii-style pointer is shown here) as "tap the touch screen at your
  // current tilt-aim position" -- covers menu navigation, which is most of
  // what the touch screen is used for. A held drag isn't implemented in
  // this pass.
  const tapTouchScreen = () => {
    const doc = iframeRef.current?.contentDocument;
    const canvas = doc?.querySelector("canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // The DS's touch screen is the bottom half of the combined display.
    const x = rect.left + rect.width * (touchRef.current.x / 100);
    const y = rect.top + rect.height * 0.5 + rect.height * 0.5 * (touchRef.current.y / 100);
    const opts = { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window };
    canvas.dispatchEvent(new MouseEvent("mousedown", opts));
    window.setTimeout(() => {
      canvas.dispatchEvent(new MouseEvent("mouseup", opts));
    }, 60);
  };

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "pointer") {
        touchRef.current = {
          x: Math.min(100, Math.max(0, 50 + msg.ox * 100)),
          y: Math.min(100, Math.max(0, 50 + msg.oy * 100)),
        };
        return;
      }
      if (msg.type === "recenter") {
        tapTouchScreen();
        return;
      }
      if (msg.type !== "button") return;
      const retroIndex = BUTTON_MAP[msg.button];
      if (retroIndex === undefined) return;
      const isDown = msg.state === "down";
      const held = heldRef.current;
      if (isDown) held.add(msg.button);
      else held.delete(msg.button);
      sendButton(retroIndex, isDown);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  // If the player exits (HOME) mid-press, release every button we still
  // think is held so the emulator doesn't see it as stuck down for the
  // next game.
  useEffect(() => {
    return () => {
      for (const button of heldRef.current) {
        const retroIndex = BUTTON_MAP[button];
        if (retroIndex !== undefined) sendButton(retroIndex, false);
      }
      heldRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="nds-root">
      <div className="nds-header">
        <MiiAvatar mii={mii} size={40} />
        <span className="nds-title">{title}</span>
      </div>
      <div className="nds-screen-wrap">
        <iframe ref={iframeRef} src={iframeSrc.current ?? undefined} className="nds-iframe" title={title} />
        {!ready && <div className="nds-overlay">Starting…</div>}
      </div>
      <div className="nds-hint">
        D-pad/A/B/1/2 map to the DS's own buttons · Recenter taps the touch screen at your aim · HOME to exit
      </div>
      <button className="nds-back-button" onClick={onExit}>
        Back to Wii Menu
      </button>
    </div>
  );
}
