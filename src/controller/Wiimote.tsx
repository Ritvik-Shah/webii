import type { TouchEvent } from "react";
import type { ButtonName, TurnMessage } from "../../shared/protocol";

interface WiimoteProps {
  connected: boolean;
  screenConnected: boolean;
  send: (msg: object) => void;
  roomCode: string;
  /** This phone's player slot, 0 until the room has assigned one. */
  player: number;
  /** Whose turn the screen last said it was, or null outside a turn-based game. */
  turn: TurnMessage | null;
  onRecenter: () => void;
}

export default function Wiimote({
  connected,
  screenConnected,
  send,
  roomCode,
  player,
  turn,
  onRecenter,
}: WiimoteProps) {
  // `turn.player === 0` means nobody is up (a menu or a results screen), so
  // the remote stays fully live rather than showing a misleading "waiting".
  const waitingOnSomeoneElse = turn !== null && turn.player !== 0 && turn.player !== player;
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
        {player > 0 && <span className="wiimote-player">Player {player}</span>}
        <span className={connected ? "status-ok" : "status-bad"}>
          {connected ? "Connected" : "Reconnecting…"}
        </span>
        <span className={screenConnected ? "status-ok" : "status-warn"}>
          {screenConnected ? "Screen paired" : "Waiting for screen…"}
        </span>
      </div>

      {turn !== null && turn.player !== 0 && (
        <div className={`wiimote-turn${waitingOnSomeoneElse ? " is-waiting" : " is-yours"}`}>
          {waitingOnSomeoneElse ? `Player ${turn.player}'s turn` : "Your turn!"}
          {turn.label ? <span className="wiimote-turn-label">{turn.label}</span> : null}
        </div>
      )}

      <div className="wiimote-body">
        <div className="wiimote-top-row">
          <button className="wiimote-btn wiimote-recenter" onClick={recenter}>
            Recenter
          </button>
          <button className="wiimote-btn wiimote-minus" {...pressHandlers("MINUS")}>
            −
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
