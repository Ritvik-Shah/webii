import { useEffect } from "react";

// Keeping the screen awake.
//
// Every page in this app is something you look at without touching: a TV
// showing a game, a mirror in another room, a phone sitting in someone's hand
// between turns. Browsers treat all of that as idle and dim or sleep the
// display, which is exactly wrong here -- so each of them holds a screen wake
// lock for as long as it is open.

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

/**
 * Holds a screen wake lock while `active`. Unsupported browsers and refused
 * requests are ignored: the page still works, the display just dims as it
 * normally would.
 */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    async function acquire() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = await api!.request("screen");
        // The browser drops the lock whenever the page is hidden, so note
        // that it is gone rather than holding a stale handle.
        sentinel.addEventListener("release", () => {
          sentinel = null;
        });
      } catch {
        // Refused (often because the page is not visible, or not served over
        // https). Nothing to do -- the next visibility change retries.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible" && sentinel === null) void acquire();
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
