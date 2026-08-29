import type { ButtonName } from "../../shared/protocol";

interface WiimoteProps {
  connected: boolean;
  screenConnected: boolean;
  send: (msg: object) => void;
  roomCode: string;
  onRecenter: () => void;
}

export default function Wiimote({ connected, screenConnected, send, roomCode, onRecenter }: WiimoteProps) {
  function press(button: ButtonName) {
    send({ type: "button", button, state: "down" });
    if (navigator.vibrate) navigator.vibrate(15);
  }

  function release(button: ButtonName) {
    send({ type: "button", button, state: "up" });
  }

  function recenter() {
    onRecenter();
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
  }

  return (
    <div className="wiimote">
      <div className="wiimote-status">
        <span>Room {roomCode}</span>
        <span className={connected ? "status-ok" : "status-bad"}>
          {connected ? "Connected" : "Reconnecting…"}
        </span>
        <span className={screenConnected ? "status-ok" : "status-warn"}>
          {screenConnected ? "Screen paired" : "Waiting for screen…"}
        </span>
      </div>
      <div className="wiimote-body">
        <button
          className="wiimote-btn wiimote-home"
          onTouchStart={(e) => {
            e.preventDefault();
            press("HOME");
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            release("HOME");
          }}
          onMouseDown={() => press("HOME")}
          onMouseUp={() => release("HOME")}
        >
          HOME
        </button>
        <button
          className="wiimote-btn wiimote-a"
          onTouchStart={(e) => {
            e.preventDefault();
            press("A");
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            release("A");
          }}
          onMouseDown={() => press("A")}
          onMouseUp={() => release("A")}
        >
          A
        </button>
        <button
          className="wiimote-btn wiimote-b"
          onTouchStart={(e) => {
            e.preventDefault();
            press("B");
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            release("B");
          }}
          onMouseDown={() => press("B")}
          onMouseUp={() => release("B")}
        >
          B
        </button>
        <button className="wiimote-btn wiimote-recenter" onClick={recenter}>
          Recenter
        </button>
      </div>
      <p className="wiimote-hint">
        Point your phone at the screen like a remote, tap A to select. If it's off, tap Recenter while pointing
        at the middle of the screen.
      </p>
    </div>
  );
}
