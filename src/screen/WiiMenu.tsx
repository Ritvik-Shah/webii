import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ControllerMessage } from "../../shared/protocol";
import { CHANNELS } from "./channels";
import { Cursor } from "./Cursor";
import { usePointerGrid } from "./usePointerGrid";
import { playLaunchChime, playButtonBlip } from "../lib/sound";

interface WiiMenuProps {
  send: (msg: object) => void;
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  onLaunch: (channelId: string) => void;
}

const GRID_COLS = 4;
const GRID_ROWS = 3;

export function WiiMenu({ subscribe, onLaunch }: WiiMenuProps) {
  const [launchingIndex, setLaunchingIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const launchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const launchChannel = useCallback(
    (index: number) => {
      const channel = CHANNELS[index];
      if (!channel) return;

      playButtonBlip();
      playLaunchChime();
      setLaunchingIndex(index);
      if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = setTimeout(() => {
        setLaunchingIndex(null);
        if (channel.status === "ready") onLaunch(channel.id);
      }, 650);

      if (channel.status !== "ready") {
        setToast(`${channel.title} is coming soon`);
        if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = setTimeout(() => {
          setToast(null);
        }, 1800);
      }
    },
    [onLaunch],
  );

  useEffect(() => {
    return () => {
      if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const { cursorRef, hoveredIndex } = usePointerGrid(subscribe, GRID_COLS, GRID_ROWS, launchChannel);

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
