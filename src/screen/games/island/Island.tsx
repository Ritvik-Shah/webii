import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ControllerMessage } from "../../../../shared/protocol";
import { Cursor } from "../../Cursor";
import { usePointerPosition } from "../../usePointerGrid";
import { MII_ROSTER } from "../../mii/Mii";
import type { GameProps } from "../types";
import { SONGS } from "./content";
import { BUILDING_BY_PLOT } from "./map";
import { IslandView, type Activity, type Focus, type IslandSnapshot } from "./IslandView";
import { ROOT, applyPhoneAction, phoneViewFor, type Nav } from "./phone";
import { loadIsland, saveIsland } from "./storage";
import { stepWalkers, syncWalkers } from "./walk";
import {
  FOODS,
  OUTFITS,
  addResident,
  build,
  isBuilt,
  logEvent,
  makeWish,
  meet,
  residentById,
  soloBeat,
  tickNeeds,
  upgrade,
  type Island as IslandState,
} from "./sim";

// Mii Island: our Tomodachi Life.
//
// The split is the one the 3DS had, and it maps onto this room unusually
// well. The TV is the top screen -- the island itself, the Miis walking
// around it, the town you are building -- and each phone is the bottom
// screen, where you look after your own Miis and answer the things they
// ask. Nobody controls a Mii; you feed them, dress them, put up the shops
// they walk to, and then find out what they decided about each other.
//
// Everything that decides anything lives in sim.ts, walk.ts and phone.ts,
// which have no React in them and can be stepped outside a browser.

/** The simulation runs at this rate, and so do the walkers -- fast enough
 * that walking looks like walking; the CSS transition carries the rest. */
const TICK_HZ = 8;
const TICK_MS = 1000 / TICK_HZ;
/** Somebody potters about on their own roughly this often, so the island
 * still has something to say when everyone is spread out. */
const SOLO_EVERY = 22 * TICK_HZ;
const SAVE_EVERY = 10 * TICK_HZ;
/** Full island snapshots are fat (every Mii, every bond); walker positions
 * are tiny. So a mirror gets the island once a second and the movement at
 * the full rate. */
const FULL_SNAPSHOT_EVERY = TICK_HZ;
const TOAST_MS = 6000;
const SONG_LINE_MS = 2600;
const LUCKY_BAG_COST = 30;

