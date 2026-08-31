import type { RefObject } from "react";
import { MiiAvatar } from "../../mii/MiiAvatar";
import "./island.css";
import { FOODS, INTERIORS, INTERIOR_BY_ID, OUTFITS, SONG_BY_ID } from "./content";
import {
  LOCATIONS,
  MAX_RESIDENTS,
  TYPE_BLURBS,
  dressedMii,
  friendshipLabel,
  headlines,
  isUnlocked,
  nameOf,
  personalityFor,
  relationshipBoard,
  residentById,
  unlockHint,
  type Island,
  type Resident,
} from "./sim";

// The TV half of the island. It is a display and nothing else: the host's
// pointer chooses what it shows, and every actual decision is taken on a
// phone. Rendering lives here on its own so the spectator mirror can draw
// exactly the same island from a snapshot without a second implementation.

export const BOARD_COLS = 6;
export const BOARD_ROWS = 5;
/** The first eighteen cells are apartment doors; the rest are the island. */
export const ROOM_CELLS = MAX_RESIDENTS;

export type Focus = { kind: "none" } | { kind: "resident"; id: string } | { kind: "location"; id: string };

/** Something the island is doing right now that deserves the panel: a song,
 * a wish, a lucky bag. */
export type Activity =
  | { kind: "none" }
  | { kind: "song"; resident: string; song: string; line: number }
  | { kind: "note"; text: string };

export interface IslandSnapshot {
  kind: "island";
  island: Island;
  focus: Focus;
  activity: Activity;
  toast: string | null;
}

const MOOD_ICON: Record<Resident["mood"], string> = {
  happy: "😄",
  sad: "😢",
  angry: "😠",
  love: "💗",
  neutral: "",
};

function Room({ resident, hovered }: { resident: Resident | null; hovered: boolean }) {
  if (!resident) {
    return <div className={`island-room is-empty${hovered ? " is-hovered" : ""}`}><span>vacant</span></div>;
  }
  const interior = INTERIOR_BY_ID.get(resident.interior) ?? INTERIORS[0];
  return (
    <div
      className={`island-room${hovered ? " is-hovered" : ""}`}
      style={{ background: interior.wall, borderBottomColor: interior.floor }}
    >
      <span className="island-room-prop">{interior.prop}</span>
      <div className="island-room-mii">
        <MiiAvatar mii={dressedMii(resident)} size={40} />
      </div>
      <div className="island-room-plate">
        <span className="island-room-name">{resident.mii.name}</span>
        <span className="island-room-level">Lv {resident.level}</span>
      </div>
      <div className="island-room-bar">
        <span style={{ width: `${Math.round(resident.happiness)}%` }} />
      </div>
      <div className="island-room-badges">
        {resident.hunger >= 75 && <span title="hungry">🍽️</span>}
        {resident.boredom >= 85 && <span title="bored">💤</span>}
        {resident.mood !== "neutral" && <span>{MOOD_ICON[resident.mood]}</span>}
      </div>
    </div>
  );
}

