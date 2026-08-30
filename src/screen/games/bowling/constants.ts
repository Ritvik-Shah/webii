// Real bowling-alley dimensions, in metres, so the 3D scene reads at the
// right scale without hand-tuned magic numbers. The lane runs along -Z:
// the bowler stands near z = 0 (the foul line) facing the pins at z = -18.29,
// and the camera sits behind them at positive z. With the camera looking
// down -Z in three.js's default orientation that makes world +X screen-right,
// which keeps every "move left / hook right" sign in this game intuitive.

/** Distance from the foul line to the head pin. */
export const LANE_LENGTH = 18.29;
/** Half of the 1.0566 m regulation lane width. */
export const LANE_HALF_WIDTH = 0.5283;
/** Each gutter, one per side of the lane. */
export const GUTTER_WIDTH = 0.2365;
export const GUTTER_DEPTH = 0.06;
/** The approach the bowler walks up, behind the foul line (z > 0). */
export const APPROACH_LENGTH = 4.6;

export const BALL_RADIUS = 0.108;

/** Pin dimensions: 15 in tall, widest ("belly") diameter 4.766 in. */
export const PIN_HEIGHT = 0.381;
export const PIN_RADIUS = 0.0605;
/** Centre-to-centre spacing of adjacent pins: 12 in. */
export const PIN_SPACING = 0.3048;
/** Row-to-row spacing down the lane: 12 in * sin(60 deg). */
export const PIN_ROW_DZ = PIN_SPACING * Math.sin(Math.PI / 3);

/** Z of the head pin. Deeper rows sit further down-lane (more negative). */
export const HEAD_PIN_Z = -LANE_LENGTH;
/** The pin deck extends a little past the back row before the pit drops away. */
export const DECK_BACK_Z = HEAD_PIN_Z - 3 * PIN_ROW_DZ - 0.55;

/** Standard 1-10 pin layout, indexed by (pin number - 1), from the bowler's
 * point of view: pin 7 is back-left, pin 10 back-right. */
export const PIN_LAYOUT: ReadonlyArray<{ x: number; z: number }> = [
  { x: 0, z: HEAD_PIN_Z },
  { x: -PIN_SPACING / 2, z: HEAD_PIN_Z - PIN_ROW_DZ },
  { x: PIN_SPACING / 2, z: HEAD_PIN_Z - PIN_ROW_DZ },
  { x: -PIN_SPACING, z: HEAD_PIN_Z - 2 * PIN_ROW_DZ },
  { x: 0, z: HEAD_PIN_Z - 2 * PIN_ROW_DZ },
  { x: PIN_SPACING, z: HEAD_PIN_Z - 2 * PIN_ROW_DZ },
  { x: -1.5 * PIN_SPACING, z: HEAD_PIN_Z - 3 * PIN_ROW_DZ },
  { x: -PIN_SPACING / 2, z: HEAD_PIN_Z - 3 * PIN_ROW_DZ },
  { x: PIN_SPACING / 2, z: HEAD_PIN_Z - 3 * PIN_ROW_DZ },
  { x: 1.5 * PIN_SPACING, z: HEAD_PIN_Z - 3 * PIN_ROW_DZ },
];

/** Lateral distance from this lane's centre to each neighbouring lane's
 * centre -- lane + both gutters + the divider capping between them. */
export const LANE_PITCH = 2 * (LANE_HALF_WIDTH + GUTTER_WIDTH) + 0.42;

// ---------------------------------------------------------------------------
// Throw tuning. Ball speed is derived from how hard the phone is swung;
// these bounds keep even a limp flick playable and a violent one fair.
// ---------------------------------------------------------------------------

export const MIN_BALL_SPEED = 5.2;
export const MAX_BALL_SPEED = 9.6;
/** Peak linear-acceleration magnitudes (m/s^2) mapped onto that speed range. */
export const SWING_MIN_ACCEL = 6;
export const SWING_MAX_ACCEL = 26;

// The strike pocket sits about 7 cm either side of the head pin, so every
// aiming control below is sized against that: the stance covers the width of
// the lane coarsely, while the aim angle and the hook each shift the ball by
// a few pocket-widths at the pins -- enough to correct a bad stance, not
// enough that a centred setup can be steered into a gutter by accident.

/** How far left/right of lane centre the bowler may stand. */
export const STANCE_LIMIT = 0.36;
/** Aim angle limit, radians, off straight-down-lane -- about +/-25 cm at the pins. */
export const AIM_LIMIT = 0.014;
/** Spin ranges from -1 (hooks left) to +1 (hooks right). */
export const MAX_HOOK_ACCEL = 0.45;
