// Original WebAudio cues for the alley -- same oscillator + gain-envelope
// approach as src/lib/sound.ts, but bowling needs noise-based sounds (a
// rolling rumble, a pin crash) that the shared chime module has no business
// carrying.

let audio: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audio) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio = new Ctor();
  }
  if (audio.state === "suspended") void audio.resume();
  return audio;
}

function tone(freq: number, offset: number, duration: number, peak = 0.12, type: OscillatorType = "sine") {
  const a = ctx();
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = a.currentTime + offset;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(a.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** One shared buffer of white noise, reused by every noise-based cue. */
let noiseBuffer: AudioBuffer | null = null;
function noise(): AudioBuffer {
  const a = ctx();
  if (!noiseBuffer) {
    noiseBuffer = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function noiseBurst(offset: number, duration: number, peak: number, filterHz: number, q = 1) {
  const a = ctx();
  const src = a.createBufferSource();
  src.buffer = noise();
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterHz;
  filter.Q.value = q;
  const gain = a.createGain();
  const start = a.currentTime + offset;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(start);
  src.stop(start + duration + 0.05);
}

/**
 * The low rumble of a ball travelling the lane. Returns a handle whose
 * `setIntensity` tracks ball speed and whose `stop` fades it out, so the
 * game loop can drive one continuous voice rather than retriggering.
 */
export function startRoll(): { setIntensity: (v: number) => void; stop: () => void } {
  const a = ctx();
  const src = a.createBufferSource();
  src.buffer = noise();
  src.loop = true;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 180;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, a.currentTime);
  gain.gain.linearRampToValueAtTime(0.16, a.currentTime + 0.08);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start();

  let stopped = false;
  return {
    setIntensity(v: number) {
      if (stopped) return;
      const clamped = Math.max(0, Math.min(1, v));
      filter.frequency.setTargetAtTime(120 + clamped * 200, a.currentTime, 0.1);
      gain.gain.setTargetAtTime(0.05 + clamped * 0.16, a.currentTime, 0.1);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      gain.gain.setTargetAtTime(0.0001, a.currentTime, 0.12);
      src.stop(a.currentTime + 0.6);
    },
  };
}

/** Wooden clatter, scaled by how many pins the contact actually moved. */
export function playPinCrash(intensity: number) {
  const strength = Math.max(0.2, Math.min(1, intensity));
  noiseBurst(0, 0.22 + strength * 0.3, 0.18 * strength, 900, 0.7);
  const hits = 2 + Math.round(strength * 5);
  for (let i = 0; i < hits; i++) {
    const at = Math.random() * 0.28 * strength;
    tone(180 + Math.random() * 420, at, 0.1 + Math.random() * 0.12, 0.05 + strength * 0.05, "triangle");
    noiseBurst(at, 0.09, 0.05 + strength * 0.06, 1600 + Math.random() * 2200, 2);
  }
}

/** The hollow thunk of a ball dropping into the gutter. */
export function playGutter() {
  tone(150, 0, 0.25, 0.09, "sine");
  noiseBurst(0.02, 0.4, 0.06, 320, 1.4);
}

/** Rising fanfare on a strike. */
export function playStrikeFanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => tone(f, i * 0.09, 0.4, 0.13, "triangle"));
  tone(261.63, 0.36, 0.7, 0.1);
}

/** Shorter, flatter cheer for a spare. */
export function playSpareFanfare() {
  tone(523.25, 0, 0.22, 0.11, "triangle");
  tone(698.46, 0.1, 0.4, 0.12, "triangle");
}

/** Soft confirmation blip for aim/stance adjustments and menu steps. */
export function playBlip() {
  tone(660, 0, 0.05, 0.07, "square");
}

/** The mechanical sweep + rack reset between balls. */
export function playRackReset() {
  noiseBurst(0, 0.5, 0.05, 420, 1.2);
  tone(110, 0.05, 0.35, 0.05, "sawtooth");
  tone(140, 0.42, 0.2, 0.05, "sawtooth");
}
