import { useCallback, useEffect, useRef, useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import { MII_FIELDS, randomMii, randomName, type Mii } from "./Mii";
import { loadCustomMiis, saveCustomMii } from "./miiStorage";
import { MiiAvatar } from "./MiiAvatar";
import { playHoverTick, playButtonBlip, playLaunchChime } from "../../lib/sound";
import "./mii-channel.css";

interface MiiChannelProps {
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  onExit: () => void;
}

// "Name" is edited the same way every other row is (Left/Right cycles its
// value) -- it just rerolls a random name instead of stepping through a
// fixed option list, which sidesteps needing on-phone text entry entirely.
const ROW_COUNT = MII_FIELDS.length + 1;
const NAME_ROW = 0;

function fieldAt(row: number) {
  return row === NAME_ROW ? null : MII_FIELDS[row - 1];
}

function cycleField(mii: Mii, row: number, dir: 1 | -1): Mii {
  if (row === NAME_ROW) {
    return { ...mii, name: randomName() };
  }
  const field = fieldAt(row)!;
  const options = field.options;
  const current = (mii as unknown as Record<string, string>)[field.key];
  const idx = options.indexOf(current);
  const next = options[(idx + dir + options.length) % options.length];
  return { ...mii, [field.key]: next } as Mii;
}

/**
 * The Mii Channel: a from-scratch character creator, far more detailed than
 * the 5-property preset Miis used elsewhere in the app (18 customizable
 * fields here vs. a handful before). Fully phone-controllable -- D-pad
 * Up/Down picks a row, Left/Right cycles that row's value (including the
 * name, which just rerolls a random one), no typing required.
 */
export function MiiChannel({ subscribe, onExit }: MiiChannelProps) {
  const [roster, setRoster] = useState<Mii[]>(() => loadCustomMiis());
  const [current, setCurrent] = useState<Mii>(() => {
    const existing = loadCustomMiis();
    return existing[0] ?? randomMii(`mii-${Date.now()}`);
  });
  const [rosterIndex, setRosterIndex] = useState<number>(() => (loadCustomMiis().length > 0 ? 0 : -1));
  const [selectedRow, setSelectedRow] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);

  const currentRef = useRef(current);
  currentRef.current = current;
  const selectedRowRef = useRef(selectedRow);
  selectedRowRef.current = selectedRow;
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const rosterIndexRef = useRef(rosterIndex);
  rosterIndexRef.current = rosterIndex;

  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const savedFlashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    rowRefs.current[selectedRow]?.scrollIntoView({ block: "nearest" });
  }, [selectedRow]);

  const moveRow = useCallback((dir: 1 | -1) => {
    setSelectedRow((r) => Math.min(ROW_COUNT - 1, Math.max(0, r + dir)));
    playHoverTick();
  }, []);

  const cycleValue = useCallback((dir: 1 | -1) => {
    setCurrent((m) => cycleField(m, selectedRowRef.current, dir));
    playButtonBlip();
  }, []);

  const handleSave = useCallback(() => {
    const next = saveCustomMii(currentRef.current);
    setRoster(next);
    setRosterIndex(next.findIndex((m) => m.id === currentRef.current.id));
    playLaunchChime();
    setSavedFlash(true);
    if (savedFlashTimeoutRef.current !== null) window.clearTimeout(savedFlashTimeoutRef.current);
    savedFlashTimeoutRef.current = window.setTimeout(() => setSavedFlash(false), 1400);
  }, []);

  const handleRandomize = useCallback(() => {
    setCurrent((m) => randomMii(m.id));
    playButtonBlip();
  }, []);

  const handleNewMii = useCallback(() => {
    setCurrent(randomMii(`mii-${Date.now()}`));
    setRosterIndex(-1);
    setSelectedRow(0);
    playButtonBlip();
  }, []);

  const handleNextInRoster = useCallback(() => {
    const list = rosterRef.current;
    if (list.length === 0) return;
    const next = (rosterIndexRef.current + 1) % list.length;
    setRosterIndex(next);
    setCurrent(list[next]);
    playHoverTick();
  }, []);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== "button" || msg.state !== "down") return;
      switch (msg.button) {
        case "UP":
          moveRow(-1);
          break;
        case "DOWN":
          moveRow(1);
          break;
        case "LEFT":
          cycleValue(-1);
          break;
        case "RIGHT":
          cycleValue(1);
          break;
        case "A":
          handleSave();
          break;
        case "B":
          handleRandomize();
          break;
        case "ONE":
          handleNewMii();
          break;
        case "TWO":
          handleNextInRoster();
          break;
        default:
          break;
      }
    });
  }, [subscribe, moveRow, cycleValue, handleSave, handleRandomize, handleNewMii, handleNextInRoster]);

  useEffect(() => {
    return () => {
      if (savedFlashTimeoutRef.current !== null) window.clearTimeout(savedFlashTimeoutRef.current);
    };
  }, []);

  return (
    <div className="mii-channel-root">
      <div className="mii-channel-preview">
        <MiiAvatar mii={current} size={220} className="mii-channel-avatar" />
        <div className="mii-channel-name">{current.name}</div>
        {rosterIndex >= 0 && <div className="mii-channel-editing-badge">Editing saved Mii</div>}
      </div>

      <div className="mii-channel-editor">
        <div
          className={`mii-channel-row${selectedRow === NAME_ROW ? " mii-channel-row-selected" : ""}`}
          ref={(el) => {
            rowRefs.current[NAME_ROW] = el;
          }}
        >
          <span className="mii-channel-row-label">Name</span>
          <span className="mii-channel-row-value">{current.name}</span>
        </div>
        {MII_FIELDS.map((field, i) => {
          const row = i + 1;
          const value = (current as unknown as Record<string, string>)[field.key];
          return (
            <div
              key={field.key}
              className={`mii-channel-row${selectedRow === row ? " mii-channel-row-selected" : ""}`}
              ref={(el) => {
                rowRefs.current[row] = el;
              }}
            >
              <span className="mii-channel-row-label">{field.label}</span>
              {field.swatch ? (
                <span className="mii-channel-swatch" style={{ background: value }} />
              ) : (
                <span className="mii-channel-row-value">{value}</span>
              )}
            </div>
          );
        })}
      </div>

      {roster.length > 0 && (
        <div className="mii-channel-roster">
          {roster.map((m, i) => (
            <div key={m.id} className={`mii-channel-roster-item${i === rosterIndex ? " mii-channel-roster-active" : ""}`}>
              <MiiAvatar mii={m} size={40} />
            </div>
          ))}
        </div>
      )}

      {savedFlash && <div className="mii-channel-saved-flash">Mii saved!</div>}

      <div className="mii-channel-hint">
        D-pad Up/Down: choose · Left/Right: change · A: Save · B: Randomize! · 1: New Mii · 2: Next saved Mii · HOME:
        exit
      </div>
      <button className="mii-channel-back-button" onClick={onExit}>
        Back to Wii Menu
      </button>
    </div>
  );
}
