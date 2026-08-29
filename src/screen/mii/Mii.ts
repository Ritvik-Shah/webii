export interface Mii {
  id: string;
  name: string;
  skinTone: string;
  faceShape: string;
  hairStyle: string;
  hairColor: string;
  eyeStyle: string;
  eyeColor: string;
  eyebrowStyle: string;
  noseStyle: string;
  mouthStyle: string;
  facialHair: string;
  glassesStyle: string;
  shirtStyle: string;
  shirtColor: string;
  hatStyle: string;
  hatColor: string;
  build: string;
  height: string;
}

// ---------------------------------------------------------------------------
// Option palettes -- every cyclable value for every customizable field, in
// the order D-pad Left/Right steps through them in the Mii Channel editor.
// ---------------------------------------------------------------------------

export const SKIN_TONES = ["#f7d9b6", "#f2c9a0", "#e8a978", "#d69b6b", "#c98a5b", "#a56b3e", "#8a5a3a", "#5c3d20"];
export const HAIR_COLORS = ["#1a1a1a", "#2e2e2e", "#3b2a1f", "#5c4630", "#8a5a2a", "#a83232", "#e8c840", "#f2f2f2", "#4f6fd6", "#c43bb0", "#3bc48a"];
export const EYE_COLORS = ["#2a1a10", "#3b2a1f", "#274b6b", "#2f7a4a", "#6b3b1f", "#7a4fa0", "#c43b3b"];
export const SHIRT_COLORS = ["#3bb54a", "#3b82c4", "#c43b3b", "#f4a300", "#8a3bc4", "#e85d9e", "#3bc4a1", "#5a5a5a", "#c4a13b", "#3b3bc4"];
export const HAT_COLORS = ["#c43b3b", "#3b82c4", "#3bb54a", "#f4a300", "#1a1a1a", "#f2f2f2"];

export const HAIR_STYLES = ["bald", "buzz", "short", "messy", "long", "wavy", "ponytail", "pigtails", "spiky", "mohawk", "curly", "bob"];
export const FACE_SHAPES = ["round", "oval", "square", "heart"];
export const EYE_STYLES = ["normal", "round", "sleepy", "angry", "wide", "happy", "star"];
export const EYEBROW_STYLES = ["normal", "thick", "thin", "angled", "raised", "unibrow"];
export const NOSE_STYLES = ["small", "medium", "large", "button", "pointy"];
export const MOUTH_STYLES = ["neutral", "smile", "grin", "smirk", "surprised", "frown", "tongue", "flat"];
export const FACIAL_HAIR_STYLES = ["none", "mustache", "goatee", "beard", "soulpatch"];
export const GLASSES_STYLES = ["none", "round", "square", "sunglasses", "star"];
export const SHIRT_STYLES = ["plain", "striped", "collared", "hoodie"];
export const HAT_STYLES = ["none", "cap", "beanie", "tophat", "party"];
export const BUILDS = ["slim", "average", "wide"];
export const HEIGHTS = ["short", "average", "tall"];

/** One row in the Mii Channel editor: a field on `Mii`, a friendly label,
 * and the ordered list of values D-pad Left/Right cycles through. `swatch`
 * marks color fields so the editor can render a color chip instead of text
 * for the current value. Iterating this one list (rather than hand-writing
 * 18 separate cases) is what lets the editor UI and the "randomize"
 * function both stay generic. */
export interface MiiFieldDef {
  key: keyof Mii;
  label: string;
  options: string[];
  swatch?: boolean;
}

export const MII_FIELDS: MiiFieldDef[] = [
  { key: "skinTone", label: "Skin Tone", options: SKIN_TONES, swatch: true },
  { key: "faceShape", label: "Face Shape", options: FACE_SHAPES },
  { key: "hairStyle", label: "Hair Style", options: HAIR_STYLES },
  { key: "hairColor", label: "Hair Color", options: HAIR_COLORS, swatch: true },
  { key: "eyeStyle", label: "Eyes", options: EYE_STYLES },
  { key: "eyeColor", label: "Eye Color", options: EYE_COLORS, swatch: true },
  { key: "eyebrowStyle", label: "Eyebrows", options: EYEBROW_STYLES },
  { key: "noseStyle", label: "Nose", options: NOSE_STYLES },
  { key: "mouthStyle", label: "Mouth", options: MOUTH_STYLES },
  { key: "facialHair", label: "Facial Hair", options: FACIAL_HAIR_STYLES },
  { key: "glassesStyle", label: "Glasses", options: GLASSES_STYLES },
  { key: "shirtStyle", label: "Shirt Style", options: SHIRT_STYLES },
  { key: "shirtColor", label: "Shirt Color", options: SHIRT_COLORS, swatch: true },
  { key: "hatStyle", label: "Hat", options: HAT_STYLES },
  { key: "hatColor", label: "Hat Color", options: HAT_COLORS, swatch: true },
  { key: "build", label: "Build", options: BUILDS },
  { key: "height", label: "Height", options: HEIGHTS },
];

// ---------------------------------------------------------------------------
// Fun random-name generator -- the Mii Channel editor treats the name as
// just another cyclable "field" (Left/Right rerolls it), sidestepping the
// need for on-phone text entry entirely.
// ---------------------------------------------------------------------------