function ResidentPanel({ island, resident }: { island: Island; resident: Resident }) {
  const person = personalityFor(resident.mii);
  const bonds = island.bonds
    .filter((b) => b.a === resident.id || b.b === resident.id)
    .sort((x, y) => y.friendship - x.friendship)
    .slice(0, 6);
  const known = Object.entries(resident.discovered).slice(0, 6);

  return (
    <div className="island-panel-body">
      <div className="island-panel-head">
        <MiiAvatar mii={dressedMii(resident)} size={78} />
        <div>
          <h2>{resident.mii.name}</h2>
          <p className="island-panel-sub">
            {person.type} · {person.category} · Level {resident.level}
          </p>
          <p className="island-panel-blurb">{TYPE_BLURBS[person.type]}</p>
          {resident.catchphrase && <p className="island-panel-blurb">“{resident.catchphrase}”</p>}
        </div>
      </div>

      <div className="island-meters">
        <Meter label="Happiness" value={resident.happiness} tone="#3bb54a" />
        <Meter label="Hunger" value={Math.min(100, resident.hunger)} tone="#e07a3b" />
        <Meter label="Boredom" value={Math.min(100, resident.boredom)} tone="#6b8fd6" />
      </div>

      {resident.gifts.length > 0 && (
        <p className="island-panel-line">
          In the room: {resident.gifts.join(", ")}
        </p>
      )}
      {resident.songs.length > 0 && (
        <p className="island-panel-line">
          Knows: {resident.songs.map((s) => SONG_BY_ID.get(s)?.title ?? s).join(", ")}
        </p>
      )}
      <p className="island-panel-line">
        Tastes discovered:{" "}
        {known.length === 0
          ? "none yet"
          : known.map(([food, reaction]) => `${FOODS.find((f) => f.id === food)?.name ?? food} (${reaction})`).join(", ")}
      </p>

      <ul className="island-bond-list">
        {bonds.length === 0 && <li className="island-muted">Hasn't met anybody yet.</li>}
        {bonds.map((bond) => {
          const otherId = bond.a === resident.id ? bond.b : bond.a;
          const label =
            bond.status === "married"
              ? "Married 💍"
              : bond.status === "sweethearts"
                ? "Sweethearts 💗"
                : bond.status === "crush"
                  ? "Has a crush 💭"
                  : friendshipLabel(bond.friendship);
          return (
            <li key={otherId}>
              <span>{nameOf(island, otherId)}</span>
              <span className={bond.quarrel ? "island-bond-bad" : "island-bond-good"}>
                {bond.quarrel ? "Fighting 💢" : label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="island-meter">
      <span className="island-meter-label">{label}</span>
      <div className="island-meter-track">
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
      </div>
    </div>
  );
}

function LocationPanel({ island, id, activity }: { island: Island; id: string; activity: Activity }) {
  const location = LOCATIONS.find((l) => l.id === id);
  if (!location) return null;
  if (!isUnlocked(island, location)) {
    return (
      <div className="island-panel-body">
        <h2>
          {location.icon} {location.name}
        </h2>
        <p className="island-panel-sub">Not open yet.</p>
        <p className="island-panel-line">{unlockHint(island, location)}</p>
      </div>
    );
  }

  const head = (
    <>
      <h2>
        {location.icon} {location.name}
      </h2>
      <p className="island-panel-sub">{location.blurb}</p>
    </>
  );

  if (id === "townhall") {
    return (
      <div className="island-panel-body">
        {head}
        <p className="island-panel-line">
          {island.residents.length} of {MAX_RESIDENTS} apartments occupied. Everyone who joins the room moves in with
          the Mii they picked.
        </p>
        <ul className="island-list">
          {island.residents.map((r) => (
            <li key={r.id}>
              <span>{r.mii.name}</span>
              <span className="island-muted">
                {r.owner === 0 ? "islander" : `Player ${r.owner}`} · {personalityFor(r.mii).type}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (id === "foodmart") {
    return (
      <div className="island-panel-body">
        {head}
        <div className="island-catalogue">
          {FOODS.map((food) => (
            <span key={food.id} className="island-chip">
              {food.icon} {food.name} <b>{(island.pantry[food.id] ?? 0) > 0 ? `×${island.pantry[food.id]}` : `${food.price}c`}</b>
            </span>
          ))}
        </div>
        <p className="island-panel-line island-muted">Buy and feed from your phone.</p>
      </div>
    );
  }

  if (id === "clothing" || id === "interior") {
    const items =
      id === "clothing"
        ? OUTFITS.map((o) => ({ id: o.id, label: o.name, price: o.price, owned: island.wardrobe.includes(o.id), icon: "👕" }))
        : INTERIORS.map((i) => ({ id: i.id, label: i.name, price: i.price, owned: island.interiors.includes(i.id), icon: i.prop }));
    return (
      <div className="island-panel-body">
        {head}
        <div className="island-catalogue">
          {items.map((item) => (
            <span key={item.id} className={`island-chip${item.owned ? " is-owned" : ""}`}>
              {item.icon} {item.label} <b>{item.owned ? "owned" : `${item.price}c`}</b>
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (id === "tower") {
    const rows = relationshipBoard(island).slice(0, 10);
    return (
      <div className="island-panel-body">
        {head}
        <ul className="island-list">
          {rows.length === 0 && <li className="island-muted">Nobody has met anybody yet.</li>}
          {rows.map((row) => (
            <li key={`${row.a.id}-${row.b.id}`}>
              <span>
                {row.a.mii.name} &amp; {row.b.mii.name}
              </span>
              <span className={row.bond.quarrel ? "island-bond-bad" : "island-bond-good"}>
                {row.bond.quarrel
                  ? "Fighting"
                  : row.bond.status === "married"
                    ? "Married"
                    : row.bond.status === "sweethearts"
                      ? "Sweethearts"
                      : friendshipLabel(row.bond.friendship)}{" "}
                · fit {Math.round(row.fit * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (id === "concert") {
    if (activity.kind === "song") {
      const singer = residentById(island, activity.resident);
      const song = SONG_BY_ID.get(activity.song);
      if (singer && song) {
        return (
          <div className="island-panel-body island-stage">
            {head}
            <MiiAvatar mii={dressedMii(singer)} size={110} />
            <h3 className="island-song-title">“{song.title}”</h3>
            <p className="island-song-genre">{song.genre}</p>
            <p className="island-song-line">{song.lines[Math.min(activity.line, song.lines.length - 1)]}</p>
          </div>
        );
      }
    }
    const ready = island.residents.filter((r) => r.songs.length > 0);
    return (
      <div className="island-panel-body">
        {head}
        <p className="island-panel-line">
          {ready.length === 0
            ? "Nobody knows a song yet. Give one as a level-up present."
            : `Ready to sing: ${ready.map((r) => r.mii.name).join(", ")}`}
        </p>
        <p className="island-panel-line island-muted">Press A here to start the show.</p>
      </div>
    );
  }

  if (id === "news") {
    return (
      <div className="island-panel-body">
        {head}
        <ol className="island-news">
          {headlines(island, 6).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>
    );
  }

  if (id === "fountain" || id === "amusement") {
    return (
      <div className="island-panel-body">
        {head}
        <p className="island-panel-line">
          {activity.kind === "note" ? activity.text : id === "fountain" ? "Press A to throw in a coin." : "Press A for a lucky bag (30c)."}
        </p>
      </div>
    );
  }

  // Park, café, beach: somewhere for the island to just be.
  const outAndAbout = [...island.residents].sort((a, b) => b.happiness - a.happiness).slice(0, 6);
  return (
    <div className="island-panel-body">
      {head}
      <div className="island-crowd">
        {outAndAbout.map((r) => (
          <div key={r.id} className="island-crowd-mii">
            <MiiAvatar mii={dressedMii(r)} size={52} />
            <span>{r.mii.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IslandView({
  snapshot,
  hoveredIndex,
  boardRef,
  hint,
}: {
  snapshot: IslandSnapshot;
  /** Which board cell the host is pointing at, if any. */
  hoveredIndex?: number | null;
  /** The pointer grid measures the board through this. */
  boardRef?: RefObject<HTMLDivElement | null>;
  /** Controls line, shown alongside the ticker. */
  hint?: string;
}) {
  const { island, focus, activity, toast } = snapshot;
  const rooms = Array.from({ length: ROOM_CELLS }, (_, i) => island.residents[i] ?? null);
  const focused = focus.kind === "resident" ? residentById(island, focus.id) : undefined;

  return (
    <>
      <header className="island-header">
        <span className="island-title">Mii Island</span>
        <span className="island-stats">
          🪙 {island.coins} · 🏢 {island.residents.length}/{MAX_RESIDENTS} · ✅ {island.problemsSolved} solved
        </span>
        <span className="island-toast">{toast ?? island.events[0]?.text ?? "A quiet day."}</span>
      </header>

      <div className="island-main">
        <div className="island-board" ref={boardRef}>
          {rooms.map((resident, i) => (
            <Room key={i} resident={resident} hovered={hoveredIndex === i} />
          ))}
          {LOCATIONS.map((location, i) => {
            const unlocked = isUnlocked(island, location);
            return (
              <div
                key={location.id}
                className={`island-place${unlocked ? "" : " is-locked"}${hoveredIndex === ROOM_CELLS + i ? " is-hovered" : ""}`}
              >
                <span className="island-place-icon">{location.icon}</span>
                <span className="island-place-name">{location.name}</span>
                {!unlocked && <span className="island-place-lock">{unlockHint(island, location)}</span>}
              </div>
            );
          })}
        </div>

        <aside className="island-panel">
          {focused ? (
            <ResidentPanel island={island} resident={focused} />
          ) : focus.kind === "location" ? (
            <LocationPanel island={island} id={focus.id} activity={activity} />
          ) : (
            <div className="island-panel-body">
              <h2>Welcome to the island</h2>
              <p className="island-panel-sub">Point at a door to look in on someone, or at a building to visit it.</p>
              <ul className="island-feed">
                {island.events.slice(0, 8).map((event) => (
                  <li key={event.id} className={`island-feed-${event.kind}`}>
                    {event.text}
                  </li>
                ))}
                {island.events.length === 0 && <li className="island-muted">Nothing has happened yet.</li>}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <div className="island-ticker">
        <span className="island-ticker-text">
        {island.requests.length > 0
          ? `${island.requests.length} Mii${island.requests.length === 1 ? "" : "s"} waiting on someone's phone: ${island.requests
              .slice(0, 3)
              .map((r) => r.text)
              .join("  ·  ")}`
          : "Everyone is content. For now."}
        </span>
        {hint && <span className="island-hint">{hint}</span>}
      </div>
    </>
  );
}

/**
 * The watch-screen island. The host publishes the whole thing, so a mirror
 * is the same view with nobody's pointer on it.
 */
export function IslandMirror({ snapshot }: { snapshot: IslandSnapshot }) {
  return (
    <div className="island-root">
      <IslandView snapshot={snapshot} hint="Watching — the residents are looked after from the players' phones" />
    </div>
  );
}
