import type { TouchEvent } from "react";
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
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function release(button: ButtonName) {
    send({ type: "button", button, state: "up" });
  }

  function recenter() {
    onRecenter();
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
  }

  // Shared touch+mouse handlers for a press-and-hold face button. onMouseLeave
  // releases too, so dragging off a button during desktop testing can't leave
  // it stuck "down".
  function pressHandlers(button: ButtonName) {
    return {
      onTouchStart: (e: TouchEvent) => {
        e.preventDefault();
        press(button);
      },
      onTouchEnd: (e: TouchEvent) => {
        e.preventDefault();
        release(button);
      },
      onMouseDown: () => press(button),
      onMouseUp: () => release(button),
      onMouseLeave: () => release(button),
    };
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
        <div className="wiimote-top-row">
          <button className="wiimote-btn wiimote-recenter" onClick={recenter}>
            Recenter
          </button>
          <button className="wiimote-btn wiimote-home" {...pressHandlers("HOME")}>
            HOME
          </button>
        </div>

        <button className="wiimote-btn wiimote-a" {...pressHandlers("A")}>
          A
        </button>

        <div className="wiimote-dpad" role="group" aria-label="D-pad">
          <button
            className="wiimote-btn wiimote-dpad-btn wiimote-dpad-up"
            aria-label="D-pad up"
            {...pressHandlers("UP")}
          >
            ▲
          </button>
          <button
            className="wiimote-btn wiimote-dpad-btn wiimote-dpad-left"
            aria-label="D-pad left"
            {...pressHandlers("LEFT")}
          >
            ◀
          </button>
          <div className="wiimote-dpad-center" aria-hidden="true" />
          <button
            className="wiimote-btn wiimote-dpad-btn wiimote-dpad-right"
            aria-label="D-pad right"
            {...pressHandlers("RIGHT")}
          >
            ▶
          </button>
          <button
            className="wiimote-btn wiimote-dpad-btn wiimote-dpad-down"
            aria-label="D-pad down"
            {...pressHandlers("DOWN")}
          >
            ▼
          </button>
        </div>

        <div className="wiimote-one-two-row">
          <button className="wiimote-btn wiimote-one" {...pressHandlers("ONE")}>
            1
          </button>
          <button className="wiimote-btn wiimote-two" {...pressHandlers("TWO")}>
            2
          </button>
        </div>

        <button className="wiimote-btn wiimote-b" {...pressHandlers("B")}>
          B
        </button>
      </div>

      <p className="wiimote-hint">
        Hold your phone upright and aim it at the screen to point. Tap Recenter while aiming at the middle of the
        screen if it drifts.
      </p>
    </div>
  );
}
