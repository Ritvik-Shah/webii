import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

/** Type a room code to open a read-only mirror of that room's screen. */
export default function SpectatorJoin() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length >= 3) navigate(`/watch/${trimmed}`);
  }

  return (
    <div className="join-screen">
      <h1>Webii</h1>
      <p>Enter a room code to watch that screen</p>
      <form onSubmit={submit} className="join-form">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          placeholder="CODE"
          className="join-input"
        />
        <button type="submit" className="join-button">
          Watch
        </button>
      </form>
    </div>
  );
}
