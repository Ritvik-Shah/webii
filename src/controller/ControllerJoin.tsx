import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

export default function ControllerJoin() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length >= 3) {
      navigate(`/play/${trimmed}`);
    }
  }

  return (
    <div className="join-screen">
      <h1>Webii</h1>
      <p>Enter the room code shown on the screen</p>
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
          Join
        </button>
      </form>
    </div>
  );
}
