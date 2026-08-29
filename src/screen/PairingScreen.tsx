import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface PairingScreenProps {
  roomCode: string;
  screenSocketConnected: boolean;
}

export function PairingScreen({ roomCode, screenSocketConnected }: PairingScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const joinUrl = `${location.origin}/play/${roomCode}`;
    void QRCode.toCanvas(canvasEl, joinUrl, {
      width: 240,
      margin: 1,
      color: { dark: "#0b3d91", light: "#ffffff" },
    });
  }, [roomCode]);

  return (
    <div className="pairing-screen">
      <h1 className="pairing-title">Webii</h1>
      <p className="pairing-sub">Grab your phone to play</p>
      <canvas className="pairing-qr" ref={canvasRef} />
      <div className="pairing-code">{roomCode}</div>
      <p className="pairing-hint">
        Scan the QR code with your phone, or visit {location.host}/play and type the code in by hand.
      </p>
      <p className="pairing-status">
        {screenSocketConnected ? "Waiting for a phone to join…" : "Connecting…"}
      </p>
    </div>
  );
}
