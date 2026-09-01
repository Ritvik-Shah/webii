// Fishing, played by a headless phone.
//
// The four things this channel asks of a Wii Remote are all exercised here
// through the controller's own code: a flick to cast, a jerk to hook, a
// wound wrist to reel, and the phone being buzzed when a fish takes the
// bait. Orientation is a real CDP override; acceleration is dispatched into
// the page because CDP has no way to fake an accelerometer.
import { closeAllTabs, openWindow, sleep } from "./cdp.mjs";
import { MockPhone } from "./phone.mjs";

const HOST = process.argv[2] ?? "http://localhost:5173";
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};

/** What the pier is telling this player to do. */
const note = (tv) => tv.eval(`(document.querySelector('.fishing-card-note')||{}).textContent || ""`);
const bag = (tv) => tv.eval(`parseFloat((document.querySelector('.fishing-card-score')||{}).textContent) || 0`);

async function waitForNote(tv, pattern, timeout = 45000) {
  const deadline = Date.now() + timeout;
  const re = new RegExp(pattern, "i");
  for (;;) {
    const text = await note(tv);
    if (re.test(text)) return text;
    if (Date.now() > deadline) return null;
    await sleep(100);
  }
}

console.log("\n== casting off");
await closeAllTabs();
const tv = await openWindow("about:blank");
await tv.send("Page.enable");
await tv.send("Runtime.enable");
await tv.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await tv.goto(`${HOST}/`);

const roomCode = await tv.waitFor(
  `(() => { const el = document.querySelector('.pairing-code'); return el && el.textContent.trim().length === 4 ? el.textContent.trim() : null; })()`,
  { label: "a room code" },
);
const phone = await MockPhone.open(`${HOST}/play/${roomCode}`);
await phone.watchVibrations();
await tv.waitFor(`document.querySelectorAll('.pairing-seat.is-joined').length`, { label: "the phone to join" });
await phone.calibrate(tv);
ok("a phone joined and the pointer works", true);

await phone.press("a");
await tv.waitFor(`!!document.querySelector('.wii-grid')`, { label: "the Wii Menu" });
const tile = await tv.eval(`[...document.querySelectorAll('.wii-tile-title')].findIndex((e) => /^Fishing/.test(e.textContent))`);
ok("Fishing has a channel tile", tile >= 0, `${tile}`);
await phone.pointAndPick(tv, ".wii-grid > *", tile);
await tv.waitFor(`!!document.querySelector('.mii-select-grid')`, { label: "Mii select" });
await phone.pointAndPick(tv, ".mii-select-tile", 1);
await tv.waitFor(`!!document.querySelector('.fishing-root')`, { label: "the lake" });
// This one is a canvas game, so its clock is requestAnimationFrame -- and a
// background tab's rAF is suspended. The phone can still be driven from a
// hidden tab (CDP does not care), but the TV has to be the visible page or
// the lake simply never ticks.
ok("picking a Mii lands you on the pier", true);
ok("the lake is drawn", (await tv.eval(`!!document.querySelector('.fishing-canvas-wrap canvas')`)) === true);
ok("the angler is standing on it", (await tv.eval(`document.querySelectorAll('.fishing-angler').length`)) === 1);

console.log("\n== the four things a rod asks of a wrist");
const startNote = await note(tv);
ok("it starts by telling you to cast", /flick/i.test(startNote), startNote);

// Winding with nothing on the hook just retrieves the bait. Checked before
// casting, because a 1.5 second crank sitting between a bite and the strike
// spends the whole hooking window.
await phone.crank(1200);
ok("winding with an empty hook is harmless", (await tv.eval(`!!document.querySelector('.fishing-root')`)) === true);

await phone.flick(28);
const casting = await waitForNote(tv, "casting", 6000);
ok("a flick casts the line", casting !== null, `note was ${JSON.stringify(await note(tv))}`);
// "waiting" or "BITE" -- a fish sometimes takes it before the line has even
// finished settling, which is the game working rather than failing.
const settled = await waitForNote(tv, "waiting|bite", 12000);
ok("...and it sinks and starts fishing", settled !== null, `note was ${JSON.stringify(await note(tv))}`);

console.log("\n== waiting for a bite (this is a real wait)");
let bit = false;
let hooked = null;
let buzzed = 0;
for (let attempt = 0; attempt < 3 && !hooked; attempt += 1) {
  const bite = await waitForNote(tv, "BITE", 70000);
  if (!bite) break;
  bit = true;
  buzzed = Math.max(buzzed, await phone.buzzes());
  await phone.flick(30);
  hooked = await waitForNote(tv, "Reel|not a fish", 3000);
}
ok("a fish takes the bait", bit, "no bite inside seventy seconds");
// The whole point of the channel: the phone is told, not just the screen.
ok("the phone buzzed for it", buzzed > 0, `${buzzed} buzzes recorded`);
ok("jerking up sets the hook", hooked !== null, `note was ${JSON.stringify(await note(tv))}`);

if (hooked) {
  console.log("\n== playing it out");
  // Wind, ease, wind -- which is the way the fight is meant to be played.
  let landed = null;
  let lost = null;
  for (let attempt = 0; attempt < 24 && !landed && !lost; attempt += 1) {
    await phone.crank(900);
    await sleep(650);
    const text = await note(tv);
    if (/kg!/.test(text)) landed = text;
    if (/snapped|free/i.test(text)) lost = text;
  }
  const weight = await bag(tv);
  ok("winding in bursts brings it in", landed !== null, lost ?? `note ${JSON.stringify(await note(tv))}`);
  ok("...and it goes in the bag", weight > 0, `${weight} kg`);
}


if (process.env.SHOTS) {
  await tv.screenshot("live-tv-fishing.png");
  const mirror = await openWindow("about:blank");
  await mirror.send("Page.enable");
  await mirror.send("Runtime.enable");
  await mirror.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await mirror.goto(`${HOST}/watch/${roomCode}`);
  // The host has to be the visible page for its game loop to run and
  // publish; only then does the mirror have anything to draw.
  await tv.bringToFront();
  await sleep(3000);
  await mirror.bringToFront();
  await mirror.waitFor(`!!document.querySelector('.fishing-root')`, { label: "the mirrored lake" });
  await sleep(2000);
  ok("the mirror shows the lake", (await mirror.eval(`!!document.querySelector('.fishing-canvas-wrap canvas')`)) === true);
  await mirror.screenshot("live-mirror-fishing.png");
}

console.log(`\n${failures === 0 ? "All fishing checks passed." : `${failures} FAILURES`}`);
await closeAllTabs();
await sleep(300);
process.exit(failures === 0 ? 0 : 1);
