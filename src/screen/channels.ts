export interface Channel {
  id: string;
  title: string;
  accent: string;
  status: "ready" | "soon";
}

export const CHANNELS: Channel[] = [
  { id: "mii", title: "Mii Channel", accent: "#f4a300", status: "soon" },
  { id: "target", title: "Shooting Range", accent: "#c43b3b", status: "ready" },
  { id: "tanks", title: "Tanks!", accent: "#5a7a3b", status: "ready" },
  { id: "charge", title: "Charge!", accent: "#c48a3b", status: "ready" },
  { id: "nes-upload", title: "NES Channel", accent: "#6b4fd6", status: "ready" },
  { id: "nes-1", title: "Retro Game 1", accent: "#4f9fd6", status: "soon" },
  { id: "nes-2", title: "Retro Game 2", accent: "#4f9fd6", status: "soon" },
  { id: "photo", title: "Photo Channel", accent: "#f4a300", status: "soon" },
  { id: "weather", title: "Forecast Channel", accent: "#3bb5d0", status: "soon" },
  { id: "news", title: "News Channel", accent: "#c43bb0", status: "soon" },
  { id: "settings", title: "Wii Options", accent: "#888888", status: "soon" },
];
