import { useCallback, useEffect, useRef, useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import { MII_FIELDS, randomMii, randomName, type Mii, type MiiFieldDef } from "./Mii";
import { MiiAvatar } from "./MiiAvatar";
import { playHoverTick, playButtonBlip, playLaunchChime } from "../../lib/sound";
import "./mii-editor.css";

interface MiiEditorProps {
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void;
  mii: Mii;
  onSave: (mii: Mii) => void;
  onBack: () => void;
  hostPlayer?: number;
}

// "Name" behaves like every other category (Up/Down cycles its value) --
// cycling it just rerolls a random name instead of stepping through a
// fixed option list, sidestepping on-phone text entry entirely.
interface Category {
  key: string;
  label: string;
  field: MiiFieldDef | null;
}

function buildCategories(): Category[] {
  return [{ key: "name", label: "Name", field: null }, ...MII_FIELDS.map((field) => ({ key: field.key, label: field.label, field }))];
}

const CATEGORIES = buildCategories();

function valueFor(mii: Mii, category: Category): string {
  return category.field ? (mii as unknown as Record<string, string>)[category.field.key] : mii.name;
}

function withValue(mii: Mii, category: Category, value: string): Mii {
  if (!category.field) return { ...mii, name: value };
  return { ...mii, [category.field.key]: value } as Mii;
}

/**
 * The Mii editor: a close-up head view (framed like the real Mii Channel's
 * editor, not a full-body shot) with a left/right category strip and an
 * up/down icon palette for the active category's options -- each palette
 * icon is a real small preview of the Mii with that option applied, not an
 * abstract label, so you can see exactly what you're picking before you
 * commit to it.
 */
export function MiiEditor({ subscribe, mii, onSave, onBack, hostPlayer }: MiiEditorProps) {
  const [current, setCurrent] = useState<Mii>(mii);
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);

  const currentRef = useRef(current);
  currentRef.current = current;
  const categoryIndexRef = useRef(categoryIndex);
  categoryIndexRef.current = categoryIndex;

  const paletteRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const savedFlashTimeoutRef = useRef<number | null>(null);

  const category = CATEGORIES[categoryIndex];
  const options = category.field?.options ?? null;
  const currentValue = valueFor(current, category);

  useEffect(() => {
    if (options) {
      paletteRefs.current[currentValue]?.scrollIntoView({ block: "nearest" });
    }
  }, [categoryIndex, currentValue, options]);

  const changeCategory = useCallback((dir: 1 | -1) => {
    setCategoryIndex((i) => (i + dir + CATEGORIES.length) % CATEGORIES.length);
    playHoverTick();
  }, []);

  const changeValue = useCallback((dir: 1 | -1) => {
    const cat = CATEGORIES[categoryIndexRef.current];
    if (!cat.field) {
      setCurrent((m) => withValue(m, cat, randomName()));
      playButtonBlip();
      return;
    }
    const opts = cat.field.options;
    const value = valueFor(currentRef.current, cat);
    const idx = opts.indexOf(value);
    const next = opts[(idx + dir + opts.length) % opts.length];
    setCurrent((m) => withValue(m, cat, next));
    playButtonBlip();
  }, []);

  const handleSave = useCallback(() => {
    playLaunchChime();
    setSavedFlash(true);
    if (savedFlashTimeoutRef.current !== null) window.clearTimeout(savedFlashTimeoutRef.current);
    savedFlashTimeoutRef.current = window.setTimeout(() => {
      onSave(currentRef.current);
    }, 700);
  }, [onSave]);

  const handleRandomize = useCallback(() => {
    setCurrent((m) => randomMii(m.id));
    playButtonBlip();
  }, []);

  useEffect(() => {
    return subscribe((msg, player) => {
      if (hostPlayer !== undefined && player !== hostPlayer) return;
      if (msg.type !== "button" || msg.state !== "down") return;
      switch (msg.button) {
        case "LEFT":
          changeCategory(-1);
          break;
        case "RIGHT":
          changeCategory(1);
          break;
        case "UP":
          changeValue(-1);
          break;
        case "DOWN":
          changeValue(1);
          break;
        case "A":
          handleSave();
          break;
        case "B":
          onBack();
          break;
        case "ONE":
          handleRandomize();
          break;
        default:
          break;
      }
    });
  }, [subscribe, hostPlayer, changeCategory, changeValue, handleSave, handleRandomize, onBack]);

  useEffect(() => {
    return () => {
      if (savedFlashTimeoutRef.current !== null) window.clearTimeout(savedFlashTimeoutRef.current);
    };
  }, []);

  return (
    <div className="mii-editor-root">
      <div className="mii-editor-stage">
        <div className="mii-editor-preview-crop">
          <MiiAvatar mii={current} size={280} className="mii-editor-preview-avatar" />
        </div>
        <div className="mii-editor-model">
          <span className="mii-editor-model-caption">Whole Mii</span>
          <MiiAvatar mii={current} size={64} />
        </div>
      </div>

      <div className="mii-editor-category-bar">
        <button className="mii-editor-arrow" onClick={() => changeCategory(-1)} aria-label="Previous category">
          ‹
        </button>
        <div className="mii-editor-category-label">
          {category.label}
          {category.key === "name" && <span className="mii-editor-category-value"> — {current.name}</span>}
        </div>
        <button className="mii-editor-arrow" onClick={() => changeCategory(1)} aria-label="Next category">
          ›
        </button>
      </div>

      {options && (
        <div className="mii-editor-palette">
          {options.map((opt) => {
            const previewMii = withValue(current, category, opt);
            const selected = opt === currentValue;
            return (
              <div
                key={opt}
                ref={(el) => {
                  paletteRefs.current[opt] = el;
                }}
                className={`mii-editor-palette-item${selected ? " mii-editor-palette-item-selected" : ""}`}
              >
                <div className="mii-editor-palette-crop">
                  <MiiAvatar mii={previewMii} size={90} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {savedFlash && <div className="mii-editor-saved-flash">Saved!</div>}

      <div className="mii-editor-hint">
        D-pad Left/Right: category · Up/Down: option · A: Save &amp; back to Plaza · B: Discard &amp; back · 1:
        Randomize! · HOME: exit
      </div>
    </div>
  );
}
