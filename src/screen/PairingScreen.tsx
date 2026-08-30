import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { MAX_PLAYERS } from "../../shared/protocol";

interface PairingScreenProps {
  roomCode: string;
  screenSocketConnected: boolean;
  /** Player numbers currently paired, ascending. */
  players: number[];
}

/**
 * Room lobby: the code and QR to join with, plus a seat per player slot that
 * fills in as phones connect. Doubles as the "waiting for anyone at all"
 * screen -- once at least one phone is in, the host is prompted to start,
 * and further players can still join from here.
 */
export function PairingScreen({ roomCode, screenSocketConnected, players }: PairingScreenProps) {
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

  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1);
  const host = players[0];

  return (
    <div className="pairing-screen">
      <h1 className="pairing-title">Webii</h1>
      <p className="pairing-sub">Grab your phone to play</p>
      <canvas className="pairing-qr" ref={canvasRef} />
      <div className="pairing-code">{roomCode}</div>

      <div className="pairing-seats">
        {seats.map((seat) => {
          const joined = players.includes(seat);
          return (
            <div key={seat} className={`pairing-seat${joined ? " is-joined" : ""}`}>
              <span className="pairing-seat-number">P{seat}</span>
              <span className="pairing-seat-state">{joined ? "Ready" : "Open"}</span>
            </div>
          );
        })}
      </div>

      <p className="pairing-hint">
        Scan the QR code with your phone, or visit {location.host}/play and type the code in by hand.
      </p>
      <p className="pairing-status">
        {!screenSocketConnected
          ? "Connecting…"
          : players.length === 0
            ? "Waiting for a phone to join…"
            : `Player ${host}: press A to start · up to ${MAX_PLAYERS} can join`}
      </p>
    </div>
  );
}
