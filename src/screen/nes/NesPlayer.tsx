import { useEffect, useRef, useState } from "react";
import { NES, Controller } from "jsnes";
import type { EmulatorData, ButtonKey } from "jsnes";
import type { ControllerMessage, ButtonName } from "../../../shared/protocol";
import { MiiAvatar } from "../mii/MiiAvatar";
import type { Mii } from "../mii/Mii";
import "./nes.css";

const WIDTH = 256;
const HEIGHT = 240;
const AUDIO_SAMPLE_RATE = 44100;
// How many float samples (per channel) the ring buffer can hold before
// onAudioSample starts dropping the oldest ones -- caps worst-case latency
// if the audio callback ever falls behind the emulator.
const AUDIO_RING_CAPACITY = 8192;
const AUTO_SAVE_INTERVAL_MS = 8000;

// D-pad/A/B map 1:1; ONE/TWO stand in for the NES's Select/Start (our
// remote doesn't have dedicated Select/Start buttons, and this pairing --
// small utility button = Select, the other = Start -- is the closest
// equivalent). HOME isn't listed: it's handled centrally by ScreenApp to
// exit to the Wii Menu and never reaches the emulator.
const BUTTON_MAP: Partial<Record<ButtonName, ButtonKey>> = {
  UP: Controller.BUTTON_UP,
  DOWN: Controller.BUTTON_DOWN,
  LEFT: Controller.BUTTON_LEFT,
  RIGHT: Controller.BUTTON_RIGHT,
  A: Controller.BUTTON_A,
  B: Controller.BUTTON_B,
  ONE: Controller.BUTTON_SELECT,
  TWO: Controller.BUTTON_START,
};

function loadSave(saveKey: string): EmulatorData | null {
  try {
    const raw = localStorage.getItem(`webii-nes-save-${saveKey}`);
    return raw ? (JSON.parse(raw) as EmulatorData) : null;
  } catch {
    return null;
  }
}

function writeSave(saveKey: string, data: EmulatorData) {
  try {
    localStorage.setItem(`webii-nes-save-${saveKey}`, JSON.stringify(data));
  } catch {
    // Storage full or unavailable (e.g. private browsing) -- losing
    // mid-game progress isn't fatal, just skip persisting this time.
  }
}

export type RomSource = { kind: "url"; url: string } | { kind: "file"; file: File };

interface NesPlayerProps {
  subscribe: (fn: (msg: ControllerMessage) => void) => () => void;
  onExit: () => void;
  mii: Mii;
  title: string;
  /** Storage key for save-state persistence -- callers are responsible for
   * picking something stable per game (a fixed id for a bundled ROM, a
   * content hash for an uploaded one) so resuming finds the right slot. */
  saveKey: string;
  romSource: RomSource;
}

type LoadState = "loading" | "ready" | "error";

/** Plays a single NES ROM via jsnes, mapped onto our existing D-pad/A/B/1/2
 * remote layout -- no new controller UI needed, the full button set we
 * already built happens to cover the NES's entire input surface exactly.
 * Auto-saves periodically and on exit, auto-resumes on next launch, keyed
 * by `saveKey` -- this is what answers "can I pick up where I left off"
 * for both a bundled game and an uploaded one, since it's pure browser-
 * local storage with no dependency on where the ROM file came from. */
