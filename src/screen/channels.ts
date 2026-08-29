export interface Channel {
  id: string;
  title: string;
  accent: string;
  status: "ready" | "soon";
}

export const CHANNELS: Channel[] = [
  { id: "mii", title: "Mii Channel", accent: "#f4a300", status: "soon" },
  { id: "bowling", title: "Wii Sports: Bowling", accent: "#3b82c4", status: "ready" },
  { id: "target", title: "Shooting Range", accent: "#c43b3b", status: "ready" },
  { id: "tanks", title: "Tanks!", accent: "#5a7a3b", status: "ready" },
  { id: "charge", title: "Charge!", accent: "#c48a3b", status: "ready" },
  { id: "photo", title: "Photo Channel", accent: "#f4a300", status: "soon" },
  { id: "weather", title: "Forecast Channel", accent: "#3bb5d0", status: "soon" },
  { id: "news", title: "News Channel", accent: "#c43bb0", status: "soon" },
  { id: "shop", title: "Webii Shop", accent: "#8a3bc4", status: "soon" },
  { id: "settings", title: "Wii Options", accent: "#888888", status: "soon" },
  { id: "friends", title: "Friend Roster", accent: "#3b6bc4", status: "soon" },
  { id: "message", title: "Message Board", accent: "#c4a13b", status: "soon" },
];
