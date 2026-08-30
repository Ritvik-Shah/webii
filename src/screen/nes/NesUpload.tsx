import { useRef, useState } from "react";
import type { GameProps } from "../games/types";
import { NesPlayer } from "./NesPlayer";
import "./nes-upload.css";

async function hashFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A file-based ROM loader. Unlike every other interaction in this app, this
 * one genuinely can't be driven from the phone -- a browser file picker can
 * only be opened by a real click on the device that owns it, and that's
 * this screen (laptop/TV), not the controller. The UI makes that explicit
 * rather than leaving someone tapping fruitlessly with the phone pointer.
 *
 * The chosen file's own content is hashed (SHA-256) to key its save slot,
 * so re-loading the same ROM later (even a fresh upload of the same file)
 * resumes the same save, while a different file gets its own slot.
 */
export function NesUpload({ subscribe, onExit, players }: GameProps) {
  const mii = players[0].mii;
  const [file, setFile] = useState<File | null>(null);
  const [saveKey, setSaveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    if (!chosen.name.toLowerCase().endsWith(".nes")) {
      setError("That doesn't look like a .nes ROM file.");
      return;
    }
    setError(null);
    try {
      const key = await hashFile(chosen);
      setSaveKey(key);
      setFile(chosen);
    } catch {
      setError("Couldn't read that file.");
    }
  };

  if (file && saveKey) {
    return (
      <NesPlayer
        subscribe={subscribe}
        onExit={onExit}
        mii={mii}
        title={file.name.replace(/\.nes$/i, "")}
        saveKey={saveKey}
        romSource={{ kind: "file", file }}
      />
    );
  }

  return (
    <div className="nes-upload-root">
      <h1 className="nes-upload-title">NES Channel</h1>
      <p className="nes-upload-sub">
        Load a NES ROM you own to play it here -- your phone can't open a file picker on this screen, so pick the
        file directly on this laptop/TV.
      </p>
      <button className="nes-upload-button" onClick={() => inputRef.current?.click()}>
        Choose ROM file (.nes)
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".nes"
        className="nes-upload-input"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {error && <p className="nes-upload-error">{error}</p>}
      <p className="nes-upload-hint">Progress saves automatically per ROM. Press HOME on your phone to exit.</p>
    </div>
  );
}
