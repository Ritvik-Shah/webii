export interface Channel {
  id: string;
  title: string;
  accent: string;
  status: "ready" | "soon";
}

export const CHANNELS: Channel[] = [
  { id: "mii", title: "Mii Channel", accent: "#f4a300", status: "ready" },
  { id: "bowling", title: "Bowling", accent: "#2f6fd0", status: "ready" },
  { id: "target", title: "Shooting Range", accent: "#c43b3b", status: "ready" },
  { id: "tanks", title: "Tanks!", accent: "#5a7a3b", status: "ready" },
  { id: "charge", title: "Charge!", accent: "#c48a3b", status: "ready" },
  { id: "nes-upload", title: "NES Channel", accent: "#6b4fd6", status: "ready" },
  { id: "nds-channel", title: "DS Channel", accent: "#c93bc9", status: "ready" },
  { id: "uno", title: "Uno", accent: "#d3323a", status: "ready" },
  { id: "poker", title: "Poker", accent: "#1d5b46", status: "ready" },
  { id: "quiplash", title: "Quiplash", accent: "#6b4fd6", status: "ready" },
  { id: "fibbage", title: "Fibbage", accent: "#c43bb0", status: "ready" },
  { id: "fakinit", title: "Fakin' It", accent: "#e07a3b", status: "ready" },
  { id: "players", title: "Player Manager", accent: "#7088a3", status: "ready" },
];