export function NesPlayer({ subscribe, onExit, mii, title, saveKey, romSource }: NesPlayerProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nesRef = useRef<NES | null>(null);
  const rafRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioNodeRef = useRef<ScriptProcessorNode | null>(null);
  // Circular audio buffer: onAudioSample (called synchronously inside
  // nes.frame(), potentially thousands of times per frame) writes in;
  // the WebAudio callback reads out at its own pace. Fixed-size typed
  // arrays with read/write indices, not push/shift, since this runs at
  // audio sample rate (tens of thousands of calls/sec) and array shift()
  // is O(n) -- would never keep up.
  const audioLeftRef = useRef(new Float32Array(AUDIO_RING_CAPACITY));
  const audioRightRef = useRef(new Float32Array(AUDIO_RING_CAPACITY));
  const audioWriteRef = useRef(0);
  const audioReadRef = useRef(0);

  const saveNow = () => {
    const nes = nesRef.current;
    if (nes) writeSave(saveKey, nes.toJSON());
  };

  // Load the ROM, create the emulator, and start the render/audio loops.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      let bytes: ArrayBuffer;
      try {
        if (romSource.kind === "url") {
          const res = await fetch(romSource.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          bytes = await res.arrayBuffer();
        } else {
          bytes = await romSource.file.arrayBuffer();
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("Couldn't load that ROM file.");
          setLoadState("error");
        }
        return;
      }
      if (cancelled) return;

      const canvas = canvasRef.current;
      const ctx2d = canvas?.getContext("2d");
      const imageData = ctx2d?.createImageData(WIDTH, HEIGHT);

      const nes = new NES({
        onFrame(buffer) {
          if (!ctx2d || !imageData) return;
          const pixels = imageData.data;
          for (let i = 0; i < buffer.length; i++) {
            const rgb = buffer[i];
            const o = i * 4;
            pixels[o] = (rgb >> 16) & 0xff;
            pixels[o + 1] = (rgb >> 8) & 0xff;
            pixels[o + 2] = rgb & 0xff;
            pixels[o + 3] = 255;
          }
          ctx2d.putImageData(imageData, 0, 0);
        },
        onAudioSample(left, right) {
          const w = audioWriteRef.current;
          audioLeftRef.current[w] = left;
          audioRightRef.current[w] = right;
          audioWriteRef.current = (w + 1) % AUDIO_RING_CAPACITY;
          // If writes have lapped reads, the callback is falling behind --
          // drop the oldest sample rather than let latency grow unbounded.
          if (audioWriteRef.current === audioReadRef.current) {
            audioReadRef.current = (audioReadRef.current + 1) % AUDIO_RING_CAPACITY;
          }
        },
        sampleRate: AUDIO_SAMPLE_RATE,
      });

      try {
        nes.loadROM(bytes);
      } catch {
        if (!cancelled) {
          setErrorMessage("That file doesn't look like a valid NES ROM.");
          setLoadState("error");
        }
        return;
      }

      const saved = loadSave(saveKey);
      if (saved) {
        try {
          nes.fromJSON(saved);
        } catch {
          // Corrupt/incompatible save data -- just start fresh rather than
          // block the game from loading at all.
        }
      }

      nesRef.current = nes;
      if (cancelled) return;
      setLoadState("ready");

      // Audio: a ScriptProcessorNode is deprecated in favor of
      // AudioWorklet, but AudioWorklet needs its own separately-loaded
      // module file, which adds real build complexity for a single-purpose
      // NES-audio callback -- ScriptProcessorNode is still broadly
      // supported and much simpler to inline here.
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new Ctor({ sampleRate: AUDIO_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;
      const node = audioCtx.createScriptProcessor(2048, 0, 2);
      node.onaudioprocess = (e) => {
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);
        for (let i = 0; i < outL.length; i++) {
          if (audioReadRef.current !== audioWriteRef.current) {
            outL[i] = audioLeftRef.current[audioReadRef.current];
            outR[i] = audioRightRef.current[audioReadRef.current];
            audioReadRef.current = (audioReadRef.current + 1) % AUDIO_RING_CAPACITY;
          } else {
            outL[i] = 0;
            outR[i] = 0;
          }
        }
      };
      node.connect(audioCtx.destination);
      audioNodeRef.current = node;
      if (audioCtx.state === "suspended") void audioCtx.resume();

      const tick = () => {
        nes.frame();
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      autoSaveTimerRef.current = window.setInterval(saveNow, AUTO_SAVE_INTERVAL_MS);
    }

    void boot();

    return () => {
      cancelled = true;
      saveNow();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (autoSaveTimerRef.current !== null) window.clearInterval(autoSaveTimerRef.current);
      audioNodeRef.current?.disconnect();
      if (audioCtxRef.current) void audioCtxRef.current.close();
      nesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveKey]);

  // Controller input -- held-state isn't needed here (unlike D-pad-driven
  // continuous movement elsewhere in this app): jsnes tracks button state
  // itself between buttonDown/buttonUp calls, we just forward edges.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== "button") return;
      const nesButton = BUTTON_MAP[msg.button];
      if (nesButton === undefined) return;
      const nes = nesRef.current;
      if (!nes) return;
      if (msg.state === "down") nes.buttonDown(1, nesButton);
      else nes.buttonUp(1, nesButton);
    });
  }, [subscribe]);

  const handleExit = () => {
    saveNow();
    onExit();
  };

  return (
    <div className="nes-root">
      <div className="nes-header">
        <MiiAvatar mii={mii} size={40} />
        <span className="nes-title">{title}</span>
      </div>

      <div className="nes-screen-wrap">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="nes-canvas" />
        {loadState === "loading" && <div className="nes-overlay">Loading…</div>}
        {loadState === "error" && (
          <div className="nes-overlay nes-overlay-error">
            <p>{errorMessage}</p>
            <button className="nes-back-button" onClick={handleExit}>
              Back to Wii Menu
            </button>
          </div>
        )}
      </div>

      <div className="nes-hint">Progress saves automatically · HOME to exit and save</div>
    </div>
  );
}
