import { useEffect, useState } from "react";
import type { GameProps } from "../games/types";
import { NdsPlayer } from "./NdsPlayer";
import { pickPersistentFile, reopenPersistentFile, supportsFileSystemAccess } from "./filePersistence";
import "./nds-channel.css";

const ROM_SLOT_KEY = "nds-rom";

/**
 * Setup screen for the DS Channel: just the game ROM -- the emulator core
 * (DeSmuME, see nds-player.html) has HLE BIOS support built in and boots
 * straight into a game without needing real BIOS/firmware dumps, so there's
 * nothing else to provide. On Chrome/Edge, File System Access API
 * remembers the picked file (via filePersistence.ts) so returning players
 * only see a quick permission re-confirmation, not a full re-browse; other
 * browsers fall back to picking fresh each time.
 *
 * The file is never sent anywhere -- it's read straight into a blob: URL
 * handed to the local NdsPlayer iframe.
 */
export function NdsChannel({ subscribe, onExit, mii }: GameProps) {
  const [romFile, setRomFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!supportsFileSystemAccess) {
        setRestoring(false);
        return;
      }
      const file = await reopenPersistentFile(ROM_SLOT_KEY);
      if (!cancelled) {
        if (file) setRomFile(file);
        setRestoring(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = async () => {
    const file = await pickPersistentFile(ROM_SLOT_KEY, [".nds"]);
    if (file) setRomFile(file);
  };

  if (romFile) {
    return (
      <NdsPlayer
        subscribe={subscribe}
        onExit={onExit}
        mii={mii}
        title={romFile.name.replace(/\.nds$/i, "")}
        romFile={romFile}
      />
    );
  }

  return (
    <div className="nds-channel-root">
      <h1 className="nds-channel-title">DS Channel</h1>
      <p className="nds-channel-sub">
        Load a game you own. None of it leaves this browser. Pick the file directly on this laptop/TV -- your phone
        can't open a file picker here.
      </p>
      {restoring ? (
        <p className="nds-channel-restoring">Checking for a previously loaded ROM…</p>
      ) : (
        <button className="nds-channel-slot nds-channel-slot-single" onClick={() => void pick()}>
          <span className="nds-channel-slot-label">Game ROM (.nds)</span>
          <span className="nds-channel-slot-status">Choose file</span>
        </button>
      )}
      <p className="nds-channel-hint">Press HOME on your phone to exit anytime.</p>
    </div>
  );
}
