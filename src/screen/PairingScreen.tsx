import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import type { ControllerMessage } from "../../shared/protocol";
import { MAX_PLAYERS, SEAT_COLS, SEAT_ROWS } from "../../shared/protocol";
import { usePointerGrid } from "./usePointerGrid";
import { Cursor } from "./Cursor";

interface PairingScreenProps {
  roomCode: string;
  screenSocketConnected: boolean;
  /** Player numbers currently paired, ascending. */
  players: number[];
  subscribe: (fn: (msg: ControllerMessage, player: number) => void) => () => void;
  /** Lowest connected player: the only one who can start or remove anyone. */
  hostPlayer?: number;
  onKick: (player: number) => void;
}

/**
 * Room lobby: the code and QR to join with, plus a seat per player slot that
 * fills in as phones connect. The host can point at a taken seat and press B
 * to clear it -- the way out of a phone that dropped off the network without
 * closing cleanly and is still holding a slot (and, in a turn-based game,
 * holding up everyone else).
 */
export function PairingScreen({
  roomCode,
  screenSocketConnected,
  players,
  subscribe,
  hostPlayer,
  onKick,
}: PairingScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const joinUrl = `${location.origin}/play/${roomCode}`;
    void QRCode.toCanvas(canvasEl, joinUrl, {
      width: 200,
      margin: 1,
      color: { dark: "#0b3d91", light: "#ffffff" },
    });
  }, [roomCode]);

  // The grid is hover-only; A (start) is handled centrally by ScreenApp so it
  // works wherever the cursor happens to be.
  const { cursorRef, gridRef, hoveredIndex } = usePointerGrid(subscribe, SEAT_COLS, SEAT_ROWS, () => {}, hostPlayer);

  const hoveredRef = useRef(hoveredIndex);
  hoveredRef.current = hoveredIndex;
  const onKickRef = useRef(onKick);
  onKickRef.current = onKick;

  useEffect(() => {
    if (hostPlayer === undefined) return;
    return subscribe((msg, player) => {
      if (player !== hostPlayer) return;
      if (msg.type !== "button" || msg.button !== "B" || msg.state !== "down") return;
      const seat = hoveredRef.current;
      if (seat === null) return;
      onKickRef.current(seat + 1);
    });
  }, [subscribe, hostPlayer]);

  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1);
  const canKick = players.length > 1;

  return (
    <div className="pairing-screen">
      <h1 className="pairing-title">Webii</h1>
      <p className="pairing-sub">Grab your phone to play</p>
      <canvas className="pairing-qr" ref={canvasRef} />
      <div className="pairing-code">{roomCode}</div>

      <div className="pairing-seats" ref={gridRef}>
        {seats.map((seat, index) => {
          const joined = players.includes(seat);
          const hovered = index === hoveredIndex;
          return (
            <div
              key={seat}
              className={`pairing-seat${joined ? " is-joined" : ""}${hovered && joined && canKick ? " is-targeted" : ""}`}
            >
              <span className="pairing-seat-number">P{seat}</span>
              <span className="pairing-seat-state">
                {hovered && joined && canKick ? "B to remove" : joined ? "Ready" : "Open"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="pairing-status">
        {!screenSocketConnected
          ? "Connecting…"
          : players.length === 0
            ? "Waiting for a phone to join…"
            : `Player ${hostPlayer}: press A to start${canKick ? " · point at a seat and press B to remove that player" : ""}`}
      </p>
      <p className="pairing-hint">
        Scan the QR code with your phone, or visit {location.host}/play and type the code in by hand.
        <br />
        Watching from elsewhere? Open {location.host}/watch/{roomCode} for a second screen.
      </p>
      {hostPlayer !== undefined && <Cursor ref={cursorRef} />}
    </div>
  );
}