export function Island({ send, subscribe, players, publish, spectators }: GameProps) {
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
  const [hover, setHover] = useState<{ plot: string | null; resident: string | null }>({
    plot: null,
    resident: null,
  });

  const sendRef = useRef(send);
  sendRef.current = send;
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const spectatorsRef = useRef(spectators);
  spectatorsRef.current = spectators;
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
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  const lastSent = useRef(new Map<number, string>());
  const toastTimer = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);

  const hostPlayer = players[0]?.player;
  const pointer = usePointerPosition(subscribe, hostPlayer);

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
    // A single Mii alone on an island has nobody to fall out with, so the
    // island keeps a few neighbours of its own.
    for (const mii of MII_ROSTER) {
      if (island.residents.length >= 4) break;
      addResident(island, mii, 0);
    }
    syncWalkers(island);
    bump();
  }, [players]);

  // -----------------------------------------------------------------------
  // The clock: needs, walking, and who bumped into whom
  // -----------------------------------------------------------------------
  useEffect(() => {
    let ticks = 0;
    const timer = window.setInterval(() => {
      const island = islandRef.current!;
      ticks += 1;
      tickNeeds(island, 1 / TICK_HZ);

      for (const meeting of stepWalkers(island, 1 / TICK_HZ)) {
        meet(island, meeting.a, meeting.b);
      }
      if (ticks % SOLO_EVERY === 0) soloBeat(island);
      if (ticks % SAVE_EVERY === 0) saveIsland(island);

      if (spectatorsRef.current > 0) {
        if (ticks % FULL_SNAPSHOT_EVERY === 0) {
          publishRef.current(snapshotOf(island, focusRef.current, activityRef.current, toastRef.current));
        } else {
          // Just the movement, which is a few hundred bytes rather than
          // sixteen kilobytes.
          sendRef.current({
            type: "snapshot",
            view: "game:island-walk",
            state: { walkers: island.walkers, focus: focusRef.current, toast: toastRef.current },
          });
        }
      }
      bump();
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      saveIsland(islandRef.current!);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Pointing at things
  //
  // Hit-testing goes through the rendered page rather than the map's own
  // coordinates: the Miis move, the buildings are all different sizes, and
  // asking the browser what is under the pointer is both simpler and always
  // agrees with what is actually on the screen.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!stageRef.current) return;
      const px = (pointer.current.x / 100) * window.innerWidth;
      const py = (pointer.current.y / 100) * window.innerHeight;
      const el = cursorRef.current;
      if (el) {
        el.style.left = `${pointer.current.x}%`;
        el.style.top = `${pointer.current.y}%`;
      }

      const under = document.elementFromPoint(px, py);
      const walker = under?.closest?.("[data-walker]")?.getAttribute("data-walker") ?? null;
      const plot = under?.closest?.("[data-plot]")?.getAttribute("data-plot") ?? null;
      const current = hoverRef.current;
      if (current.plot !== plot || current.resident !== walker) setHover({ plot, resident: walker });
    }, 100);
    return () => window.clearInterval(timer);
  }, [pointer]);

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
      // the phones already have their menus and sends nothing.
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
        if (outcome.result.ok && outcome.result.resident) {
          setFocus({ kind: "resident", id: outcome.result.resident });
        }
        if (outcome.result.ok && outcome.result.building) {
          setFocus({ kind: "building", id: outcome.result.building });
        }
      }
      bump();
    },
    [say],
  );

  // -----------------------------------------------------------------------
  // The host's remote
  // -----------------------------------------------------------------------
  const visit = useCallback(
    (buildingId: string) => {
      const island = islandRef.current!;
      if (!isBuilt(island, buildingId)) return;

      if (buildingId === "fountain") {
        const text = makeWish(island);
        setActivity({ kind: "note", text });
        say(text);
        return;
      }

      if (buildingId === "amusement") {
        if (island.coins < LUCKY_BAG_COST) {
          say("Not enough coins for a lucky bag.");
          return;
        }
        island.coins -= LUCKY_BAG_COST;
        let text: string;
        if (Math.random() < 0.5) {
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
        return;
      }

      if (buildingId === "concert") {
        const ready = island.residents.filter((r) => r.songs.length > 0);
        if (ready.length === 0) {
          say("Nobody knows a song yet — give one as a level-up present.");
          return;
        }
        const singer = ready[Math.floor(Math.random() * ready.length)];
        const songId = singer.songs[Math.floor(Math.random() * singer.songs.length)];
        setActivity({ kind: "song", resident: singer.id, song: songId, line: 0 });
        say(`${singer.mii.name} takes the stage: “${SONGS.find((s) => s.id === songId)?.title ?? "a song"}”`);
        return;
      }

      setActivity({ kind: "none" });
    },
    [say],
  );

  const press = useCallback(
    (button: string) => {
      const island = islandRef.current!;
      const { plot, resident } = hoverRef.current;

      if (button === "A") {
        if (resident) {
          setFocus({ kind: "resident", id: resident });
          setActivity({ kind: "none" });
          bump();
          return;
        }
        if (!plot) return;
        const type = BUILDING_BY_PLOT.get(plot);
        if (!type) return;
        if (!isBuilt(island, type.id)) {
          const result = build(island, type.id);
          say(result.message);
          setFocus({ kind: "plot", id: plot });
          bump();
          return;
        }
        setFocus({ kind: "building", id: type.id });
        visit(type.id);
        bump();
        return;
      }

      if (button === "ONE") {
        // Growing the town: 1 upgrades whatever is under the pointer, or
        // whatever is selected if the pointer has wandered off into the sea.
        const target =
          (plot ? BUILDING_BY_PLOT.get(plot)?.id : undefined) ??
          (focusRef.current.kind === "building" ? focusRef.current.id : null);
        if (!target) return;
        const result = upgrade(island, target);
        say(result.message);
        if (result.ok) setFocus({ kind: "building", id: target });
        bump();
      }
    },
    [say, visit],
  );

  useEffect(() => {
    return subscribe((msg: ControllerMessage, player: number) => {
      if (msg.type === "action") {
        handleAction(player, msg.id);
        return;
      }
      if (msg.type === "button" && msg.state === "down" && player === playersRef.current[0]?.player) {
        press(msg.button);
      }
    });
  }, [subscribe, handleAction, press]);

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

  const island = islandRef.current!;
  const snapshot: IslandSnapshot = { kind: "island", island, focus, activity, toast };
  const hoveredType = hover.plot ? BUILDING_BY_PLOT.get(hover.plot) : undefined;

  return (
    <div className="island-root">
      <IslandView
        snapshot={snapshot}
        stageRef={stageRef}
        hoveredBuilding={hover.plot}
        hoveredResident={hover.resident}
        hint={
          hover.resident
            ? "A to look in on them"
            : hoveredType
              ? isBuilt(island, hoveredType.id)
                ? `A to visit the ${hoveredType.name} · 1 to grow it`
                : `A to build the ${hoveredType.name}`
              : `Player ${hostPlayer ?? 1}: point and press A · the rest is on your phone`
        }
      />
      <Cursor ref={cursorRef} />
    </div>
  );
}

/**
 * A slimmed island for the watch screen. Bonds nobody has formed yet are the
 * bulk of the state once the island fills up, and they say nothing, so they
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
