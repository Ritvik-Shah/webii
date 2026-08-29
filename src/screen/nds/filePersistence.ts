// Persists FileSystemFileHandle objects (from the File System Access API,
// Chrome/Edge only) in IndexedDB so a player only has to browse to a file
// once -- on later visits we can re-open the same handle instead of making
// them pick it again. Handles survive a reload; the *permission* to read
// them does not (a browser security limit, not something we can work
// around), so callers still need to re-request permission each session --
// but that's a single quick prompt, not a full re-browse.

const DB_NAME = "webii-fs-handles";
const STORE = "handles";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeHandle(key: string, handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadHandle(key: string): Promise<FileSystemFileHandle | null> {
  const db = await openDb();
  const result = await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as FileSystemFileHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export const supportsFileSystemAccess = typeof window !== "undefined" && "showOpenFilePicker" in window;

/**
 * Picks a file with File System Access API persistence when available
 * (remembers the handle for next time, only asking the browser to
 * re-confirm permission rather than making the player re-browse), falling
 * back to a plain one-shot <input type="file"> picker otherwise.
 */
export async function pickPersistentFile(storageKey: string, accept: string[]): Promise<File | null> {
  if (supportsFileSystemAccess) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        types: [{ description: "ROM/BIOS file", accept: { "application/octet-stream": accept } }],
      });
      await storeHandle(storageKey, handle);
      return await handle.getFile();
    } catch {
      return null; // user cancelled the picker
    }
  }
  return pickFileFallback(accept);
}

/** Tries to silently re-open a previously-picked file without prompting a
 * browse dialog -- only re-prompts for permission (one click) if needed.
 * Returns null if there's no remembered handle or permission is denied. */
export async function reopenPersistentFile(storageKey: string): Promise<File | null> {
  if (!supportsFileSystemAccess) return null;
  const handle = await loadHandle(storageKey).catch(() => null);
  if (!handle) return null;
  try {
    let permission = await handle.queryPermission({ mode: "read" });
    if (permission !== "granted") {
      permission = await handle.requestPermission({ mode: "read" });
    }
    if (permission !== "granted") return null;
    return await handle.getFile();
  } catch {
    return null;
  }
}

function pickFileFallback(accept: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
