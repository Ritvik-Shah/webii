import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ControllerMessage } from "../../../../shared/protocol";
import { Cursor } from "../../Cursor";
import { usePointerGrid } from "../../usePointerGrid";
import { MII_ROSTER } from "../../mii/Mii";
import type { GameProps } from "../types";
import { SONGS } from "./content";
import { IslandView, ROOM_CELLS, type Activity, type Focus, type IslandSnapshot } from "./IslandView";
import { ROOT, applyPhoneAction, phoneViewFor, type Nav } from "./phone";
import { loadIsland, saveIsland } from "./storage";
import {
  FOODS,
  LOCATIONS,
  OUTFITS,
  addResident,
  isUnlocked,
  logEvent,
  makeWish,
  residentById,
  socialTick,
  tickNeeds,
  type Island as IslandState,
} from "./sim";

// Mii Island: our Tomodachi Life.
//
// The split is the one the 3DS had, and it maps onto this room unusually
// well. The TV is the top screen -- the apartments, the island, whatever is
// happening right now -- and each phone is the bottom screen, where you look
// after your own Miis and answer the things they ask you. Nobody controls a
// Mii; you feed them, dress them, and then find out what they decided to do
// about each other.
//
// Everything that decides anything lives in sim.ts and phone.ts, which are
// plain modules with no React in them, so the rules can be stepped and
// asserted on outside a browser.

/** Real seconds between simulation ticks. */
const TICK_MS = 1000;
/** ...and between social beats, so scenes don't blur past. */
const BEAT_TICKS = 6;
const SAVE_TICKS = 10;
const TOAST_MS = 6000;
/** How long each line of a song stays on the screen. */
const SONG_LINE_MS = 2600;
const LUCKY_BAG_COST = 30;

