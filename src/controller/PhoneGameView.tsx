import { useEffect, useState } from "react";
import type { PhoneView } from "../../shared/protocol";
import "./phone-view.css";

interface PhoneGameViewProps {
  view: PhoneView;
  send: (msg: object) => void;
  roomCode: string;
  player: number;
}

/**
 * Renders whatever the host asked this phone to show, and reports back what
 * the player picked. Deliberately generic: the host owns the game, this owns
 * nothing but the presentation, so a new card or party game needs no new
 * phone code at all.
 */
export default function PhoneGameView({ view, send, roomCode, player }: PhoneGameViewProps) {
  const [text, setText] = useState("");
  const [amount, setAmount] = useState(view.slider?.value ?? 0);
  // A fresh prompt should not inherit the previous one's typing.
  const inputKey = view.input?.placeholder ?? "";
  useEffect(() => setText(""), [inputKey]);
  useEffect(() => {
    if (view.slider) setAmount(view.slider.value);
  }, [view.slider?.id, view.slider?.value]);

  function choose(id: string, value?: string | number) {
    send({ type: "action", id, value });
    if (navigator.vibrate) navigator.vibrate(12);
  }

  return (
    <div className={`phone-view${view.waiting ? " is-waiting" : ""}`}>
      <div className="phone-view-bar">
        <span>Room {roomCode}</span>
        <span className="phone-view-player">Player {player}</span>
        {/* A game view replaces the whole remote, so without this there is
            literally no button left that can send HOME and leave the game. */}
        <button
          className="phone-view-home"
          onClick={() => {
            send({ type: "button", button: "HOME", state: "down" });
            send({ type: "button", button: "HOME", state: "up" });
            if (navigator.vibrate) navigator.vibrate(12);
          }}
        >
          Home
        </button>
      </div>

      {view.title && <h1 className="phone-view-title">{view.title}</h1>}
      {view.subtitle && <p className="phone-view-subtitle">{view.subtitle}</p>}
      {view.note && <p className="phone-view-note">{view.note}</p>}

      {view.cards && view.cards.length > 0 && (
        <div className="phone-view-hand">
          {view.cards.map((card) => (
            <button
              key={card.id}
              className={`phone-card${card.playable === false ? " is-dead" : ""}`}
              style={card.color ? { background: card.color } : undefined}
              disabled={card.playable === false || view.waiting}
              onClick={() => choose(card.id)}
            >
              {card.label}
            </button>
          ))}
        </div>
      )}

      {view.choices && view.choices.length > 0 && (
        <div className="phone-view-choices">
          {view.choices.map((choice) => (
            <button
              key={choice.id}
              className="phone-choice"
              disabled={view.waiting}
              onClick={() => choose(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {view.slider && (
        <div className="phone-view-slider">
          <label className="phone-slider-label">
            {view.slider.label}: <strong>{amount}</strong>
          </label>
          <input
            type="range"
            min={view.slider.min}
            max={view.slider.max}
            step={view.slider.step}
            value={amount}
            disabled={view.waiting}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <button
            className="phone-action is-primary"
            disabled={view.waiting}
            onClick={() => choose(view.slider!.id, amount)}
          >
            {view.slider.submitLabel}
          </button>
        </div>
      )}

      {view.input && (
        <form
          className="phone-view-input"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = text.trim();
            if (trimmed) choose("submit", trimmed);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={view.input.placeholder}
            maxLength={view.input.maxLength}
            disabled={view.waiting}
            autoComplete="off"
          />
          <button type="submit" className="phone-action is-primary" disabled={view.waiting || !text.trim()}>
            {view.input.submitLabel}
          </button>
        </form>
      )}

      {view.actions && view.actions.length > 0 && (
        <div className="phone-view-actions">
          {view.actions.map((action) => (
            <button
              key={action.id}
              className={`phone-action is-${action.style ?? "muted"}`}
              disabled={action.disabled || view.waiting}
              onClick={() => choose(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
