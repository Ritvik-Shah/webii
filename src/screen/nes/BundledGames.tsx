import type { GameProps } from "../games/types";
import { NesPlayer } from "./NesPlayer";

// Two bundled-ROM slots, ready to flip on once specific titles are
// confirmed as legitimately free to redistribute (see project notes) and
// their files are placed at /public/roms/. Wired but not yet linked from a
// menu channel -- see channels.ts, both still marked "soon".

export function NesGame1({ subscribe, onExit, players }: GameProps) {
  const mii = players[0].mii;
  return (
    <NesPlayer
      subscribe={subscribe}
      onExit={onExit}
      mii={mii}
      title="Retro Game 1"
      saveKey="bundled-1"
      romSource={{ kind: "url", url: "/roms/game1.nes" }}
    />
  );
}

export function NesGame2({ subscribe, onExit, players }: GameProps) {
  const mii = players[0].mii;
  return (
    <NesPlayer
      subscribe={subscribe}
      onExit={onExit}
      mii={mii}
      title="Retro Game 2"
      saveKey="bundled-2"
      romSource={{ kind: "url", url: "/roms/game2.nes" }}
    />
  );
}
