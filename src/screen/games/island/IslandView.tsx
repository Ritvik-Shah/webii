import type { RefObject } from "react";
import { MiiAvatar } from "../../mii/MiiAvatar";
import "./island.css";
import { FOODS, INTERIORS, OUTFITS, SONG_BY_ID } from "./content";
import {
  BUILDING_BY_ID,
  BUILDING_BY_PLOT,
  GRASS,
  MAX_BUILDING_LEVEL,
  PLOTS,
  RING,
  SAND,
  upgradeCost,
} from "./map";
import {
  TYPE_BLURBS,
  blockedBecause,
  capacity,
  dressedMii,
  friendshipLabel,
  headlines,
  islandLevel,
  levelOf,
  nameOf,
  nextGoal,
  personalityFor,
  relationshipBoard,
  residentById,
  type Island,
  type Resident,
} from "./sim";

// The island, drawn.
//
// It is all ordinary DOM: an SVG for the land and the roads, a div per
// building, and a div per Mii carrying the same avatar the rest of the app
// uses. That is deliberate -- the spectator mirror renders this exact
// component from a snapshot, so there is one island and not two, and the
// Miis are the same Miis, not sprites of them.
//
// Everything is positioned in the map's own 0-100 space, as percentages, so
// the whole town scales to whatever screen it lands on.

export type Focus =
  | { kind: "none" }
  | { kind: "building"; id: string }
  | { kind: "plot"; id: string }
  | { kind: "resident"; id: string };

/** Something the island is doing right now that deserves the panel. */
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

// ---------------------------------------------------------------------------
// The land
// ---------------------------------------------------------------------------

/** The ring road, plus a spoke out to each plot that has something on it. */
function Roads({ island }: { island: Island }) {
  const spokes = PLOTS.filter((plot) => {
    const type = BUILDING_BY_PLOT.get(plot.id);
    return type && levelOf(island, type.id) > 0;
  }).map((plot) => {
    // Meet the ring at the angle the plot sits at, so the roads fan out.
    const angle = Math.atan2((plot.doorY - RING.cy) / RING.ry, (plot.x - RING.cx) / RING.rx);
    return {
      id: plot.id,
      x1: plot.x,
      y1: plot.doorY,
      x2: RING.cx + Math.cos(angle) * RING.rx,
      y2: RING.cy + Math.sin(angle) * RING.ry,
    };
  });

  return (
    <g className="island-roads">
      <ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} />
      {spokes.map((spoke) => (
        <line key={spoke.id} x1={spoke.x1} y1={spoke.y1} x2={spoke.x2} y2={spoke.y2} />
      ))}
    </g>
  );
}

