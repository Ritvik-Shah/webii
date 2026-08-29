import { useState } from "react";
import { requestMotionPermission } from "../lib/motionPermission";

interface PermissionGateProps {
  onGranted: () => void;
}

export default function PermissionGate({ onGranted }: PermissionGateProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleTap() {
    const result = await requestMotionPermission();
    if (result === "granted" || result === "unnecessary") {
      onGranted();
      return;
    }
    setError("Motion access was denied. Enable it in your browser's site settings and reload.");
  }

  return (
    <div className="permission-gate">
      <h1>Webii Remote</h1>
      <p>This turns your phone into a motion controller.</p>
      <button className="permission-button" onClick={handleTap}>
        Tap to enable motion
      </button>
      {error && <p className="permission-error">{error}</p>}
    </div>
  );
}
