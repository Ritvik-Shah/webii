import { Route, Routes } from "react-router-dom";
import { ScreenApp } from "./screen/ScreenApp";
import ControllerApp from "./controller/ControllerApp";
import ControllerJoin from "./controller/ControllerJoin";
import { SpectatorApp } from "./screen/SpectatorApp";
import SpectatorJoin from "./screen/SpectatorJoin";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ScreenApp />} />
      <Route path="/play" element={<ControllerJoin />} />
      <Route path="/play/:roomCode" element={<ControllerApp />} />
      <Route path="/watch" element={<SpectatorJoin />} />
      <Route path="/watch/:roomCode" element={<SpectatorApp />} />
    </Routes>
  );
}
