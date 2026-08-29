import type { Mii } from "./Mii";

const STORAGE_KEY = "webii-custom-miis";

/** All Miis the player has created in the Mii Channel, newest first. Plain
 * localStorage (small JSON, no need for IndexedDB) -- persists across
 * sessions on this browser, same spirit as the NES/DS Channels' save
 * states. */
export function loadCustomMiis(): Mii[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Mii[]) : [];
  } catch {
    return [];
  }
}

function writeCustomMiis(miis: Mii[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(miis));
  } catch {
    // Storage full/unavailable -- not fatal, the Mii just won't persist.
  }
}

/** Saves (or updates, if a Mii with this id already exists) one Mii into
 * the roster, keeping newest-edited first. */
export function saveCustomMii(mii: Mii): Mii[] {
  const existing = loadCustomMiis().filter((m) => m.id !== mii.id);
  const next = [mii, ...existing];
  writeCustomMiis(next);
  return next;
}

export function deleteCustomMii(id: string): Mii[] {
  const next = loadCustomMiis().filter((m) => m.id !== id);
  writeCustomMiis(next);
  return next;
}
