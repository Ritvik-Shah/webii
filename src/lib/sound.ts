// Small original WebAudio chime synth -- deliberately not Nintendo's Wii Menu
// sounds (copyrighted), just tones in the same "friendly console UI" spirit.

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, startOffset: number, duration: number, peakGain = 0.12, type: OscillatorType = "sine") {
  const audio = audioCtx();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = audio.currentTime + startOffset;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

export function playHoverTick() {
  tone(880, 0, 0.08, 0.06, "triangle");
}

export function playLaunchChime() {
  tone(523.25, 0, 0.18, 0.12);
  tone(659.25, 0.08, 0.18, 0.12);
  tone(783.99, 0.16, 0.4, 0.14);
}

export function playButtonBlip() {
  tone(440, 0, 0.06, 0.1, "square");
}
