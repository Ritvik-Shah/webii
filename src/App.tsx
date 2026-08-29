import { Route, Routes } from "react-router-dom";
import { ScreenApp } from "./screen/ScreenApp";
import ControllerApp from "./controller/ControllerApp";
import ControllerJoin from "./controller/ControllerJoin";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ScreenApp />} />
      <Route path="/play" element={<ControllerJoin />} />
      <Route path="/play/:roomCode" element={<ControllerApp />} />
    </Routes>
  );
}
