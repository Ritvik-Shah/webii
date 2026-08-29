import { useState } from "react";
import type { ControllerMessage } from "../../../shared/protocol";
import { randomMii, type Mii } from "./Mii";
import { loadCustomMiis, saveCustomMii } from "./miiStorage";
import { MiiPlaza } from "./MiiPlaza";
import { MiiEditor } from "./MiiEditor";

interface MiiChannelProps {
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  onExit: () => void;
}

type Mode = { kind: "plaza" } | { kind: "editor"; mii: Mii };

/**
 * Top-level Mii Channel: a Plaza (browse/pick your saved Miis, or start a
 * new one) that opens into an Editor for whichever Mii you picked, matching
 * the real Mii Channel's two-screen flow rather than jumping straight into
 * editing. HOME exits to the Wii Menu from either screen (handled centrally
 * by ScreenApp, same as every other channel) -- there's no separate
 * in-screen "back to menu" button here, consistent with the Wii Menu/Mii
 * Select screens.
 */
export function MiiChannel({ subscribe }: MiiChannelProps) {
  const [roster, setRoster] = useState<Mii[]>(() => loadCustomMiis());
  const [mode, setMode] = useState<Mode>({ kind: "plaza" });

  const handleSelectMii = (mii: Mii) => setMode({ kind: "editor", mii });
  const handleNewMii = () => setMode({ kind: "editor", mii: randomMii(`mii-${Date.now()}`) });
  const handleBack = () => setMode({ kind: "plaza" });
  const handleSave = (mii: Mii) => {
    setRoster(saveCustomMii(mii));
    setMode({ kind: "plaza" });
  };

  if (mode.kind === "editor") {
    return <MiiEditor subscribe={subscribe} mii={mode.mii} onSave={handleSave} onBack={handleBack} />;
  }
  return <MiiPlaza subscribe={subscribe} roster={roster} onSelectMii={handleSelectMii} onNewMii={handleNewMii} />;
}
