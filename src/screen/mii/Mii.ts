export interface Mii {
  id: string;
  name: string;
  skinTone: string;
  hairColor: string;
  hairStyle: "bald" | "short" | "spiky" | "long" | "ponytail";
  shirtColor: string;
  faceStyle: "neutral" | "happy" | "cool" | "surprised";
}

// A small preset roster to pick from -- matches the real Mii Select screen's
// "choose from your existing Miis" flow rather than a full from-scratch
// customizer, which is a reasonable v1 scope (a builder can come later).
export const MII_ROSTER: Mii[] = [
  { id: "m1", name: "Ren", skinTone: "#f2c9a0", hairColor: "#3b2a1f", hairStyle: "short", shirtColor: "#3bb54a", faceStyle: "happy" },
  { id: "m2", name: "Kai", skinTone: "#e8a978", hairColor: "#1a1a1a", hairStyle: "spiky", shirtColor: "#3b82c4", faceStyle: "cool" },
  { id: "m3", name: "Mochi", skinTone: "#fbe0c4", hairColor: "#a83232", hairStyle: "ponytail", shirtColor: "#c43b3b", faceStyle: "neutral" },
  { id: "m4", name: "Otto", skinTone: "#d69b6b", hairColor: "#5c4630", hairStyle: "bald", shirtColor: "#f4a300", faceStyle: "surprised" },
  { id: "m5", name: "Suri", skinTone: "#f7d9b6", hairColor: "#e8c840", hairStyle: "long", shirtColor: "#8a3bc4", faceStyle: "happy" },
  { id: "m6", name: "Beno", skinTone: "#c98a5b", hairColor: "#2e2e2e", hairStyle: "short", shirtColor: "#3bc4a1", faceStyle: "cool" },
  { id: "m7", name: "Pip", skinTone: "#f2c9a0", hairColor: "#7a4fa0", hairStyle: "spiky", shirtColor: "#e85d9e", faceStyle: "surprised" },
  { id: "m8", name: "Dot", skinTone: "#8a5a3a", hairColor: "#1a1a1a", hairStyle: "long", shirtColor: "#3b3bc4", faceStyle: "neutral" },
];
