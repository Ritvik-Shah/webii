# Mock phone

A phone that is a real phone.

Every game here had been driven through harnesses that call the components
directly, which proves the rules and proves nothing about the thing you
actually hold. This drives two headless Chrome pages instead — a TV at `/`
and a controller at `/play/<code>` under mobile emulation — and touches
neither one's internals:

- **Buttons are real clicks** on the on-screen Wii Remote.
- **The IR pointer is real motion.** The controller listens for
  `deviceorientation`, so the harness overrides the device's orientation over
  CDP and lets the app's own maths turn a wrist into a cursor.
- **Phone menus are read from the DOM** and tapped by their visible text.

So a pass means the whole chain works: wrist → `deviceorientation` → pointer
message → room → host cursor → selection → phone view → tap → game state → TV.

## Running it

Start a Chrome with a debugging port. Background throttling has to be off, or
the phone's 30 Hz motion stream and the host's clock both get slowed to a
crawl the moment a tab loses focus:

```sh
chrome --headless=new --disable-gpu --remote-debugging-port=9222 \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --user-data-dir=/tmp/mock-phone about:blank
```

Then point it at a deployment:

```sh
node tools/mock-phone/island.mjs https://webii.ritvikshah.workers.dev
SHOTS=1 node tools/mock-phone/island.mjs   # also writes screenshots
```

It defaults to `http://localhost:5173`. Production is the better target: the
local dev runtime wedges after a few runs of opening and dropping websockets,
and it is where the room bugs actually show up.

## Things worth knowing before writing another one

- **Calibrate, and check the calibration.** The pointer takes its centre from
  the first orientation reading it ever hears, and an override that fires
  before the motion listener attaches is simply missed. `calibrate()` wiggles
  until the phone is definitely listening, presses the remote's own Recenter,
  then verifies against the TV that pointing somewhere lands there.
- **Nudge before every aim.** A CDP override only emits on change; a real
  phone emits continuously. If the motion stream re-attaches its listener in
  between, it holds no reading and the pointer freezes wherever it was.
- **Scroll before clicking.** A long phone menu scrolls, and an element above
  the fold reports a negative `y`, so the click lands outside the page and is
  dropped in silence.
- **Close every tab when you finish.** A TV left running keeps its clock
  ticking and keeps saving its state over the fresh one the next run just
  cleared.
