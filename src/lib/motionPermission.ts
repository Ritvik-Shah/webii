export type MotionPermissionResult = "granted" | "denied" | "unnecessary";

interface RequestableEventCtor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** Must be called from inside a tap/click handler -- iOS Safari only grants
 * sensor access when the request originates from a user gesture. */
export async function requestMotionPermission(): Promise<MotionPermissionResult> {
  const motionCtor = window.DeviceMotionEvent as unknown as RequestableEventCtor;
  const orientationCtor = window.DeviceOrientationEvent as unknown as RequestableEventCtor;

  const needsMotion = typeof motionCtor?.requestPermission === "function";
  const needsOrientation = typeof orientationCtor?.requestPermission === "function";

  if (!needsMotion && !needsOrientation) return "unnecessary";

  try {
    const results = await Promise.all([
      needsMotion ? motionCtor.requestPermission!() : Promise.resolve("granted" as const),
      needsOrientation ? orientationCtor.requestPermission!() : Promise.resolve("granted" as const),
    ]);
    return results.every((r) => r === "granted") ? "granted" : "denied";
  } catch {
    return "denied";
  }
}
