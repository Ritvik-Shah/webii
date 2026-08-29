import { useEffect, useState } from "react";
import type { GameProps } from "../games/types";
import { NdsPlayer } from "./NdsPlayer";
import { pickPersistentFile, reopenPersistentFile, supportsFileSystemAccess } from "./filePersistence";
import "./nds-channel.css";

interface SlotConfig {
  key: string;
  label: string;
  accept: string[];
}

const SLOTS: SlotConfig[] = [
  { key: "nds-rom", label: "Game ROM (.nds)", accept: [".nds"] },
  { key: "nds-bios7", label: "ARM7 BIOS (bios7.bin)", accept: [".bin"] },
  { key: "nds-bios9", label: "ARM9 BIOS (bios9.bin)", accept: [".bin"] },
  { key: "nds-firmware", label: "Firmware (firmware.bin)", accept: [".bin"] },
];

/**
 * Setup screen for the DS Channel: four local files (the ROM plus melonDS's
 * three required BIOS/firmware dumps) need to be picked before a game can
 * start. On Chrome/Edge, File System Access API remembers which file was
 * picked for each slot (via filePersistence.ts) so returning players only
 * see a quick permission re-confirmation, not a full re-browse; other
 * browsers fall back to picking fresh each time.
 *
 * None of these files are ever sent anywhere -- they're read straight into
 * blob: URLs handed to the local NdsPlayer iframe.
 */
export function NdsChannel({ subscribe, onExit, mii }: GameProps) {
  const [files, setFiles] = useState<Partial<Record<string, File>>>({});
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!supportsFileSystemAccess) {
        setRestoring(false);
        return;
      }
      const restored: Partial<Record<string, File>> = {};
      for (const slot of SLOTS) {
        const file = await reopenPersistentFile(slot.key);
        if (file) restored[slot.key] = file;
      }
      if (!cancelled) {
        setFiles((prev) => ({ ...restored, ...prev }));
        setRestoring(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = async (slot: SlotConfig) => {
    const file = await pickPersistentFile(slot.key, slot.accept);
    if (file) setFiles((prev) => ({ ...prev, [slot.key]: file }));
  };

  const allChosen = SLOTS.every((s) => files[s.key]);

  if (allChosen) {
    const romFile = files["nds-rom"]!;
    return (
      <NdsPlayer
        subscribe={subscribe}
        onExit={onExit}
        mii={mii}
        title={romFile.name.replace(/\.nds$/i, "")}
        romFile={romFile}
        bios7={files["nds-bios7"]!}
        bios9={files["nds-bios9"]!}
        firmware={files["nds-firmware"]!}
      />
    );
  }

  return (
    <div className="nds-channel-root">
      <h1 className="nds-channel-title">DS Channel</h1>
      <p className="nds-channel-sub">
        Load a game you own, plus your own BIOS/firmware dumps from your DS console. None of these leave this
        browser. Pick each file directly on this laptop/TV -- your phone can't open a file picker here.
      </p>
      {restoring ? (
        <p className="nds-channel-restoring">Checking for previously loaded files…</p>
      ) : (
        <div className="nds-channel-slots">
          {SLOTS.map((slot) => {
            const chosen = files[slot.key];
            return (
              <button key={slot.key} className={`nds-channel-slot${chosen ? " nds-channel-slot-done" : ""}`} onClick={() => void pick(slot)}>
                <span className="nds-channel-slot-label">{slot.label}</span>
                <span className="nds-channel-slot-status">{chosen ? chosen.name : "Choose file"}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="nds-channel-hint">Press HOME on your phone to exit anytime.</p>
    </div>
  );
}