const NAME_ADJECTIVES = ["Zippy", "Boop", "Wobble", "Turbo", "Snazzy", "Fuzzy", "Nifty", "Wacky", "Spiffy", "Bouncy", "Zesty", "Dizzy", "Peppy", "Sparky"];
const NAME_NOUNS = ["Biscuit", "Pickle", "Noodle", "Waffle", "Pebble", "Marble", "Tofu", "Mochi", "Bean", "Nugget", "Taco", "Pretzel", "Kiwi", "Peach"];

export function randomName(): string {
  const a = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const n = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${a} ${n}`;
}

function randomFrom(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)];
}

/** A completely random Mii -- used both as the starting point for a new Mii
 * in the editor and by the "Randomize!" button. */
export function randomMii(id: string): Mii {
  const mii = { id, name: randomName() } as Mii;
  for (const field of MII_FIELDS) {
    (mii as unknown as Record<string, string>)[field.key] = randomFrom(field.options);
  }
  return mii;
}

// A small preset roster, still used as a fallback in the pre-game Mii Select
// screen for anyone who hasn't created their own Mii yet in the Mii Channel.
export const MII_ROSTER: Mii[] = [
  { id: "m1", name: "Ren", skinTone: "#f2c9a0", faceShape: "round", hairStyle: "short", hairColor: "#3b2a1f", eyeStyle: "happy", eyeColor: "#3b2a1f", eyebrowStyle: "normal", noseStyle: "medium", mouthStyle: "smile", facialHair: "none", glassesStyle: "none", shirtStyle: "plain", shirtColor: "#3bb54a", hatStyle: "none", hatColor: "#c43b3b", build: "average", height: "average" },
  { id: "m2", name: "Kai", skinTone: "#e8a978", faceShape: "square", hairStyle: "spiky", hairColor: "#1a1a1a", eyeStyle: "angry", eyeColor: "#2a1a10", eyebrowStyle: "angled", noseStyle: "large", mouthStyle: "smirk", facialHair: "none", glassesStyle: "none", shirtStyle: "collared", shirtColor: "#3b82c4", hatStyle: "none", hatColor: "#3b82c4", build: "wide", height: "tall" },
  { id: "m3", name: "Mochi", skinTone: "#fbe0c4", faceShape: "heart", hairStyle: "ponytail", hairColor: "#a83232", eyeStyle: "round", eyeColor: "#274b6b", eyebrowStyle: "thin", noseStyle: "small", mouthStyle: "neutral", facialHair: "none", glassesStyle: "none", shirtStyle: "striped", shirtColor: "#c43b3b", hatStyle: "none", hatColor: "#c43b3b", build: "slim", height: "short" },
  { id: "m4", name: "Otto", skinTone: "#d69b6b", faceShape: "round", hairStyle: "bald", hairColor: "#5c4630", eyeStyle: "wide", eyeColor: "#3b2a1f", eyebrowStyle: "raised", noseStyle: "button", mouthStyle: "surprised", facialHair: "mustache", glassesStyle: "round", shirtStyle: "hoodie", shirtColor: "#f4a300", hatStyle: "none", hatColor: "#f4a300", build: "average", height: "average" },
  { id: "m5", name: "Suri", skinTone: "#f7d9b6", faceShape: "oval", hairStyle: "long", hairColor: "#e8c840", eyeStyle: "happy", eyeColor: "#2f7a4a", eyebrowStyle: "normal", noseStyle: "small", mouthStyle: "grin", facialHair: "none", glassesStyle: "none", shirtStyle: "plain", shirtColor: "#8a3bc4", hatStyle: "beanie", hatColor: "#8a3bc4", build: "slim", height: "average" },
  { id: "m6", name: "Beno", skinTone: "#c98a5b", faceShape: "square", hairStyle: "short", hairColor: "#2e2e2e", eyeStyle: "sleepy", eyeColor: "#2a1a10", eyebrowStyle: "thick", noseStyle: "medium", mouthStyle: "flat", facialHair: "beard", glassesStyle: "none", shirtStyle: "collared", shirtColor: "#3bc4a1", hatStyle: "none", hatColor: "#3bc4a1", build: "wide", height: "tall" },
  { id: "m7", name: "Pip", skinTone: "#f2c9a0", faceShape: "round", hairStyle: "mohawk", hairColor: "#7a4fa0", eyeStyle: "star", eyeColor: "#7a4fa0", eyebrowStyle: "raised", noseStyle: "pointy", mouthStyle: "tongue", facialHair: "none", glassesStyle: "star", shirtStyle: "striped", shirtColor: "#e85d9e", hatStyle: "party", hatColor: "#e85d9e", build: "slim", height: "short" },
  { id: "m8", name: "Dot", skinTone: "#8a5a3a", faceShape: "oval", hairStyle: "curly", hairColor: "#1a1a1a", eyeStyle: "normal", eyeColor: "#3b2a1f", eyebrowStyle: "normal", noseStyle: "medium", mouthStyle: "smile", facialHair: "none", glassesStyle: "square", shirtStyle: "plain", shirtColor: "#3b3bc4", hatStyle: "cap", hatColor: "#3b3bc4", build: "average", height: "average" },
];