function Terrain({ island }: { island: Island }) {
  return (
    <svg className="island-terrain" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="island-sea" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="#7fc6e8" />
          <stop offset="100%" stopColor="#3d86b8" />
        </radialGradient>
        <radialGradient id="island-grass" cx="45%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#a7d97a" />
          <stop offset="100%" stopColor="#6fae52" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="100" height="100" fill="url(#island-sea)" />
      {/* Surf: two rings that breathe, so the sea isn't a flat colour. */}
      <ellipse className="island-surf island-surf-1" cx={SAND.cx} cy={SAND.cy} rx={SAND.rx + 4} ry={SAND.ry + 3.5} />
      <ellipse className="island-surf island-surf-2" cx={SAND.cx} cy={SAND.cy} rx={SAND.rx + 2} ry={SAND.ry + 1.8} />
      <ellipse cx={SAND.cx} cy={SAND.cy} rx={SAND.rx} ry={SAND.ry} fill="#f2e0b6" />
      <ellipse cx={GRASS.cx} cy={GRASS.cy} rx={GRASS.rx} ry={GRASS.ry} fill="url(#island-grass)" />
      <Roads island={island} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function Building({
  plotId,
  island,
  selected,
  hovered,
}: {
  plotId: string;
  island: Island;
  selected: boolean;
  hovered: boolean;
}) {
  const plot = PLOTS.find((p) => p.id === plotId)!;
  const type = BUILDING_BY_PLOT.get(plotId);
  if (!type) return null;
  const level = levelOf(island, type.id);

  if (level === 0) {
    const blocked = blockedBecause(island, type);
    return (
      <div
        className={`island-plot${hovered ? " is-hovered" : ""}${selected ? " is-selected" : ""}${
          blocked ? " is-blocked" : " is-ready"
        }`}
        data-plot={plot.id}
        style={{ left: `${plot.x}%`, top: `${plot.y}%`, zIndex: Math.round(plot.y * 10) }}
      >
        <span className="island-plot-mark">+</span>
        <span className="island-plot-name">{type.name}</span>
        <span className="island-plot-cost">{blocked ?? `${type.cost} coins`}</span>
      </div>
    );
  }

  // A building grows a storey at a time, so its level is legible from the
  // sofa without reading anything.
  const height = (type.height ?? 60) * (0.72 + 0.22 * level);
  return (
    <div
      className={`island-building${hovered ? " is-hovered" : ""}${selected ? " is-selected" : ""}`}
      data-plot={plot.id}
      style={{
        left: `${plot.x}%`,
        top: `${plot.y}%`,
        zIndex: Math.round(plot.y * 10),
        ["--wall" as string]: type.wall,
        ["--roof" as string]: type.roof,
        ["--h" as string]: `${height}px`,
      }}
    >
      <div className="ib-roof" />
      <div className="ib-body">
        <div className="ib-windows">
          {Array.from({ length: level * 2 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="ib-door" />
      </div>
      <div className="ib-sign">
        <span className="ib-icon">{type.icon}</span>
        <span className="ib-name">{type.name}</span>
        <span className="ib-level">{"★".repeat(level)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Miis
// ---------------------------------------------------------------------------

function Walkers({ island, focus, hovered }: { island: Island; focus: Focus; hovered: string | null }) {
  return (
    <>
      {island.residents.map((resident) => {
        const walker = island.walkers[resident.id];
        if (!walker) return null;
        const selected = focus.kind === "resident" && focus.id === resident.id;
        const wants = resident.hunger >= 75 ? "🍽️" : resident.boredom >= 85 ? "💤" : MOOD_ICON[resident.mood];
        return (
          <div
            key={resident.id}
            className={`island-walker${walker.state === "walk" ? " is-walking" : ""}${selected ? " is-selected" : ""}${
              hovered === resident.id ? " is-hovered" : ""
            }`}
            data-walker={resident.id}
            style={{ left: `${walker.x}%`, top: `${walker.y}%`, zIndex: Math.round(walker.y * 10) + 5 }}
          >
            <span className="iw-shadow" />
            <span className="iw-figure" style={{ transform: `scaleX(${walker.facing})` }}>
              <MiiAvatar mii={dressedMii(resident)} size={38} />
            </span>
            <span className="iw-name">{resident.mii.name}</span>
            {wants && <span className="iw-bubble">{wants}</span>}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

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

function ResidentPanel({ island, resident }: { island: Island; resident: Resident }) {
  const person = personalityFor(resident.mii);
  const walker = island.walkers[resident.id];
  const where = walker?.at ? BUILDING_BY_ID.get(walker.at)?.name : null;
  const bonds = island.bonds
    .filter((b) => b.a === resident.id || b.b === resident.id)
    .sort((x, y) => y.friendship - x.friendship)
    .slice(0, 5);

  return (
    <>
      <div className="island-panel-head">
        <MiiAvatar mii={dressedMii(resident)} size={64} />
        <div>
          <h2>{resident.mii.name}</h2>
          <p className="island-panel-sub">
            {person.type} · Level {resident.level}
          </p>
          <p className="island-panel-blurb">{TYPE_BLURBS[person.type]}</p>
        </div>
      </div>
      <p className="island-panel-line island-muted">
        {walker?.state === "walk" ? "On their way somewhere" : where ? `At the ${where}` : "Out for a wander"}
      </p>
      <div className="island-meters">
        <Meter label="Happiness" value={resident.happiness} tone="#3bb54a" />
        <Meter label="Hunger" value={Math.min(100, resident.hunger)} tone="#e07a3b" />
        <Meter label="Boredom" value={Math.min(100, resident.boredom)} tone="#6b8fd6" />
      </div>
      {resident.catchphrase && <p className="island-panel-line">“{resident.catchphrase}”</p>}
      <ul className="island-list">
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
    </>
  );
}

function BuildingPanel({ island, id, activity }: { island: Island; id: string; activity: Activity }) {
  const type = BUILDING_BY_ID.get(id);
  if (!type) return null;
  const level = levelOf(island, id);
  const here = island.residents.filter((r) => island.walkers[r.id]?.at === id);

  const head = (
    <>
      <h2>
        {type.icon} {type.name}
      </h2>
      <p className="island-panel-sub">
        Level {level} of {MAX_BUILDING_LEVEL}
        {level < MAX_BUILDING_LEVEL ? ` · press 1 to grow it for ${upgradeCost(type, level)} coins` : " · fully grown"}
      </p>
      <p className="island-panel-blurb">{type.blurb}</p>
    </>
  );

  const visitors = here.length > 0 && (
    <div className="island-crowd">
      {here.slice(0, 8).map((r) => (
        <div key={r.id} className="island-crowd-mii">
          <MiiAvatar mii={dressedMii(r)} size={40} />
          <span>{r.mii.name}</span>
        </div>
      ))}
    </div>
  );

  if (id === "apartments") {
    return (
      <>
        {head}
        <p className="island-panel-line">
          {island.residents.length} of {capacity(island)} rooms taken.
        </p>
        <ul className="island-list">
          {island.residents.map((r) => (
            <li key={r.id}>
              <span>{r.mii.name}</span>
              <span className="island-muted">
                {r.owner === 0 ? "islander" : `P${r.owner}`} · Lv {r.level}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (id === "townhall") {
    return (
      <>
        {head}
        <p className="island-panel-line">
          Island level <b>{islandLevel(island)}</b> · {island.problemsSolved} problems solved
        </p>
        <p className="island-panel-line island-muted">{nextGoal(island)}</p>
        <ul className="island-list">
          {[...BUILDING_BY_ID.values()].map((b) => (
            <li key={b.id}>
              <span>
                {b.icon} {b.name}
              </span>
              <span className="island-muted">
                {levelOf(island, b.id) > 0
                  ? "★".repeat(levelOf(island, b.id))
                  : (blockedBecause(island, b) ?? `${b.cost}c`)}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (id === "foodmart") {
    return (
      <>
        {head}
        <div className="island-catalogue">
          {FOODS.slice(0, 14).map((food) => (
            <span key={food.id} className="island-chip">
              {food.icon} {food.name}
            </span>
          ))}
        </div>
        <p className="island-panel-line island-muted">Buy and feed from your phone.</p>
        {visitors}
      </>
    );
  }

  if (id === "clothing" || id === "interior") {
    const items =
      id === "clothing"
        ? OUTFITS.map((o) => ({ id: o.id, label: o.name, owned: island.wardrobe.includes(o.id) }))
        : INTERIORS.map((i) => ({ id: i.id, label: i.name, owned: island.interiors.includes(i.id) }));
    return (
      <>
        {head}
        <div className="island-catalogue">
          {items.map((item) => (
            <span key={item.id} className={`island-chip${item.owned ? " is-owned" : ""}`}>
              {item.label}
            </span>
          ))}
        </div>
        {visitors}
      </>
    );
  }

  if (id === "tower") {
    const rows = relationshipBoard(island).slice(0, 8);
    return (
      <>
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
                      : friendshipLabel(row.bond.friendship)}
              </span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  if (id === "concert") {
    if (activity.kind === "song") {
      const singer = residentById(island, activity.resident);
      const song = SONG_BY_ID.get(activity.song);
      if (singer && song) {
        return (
          <div className="island-stage-card">
            {head}
            <MiiAvatar mii={dressedMii(singer)} size={92} />
            <h3 className="island-song-title">“{song.title}”</h3>
            <p className="island-song-genre">{song.genre}</p>
            <p className="island-song-line">{song.lines[Math.min(activity.line, song.lines.length - 1)]}</p>
          </div>
        );
      }
    }
    const ready = island.residents.filter((r) => r.songs.length > 0);
    return (
      <>
        {head}
        <p className="island-panel-line">
          {ready.length === 0
            ? "Nobody knows a song yet. Give one as a level-up present."
            : `Ready to sing: ${ready.map((r) => r.mii.name).join(", ")}`}
        </p>
        <p className="island-panel-line island-muted">Press A here to start the show.</p>
      </>
    );
  }

  if (id === "news") {
    return (
      <>
        {head}
        <ol className="island-news">
          {headlines(island, 6).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </>
    );
  }

  if (id === "fountain" || id === "amusement") {
    return (
      <>
        {head}
        <p className="island-panel-line">
          {activity.kind === "note"
            ? activity.text
            : id === "fountain"
              ? "Press A to throw in a coin."
              : "Press A for a lucky bag (30c)."}
        </p>
        {visitors}
      </>
    );
  }

  return (
    <>
      {head}
      {visitors || <p className="island-panel-line island-muted">Nobody is here at the moment.</p>}
    </>
  );
}

function PlotPanel({ island, plotId }: { island: Island; plotId: string }) {
  const type = BUILDING_BY_PLOT.get(plotId);
  if (!type) return null;
  const blocked = blockedBecause(island, type);
  return (
    <>
      <h2>
        {type.icon} {type.name}
      </h2>
      <p className="island-panel-sub">Empty plot</p>
      <p className="island-panel-blurb">{type.blurb}</p>
      <p className="island-panel-line">{blocked ? blocked : `Press A to build it for ${type.cost} coins.`}</p>
      <p className="island-panel-line island-muted">You have {island.coins} coins.</p>
    </>
  );
}

// ---------------------------------------------------------------------------

export function IslandView({
  snapshot,
  stageRef,
  hoveredBuilding,
  hoveredResident,
  hint,
}: {
  snapshot: IslandSnapshot;
  /** The host measures pointer hits against this. */
  stageRef?: RefObject<HTMLDivElement | null>;
  hoveredBuilding?: string | null;
  hoveredResident?: string | null;
  hint?: string;
}) {
  const { island, focus, activity, toast } = snapshot;
  const focused = focus.kind === "resident" ? residentById(island, focus.id) : undefined;

  return (
    <>
      <header className="island-header">
        <span className="island-title">Mii Island</span>
        <span className="island-stats">
          🪙 {island.coins} · 🏠 {island.residents.length}/{capacity(island)} · 🏙️ Island level {islandLevel(island)}
        </span>
        <span className="island-goal">{toast ?? nextGoal(island)}</span>
      </header>

      <div className="island-stage">
        {/* The map is kept clear of the panel rather than running under it:
            two plots were spending the whole game hidden behind a card. */}
        <div className="island-map" ref={stageRef}>
          <Terrain island={island} />
          {PLOTS.map((plot) => {
          const type = BUILDING_BY_PLOT.get(plot.id);
          return (
            <Building
              key={plot.id}
              plotId={plot.id}
              island={island}
              hovered={hoveredBuilding === plot.id}
              selected={
                (focus.kind === "plot" && focus.id === plot.id) ||
                (focus.kind === "building" && !!type && focus.id === type.id)
              }
            />
          );
        })}
          <Walkers island={island} focus={focus} hovered={hoveredResident ?? null} />
        </div>

        <aside className={`island-panel${focus.kind === "none" ? " is-quiet" : ""}`}>
          {focused ? (
            <ResidentPanel island={island} resident={focused} />
          ) : focus.kind === "building" ? (
            <BuildingPanel island={island} id={focus.id} activity={activity} />
          ) : focus.kind === "plot" ? (
            <PlotPanel island={island} plotId={focus.id} />
          ) : (
            <>
              <h2>Your island</h2>
              <p className="island-panel-blurb">Point at a Mii or a building. Everything else is on your phone.</p>
              <ul className="island-feed">
                {island.events.slice(0, 7).map((event) => (
                  <li key={event.id} className={`island-feed-${event.kind}`}>
                    {event.text}
                  </li>
                ))}
                {island.events.length === 0 && <li className="island-muted">Nothing has happened yet.</li>}
              </ul>
            </>
          )}
        </aside>
      </div>

      <div className="island-ticker">
        <span className="island-ticker-text">
          {island.requests.length > 0
            ? `${island.requests.length} waiting on a phone: ${island.requests
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
      <IslandView snapshot={snapshot} hint="Watching — the Miis are looked after from the players' phones" />
    </div>
  );
}
