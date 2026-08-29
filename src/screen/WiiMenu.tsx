import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ControllerMessage } from "../../shared/protocol";
import { CHANNELS } from "./channels";
import { Cursor } from "./Cursor";
import { playHoverTick, playLaunchChime, playButtonBlip } from "../lib/sound";

interface WiiMenuProps {
  send: (msg: object) => void;
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
}

const GRID_COLS = 4;
const GRID_ROWS = 3;

/** Multiplies incoming pointer dx/dy before adding to the cursor position ref. */
const POINTER_SPEED = 55;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function indexForPosition(x: number, y: number) {
  const col = clamp(Math.floor((x / 100) * GRID_COLS), 0, GRID_COLS - 1);
  const row = clamp(Math.floor((y / 100) * GRID_ROWS), 0, GRID_ROWS - 1);
  return row * GRID_COLS + col;
}

export function WiiMenu({ subscribe }: WiiMenuProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef({ x: 50, y: 50 });
  const hoveredIndexRef = useRef(indexForPosition(50, 50));
  const aDownRef = useRef(false);
  const launchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [hoveredIndex, setHoveredIndex] = useState(hoveredIndexRef.current);
  const [launchingIndex, setLaunchingIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    function applyPosition(x: number, y: number) {
      positionRef.current = { x, y };
      const el = cursorRef.current;
      if (el) {
        el.style.left = `${x}%`;
        el.style.top = `${y}%`;
      }
      const nextIndex = indexForPosition(x, y);
      if (nextIndex !== hoveredIndexRef.current) {
        hoveredIndexRef.current = nextIndex;
        setHoveredIndex(nextIndex);
        playHoverTick();
      }
    }

    function launchChannel(index: number) {
      const channel = CHANNELS[index];
      if (!channel) return;

      playLaunchChime();
      setLaunchingIndex(index);
      if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = setTimeout(() => {
        setLaunchingIndex(null);
      }, 650);

      if (channel.status !== "ready") {
        setToast(`${channel.title} is coming soon`);
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = setTimeout(() => {
          setToast(null);
        }, 1800);
      }
    }

    function handler(msg: ControllerMessage) {
      switch (msg.type) {
        case "pointer": {
          const { x, y } = positionRef.current;
          const nextX = clamp(x + msg.dx * POINTER_SPEED, 0, 100);
          const nextY = clamp(y + msg.dy * POINTER_SPEED, 0, 100);
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
              playButtonBlip();
              launchChannel(hoveredIndexRef.current);
            } else if (msg.state === "up") {
              aDownRef.current = false;
            }
          }
          break;
        }
        default:
          // motion / ping / pong / B / HOME: no-op for now.
          break;
      }
    }

    return subscribe(handler);
  }, [subscribe]);

  return (
    <div className="wii-menu">
      <header className="wii-menu-header">
        <span className="wii-logo">Webii</span>
      </header>
      <div className="wii-grid">
        {CHANNELS.map((channel, index) => {
          const className = [
            "wii-tile",
            index === hoveredIndex && "wii-tile-hover",
            index === launchingIndex && "wii-tile-launch",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={channel.id}
              className={className}
              style={{ "--accent": channel.accent } as CSSProperties}
            >
              <span className="wii-tile-title">{channel.title}</span>
              {channel.status === "soon" && <span className="wii-tile-badge">Coming soon</span>}
            </div>
          );
        })}
      </div>
      <Cursor ref={cursorRef} />
      {toast && <div className="wii-toast">{toast}</div>}
    </div>
  );
}
