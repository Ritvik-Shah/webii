import type { CSSProperties } from "react";
import type { Mii } from "./Mii";
import "./mii-avatar.css";

// "idle": arms resting. "bowl-swing": right arm plays a one-shot swing-back-
// then-forward animation (retrigger by remounting, e.g. via a `key` prop, so
// it can fire again on the next roll). "sword-ready": right arm raised into
// a fixed holding position, meant to be paired with a game's own live blade
// element positioned near the hand.
export type MiiPose = "idle" | "bowl-swing" | "sword-ready" | "tennis-swing";

interface MiiAvatarProps {
  mii: Mii;
  /** Full avatar bounding-box width in px; height follows proportionally. */
  size?: number;
  pose?: MiiPose;
  className?: string;
}

export function MiiAvatar({ mii, size = 120, pose = "idle", className }: MiiAvatarProps) {
  const style = {
    "--mii-size": `${size}px`,
    "--mii-skin": mii.skinTone,
    "--mii-hair": mii.hairColor,
    "--mii-shirt": mii.shirtColor,
    "--mii-eye-color": mii.eyeColor,
    "--mii-hat-color": mii.hatColor,
  } as CSSProperties;

  return (
    <div
      className={`mii-avatar mii-pose-${pose} mii-build-${mii.build} mii-height-${mii.height} ${className ?? ""}`}
      style={style}
    >
      <div className="mii-arm mii-arm-left" />
      <div className="mii-arm mii-arm-right" />
      <div className={`mii-body mii-shirt-${mii.shirtStyle}`} />
      <div className={`mii-head mii-face-${mii.faceShape}`}>
        <div className={`mii-hair mii-hair-${mii.hairStyle}`} />
        <div className={`mii-eyebrows mii-eyebrows-${mii.eyebrowStyle}`}>
          <span className="mii-eyebrow mii-eyebrow-left" />
          <span className="mii-eyebrow mii-eyebrow-right" />
        </div>
        <div className={`mii-eyes mii-eyes-${mii.eyeStyle}`}>
          <span className="mii-eye mii-eye-left" />
          <span className="mii-eye mii-eye-right" />
        </div>
        <span className={`mii-nose mii-nose-${mii.noseStyle}`} />
        <span className={`mii-mouth mii-mouth-${mii.mouthStyle}`} />
        <span className={`mii-facial-hair mii-facial-hair-${mii.facialHair}`} />
        <span className={`mii-glasses mii-glasses-${mii.glassesStyle}`} />
        <div className={`mii-hat mii-hat-${mii.hatStyle}`} />
      </div>
      <div className="mii-legs" />
    </div>
  );
}