export function Island({ send, subscribe, players, publish }: GameProps) {
  // The island is held in a ref rather than state: phone taps have to read
  // and write the current island synchronously (a tap resolves a request,
  // which may level a Mii, which raises the next request), and a queue of
  // deferred state updaters made that ordering unreadable. Rendering reads
  // the same ref, forced by `bump`.
  const islandRef = useRef<IslandState | null>(null);
  if (!islandRef.current) islandRef.current = loadIsland();
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const [focus, setFocus] = useState<Focus>({ kind: "none" });
  const [activity, setActivity] = useState<Activity>({ kind: "none" });
  const [toast, setToast] = useState<string | null>(null);
  const [navs, setNavs] = useState<Record<number, Nav>>({});

  const sendRef = useRef(send);
  sendRef.current = send;
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const navsRef = useRef(navs);
  navsRef.current = navs;
  const playersRef = useRef(players);
  playersRef.current = players;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const lastSent = useRef(new Map<number, string>());
  const toastTimer = useRef(0);

  const hostPlayer = players[0]?.player;

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  // -----------------------------------------------------------------------
  // Moving in
  // -----------------------------------------------------------------------
  useEffect(() => {
    const island = islandRef.current!;
    for (const info of players) addResident(island, info.mii, info.player);
    // A single Mii alone in a block of flats has nobody to fall out with, so
    // the island keeps a few neighbours of its own.
    for (const mii of MII_ROSTER) {
      if (island.residents.length >= 4) break;
      addResident(island, mii, 0);
    }
    bump();
  }, [players]);

  // -----------------------------------------------------------------------
  // The clock
  // -----------------------------------------------------------------------
  useEffect(() => {
    let ticks = 0;
    const timer = window.setInterval(() => {
      const island = islandRef.current!;
      ticks += 1;
      tickNeeds(island, TICK_MS / 1000);
      if (ticks % BEAT_TICKS === 0) socialTick(island, Math.random());
      if (ticks % SAVE_TICKS === 0) saveIsland(island);
      bump();
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      saveIsland(islandRef.current!);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Phones
  // -----------------------------------------------------------------------
  const pushViews = useCallback(() => {
    const island = islandRef.current!;
    for (const info of playersRef.current) {
      const nav = navsRef.current[info.player] ?? ROOT;
      // Pure and cheap, so it is simply recomputed every render and only
      // sent when it actually differs from what that phone is showing.
      const view = phoneViewFor(island, info.player, info.player === playersRef.current[0]?.player, nav);
      const json = JSON.stringify(view);
      if (lastSent.current.get(info.player) === json) continue;
      lastSent.current.set(info.player, json);
      sendRef.current({ type: "phone-view", view, to: info.player });
    }
  }, []);

  useEffect(() => {
    pushViews();
  });

  useEffect(() => {
    const sent = lastSent.current;
    return () => {
      for (const player of sent.keys()) {
        sendRef.current({ type: "phone-view", view: null, to: player });
      }
      // The cache has to record what the phone is actually holding, which is
      // now nothing. Leaving the old entries here means a remount believes
      // the phones already have their menus, sends nothing, and every player
      // is left staring at a plain remote -- which is precisely what
      // happened on the first end-to-end run.
      sent.clear();
    };
  }, []);

  const handleAction = useCallback(
    (player: number, id: string) => {
      const island = islandRef.current!;
      const nav = navsRef.current[player] ?? ROOT;
      const outcome = applyPhoneAction(island, nav, id);
      setNavs((current) => ({ ...current, [player]: outcome.nav }));
      if (outcome.result) {
        say(outcome.result.message);
        // Look in on whoever was just fussed over.
        if (outcome.result.ok && outcome.result.resident) {
          setFocus({ kind: "resident", id: outcome.result.resident });
        }
      }
      bump();
    },
    [say],
  );

  useEffect(() => {
    return subscribe((msg: ControllerMessage, player: number) => {
      if (msg.type === "action") handleAction(player, msg.id);
    });
  }, [subscribe, handleAction]);

  // -----------------------------------------------------------------------
  // The host's pointer
  // -----------------------------------------------------------------------
  const visit = useCallback(
    (locationId: string) => {
      const island = islandRef.current!;
      const location = LOCATIONS.find((l) => l.id === locationId);
      if (!location || !isUnlocked(island, location)) return;

      if (locationId === "fountain") {
        const text = makeWish(island);
        setActivity({ kind: "note", text });
        say(text);
        bump();
        return;
      }

      if (locationId === "amusement") {
        if (island.coins < LUCKY_BAG_COST) {
          say("Not enough coins for a lucky bag.");
          return;
        }
        island.coins -= LUCKY_BAG_COST;
        // Half the time a bag is food, half the time it's something to wear.
        const roll = Math.random();
        let text: string;
        if (roll < 0.5) {
          const food = FOODS[Math.floor(Math.random() * FOODS.length)];
          island.pantry[food.id] = (island.pantry[food.id] ?? 0) + 2;
          text = `Lucky bag: two of ${food.name}.`;
        } else {
          const outfit = OUTFITS[Math.floor(Math.random() * OUTFITS.length)];
          if (island.wardrobe.includes(outfit.id)) {
            island.coins += LUCKY_BAG_COST;
            text = "Lucky bag: something you already own. Refunded, this once.";
          } else {
            island.wardrobe.push(outfit.id);
            text = `Lucky bag: the ${outfit.name}!`;
          }
        }
        logEvent(island, "news", text, []);
        setActivity({ kind: "note", text });
        say(text);
        bump();
        return;
      }

      if (locationId === "concert") {
        const ready = island.residents.filter((r) => r.songs.length > 0);
        if (ready.length === 0) {
          say("Nobody knows a song yet — give one as a level-up present.");
          return;
        }
        const singer = ready[Math.floor(Math.random() * ready.length)];
        const songId = singer.songs[Math.floor(Math.random() * singer.songs.length)];
        setActivity({ kind: "song", resident: singer.id, song: songId, line: 0 });
        const song = SONGS.find((s) => s.id === songId);
        say(`${singer.mii.name} takes the stage: “${song?.title ?? "a song"}”`);
        return;
      }

      setActivity({ kind: "none" });
    },
    [say],
  );

  const handleSelect = useCallback(
    (index: number) => {
      const island = islandRef.current!;
      if (index < ROOM_CELLS) {
        const resident = island.residents[index];
        setFocus(resident ? { kind: "resident", id: resident.id } : { kind: "none" });
        setActivity({ kind: "none" });
        return;
      }
      const location = LOCATIONS[index - ROOM_CELLS];
      if (!location) return;
      setFocus({ kind: "location", id: location.id });
      visit(location.id);
    },
    [visit],
  );

  const { cursorRef, gridRef, hoveredIndex } = usePointerGrid(subscribe, 6, 5, handleSelect, hostPlayer);

  // A song plays itself out a line at a time, then the singer gets the
  // applause.
  useEffect(() => {
    if (activity.kind !== "song") return;
    const song = SONGS.find((s) => s.id === activity.song);
    if (!song) return;
    const timer = window.setTimeout(() => {
      if (activity.line + 1 >= song.lines.length) {
        const island = islandRef.current!;
        const singer = residentById(island, activity.resident);
        if (singer) {
          singer.happiness = Math.min(99, singer.happiness + 20);
          singer.boredom = 0;
          singer.mood = "happy";
          logEvent(island, "milestone", `${singer.mii.name} brought the house down with “${song.title}”.`, [singer.id]);
        }
        setActivity({ kind: "none" });
        bump();
        return;
      }
      setActivity({ ...activity, line: activity.line + 1 });
    }, SONG_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [activity]);

  // -----------------------------------------------------------------------
  // Spectators
  // -----------------------------------------------------------------------
  useEffect(() => {
    const timer = window.setInterval(() => {
      publishRef.current(snapshotOf(islandRef.current!, focusRef.current, activityRef.current, toastRef.current));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const island = islandRef.current!;
  const snapshot: IslandSnapshot = { kind: "island", island, focus, activity, toast };

  return (
    <div className="island-root">
      <IslandView
        snapshot={snapshot}
        hoveredIndex={hoveredIndex}
        boardRef={gridRef}
        hint={`Player ${hostPlayer ?? 1}: point and press A · everything else is on your phone · HOME to leave`}
      />
      <Cursor ref={cursorRef} />
    </div>
  );
}

/**
 * A slimmed island for the watch screen. Bonds nobody has formed yet are the
 * bulk of the state once the block fills up, and they say nothing, so they
 * are left out.
 */
function snapshotOf(island: IslandState, focus: Focus, activity: Activity, toast: string | null): IslandSnapshot {
  return {
    kind: "island",
    island: {
      ...island,
      bonds: island.bonds.filter((b) => b.friendship > 0 || b.status !== "none" || b.quarrel),
      events: island.events.slice(0, 10),
    },
    focus,
    activity,
    toast,
  };
}
