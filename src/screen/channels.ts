export interface Channel {
  id: string;
  title: string;
  accent: string;
  status: "ready" | "soon";
}

// All channels are "soon" for now. A later phase wires specific channels to
// "ready" mini-games and adds routing from the tile to the game view.
export const CHANNELS: Channel[] = [
  { id: "mii", title: "Mii Channel", accent: "#f4a300", status: "soon" },
  { id: "tennis", title: "Wii Sports: Tennis", accent: "#3bb54a", status: "soon" },
  { id: "bowling", title: "Wii Sports: Bowling", accent: "#3b82c4", status: "soon" },
  { id: "sword", title: "Sword Duel", accent: "#c43b3b", status: "soon" },
  { id: "photo", title: "Photo Channel", accent: "#f4a300", status: "soon" },
  { id: "weather", title: "Forecast Channel", accent: "#3bb5d0", status: "soon" },
  { id: "news", title: "News Channel", accent: "#c43bb0", status: "soon" },
  { id: "shop", title: "Webii Shop", accent: "#8a3bc4", status: "soon" },
  { id: "settings", title: "Wii Options", accent: "#888888", status: "soon" },
  { id: "friends", title: "Friend Roster", accent: "#3b6bc4", status: "soon" },
  { id: "message", title: "Message Board", accent: "#c4a13b", status: "soon" },
  { id: "disc", title: "Disc Channel", accent: "#3bc4a1", status: "soon" },
];
