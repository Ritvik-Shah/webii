import { SAVE_VERSION, createIsland, type Island } from "./sim";

const STORAGE_KEY = "webii-island";

// An island with no end condition is only worth anything if it is still
// there tomorrow, so it saves to this browser the same way the Mii Channel
// roster and the emulator save states do.

export function loadIsland(): Island {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createIsland();
    const parsed = JSON.parse(raw) as Island;
    // An older save is not worth migrating field by field for a toy island;
    // it starts again rather than loading into a half-shaped state.
    if (!parsed || parsed.version !== SAVE_VERSION || !Array.isArray(parsed.residents)) return createIsland();
    return parsed;
  } catch {
    return createIsland();
  }
}

export function saveIsland(island: Island) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(island));
  } catch {
    // Storage full or unavailable -- the island still runs, it just won't
    // be here next time.
  }
}

export function clearIsland() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
