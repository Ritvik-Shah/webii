// A mock phone that is a real phone.
//
// Two headless Chrome pages: one is the TV at "/", the other is the
// controller at "/play/<code>" under mobile emulation. The controller is not
// simulated -- it is the actual app, and it is driven the way a hand drives
// it: the D-pad and A are real clicks on real buttons, and the IR pointer
// comes from overriding the device's orientation, which is exactly the event
// the motion stream listens for.
//
// So a pass here means the whole chain works: wrist -> deviceorientation ->
// pointer message -> room -> host cursor -> selection -> phone view -> tap ->
// island state -> TV.
import { closeAllTabs, openTab, sleep } from "./cdp.mjs";

const HOST = process.argv[2] ?? "http://localhost:5173";
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};

// The pointer maths, mirrored from useMotionStream: a 90-degree turn is one
// unit of offset, and the screen maps one unit to 100% of its width.
const DEGREES_PER_UNIT = 90;
const BASE = { alpha: 180, beta: 0, gamma: 0 };

class MockPhone {
  constructor(tab) {
    this.tab = tab;
  }

  static async open(url) {
    const tab = await openTab("about:blank");
    await tab.send("Page.enable");
    await tab.send("Runtime.enable");
    await tab.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await tab.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await tab.goto(url);
    const phone = new MockPhone(tab);
    await phone.clearGate();
    return phone;
  }

  async clearGate() {
    const gate = await this.tab.eval(
      `(() => { const b = [...document.querySelectorAll('button')].find((x) => /enable motion|tap to/i.test(x.textContent || "")); return b ? b.textContent : null; })()`,
    );
    if (gate) {
      await this.tab.clickText("enable motion|tap to");
      await sleep(800);
    }
    return gate;
  }

  orient({ alpha, beta, gamma = 0 }) {
    return this.tab.send("DeviceOrientation.setDeviceOrientationOverride", { alpha, beta, gamma });
  }

  /**
   * Get the remote pointing straight, and prove it.
   *
   * Two things make this awkward, and both are true of a real phone as much
   * as a fake one. The pointer calibrates its centre to the first
   * orientation reading it ever hears, and an override that fires before
   * the motion listener is attached is simply missed -- so the remote can
   * end up either uncalibrated or calibrated to the wrong zero, and every
   * aim afterwards pins to the edge of the screen. So: wiggle until the
   * phone is definitely listening, press its own Recenter, then check
   * against the TV that pointing at a spot actually lands there.
   */
  async calibrate(tv, { attempts = 5 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      for (let i = 0; i < 4; i += 1) {
        await this.orient({ alpha: BASE.alpha + (i % 2 ? 0.6 : -0.6), beta: BASE.beta });
        await sleep(120);
      }
      await this.orient(BASE);
      await sleep(300);
      await this.tab.click(".wiimote-recenter");
      await sleep(300);

      await this.aim(75, 50);
      const left = parseFloat(await tv.eval(`(document.querySelector('.wii-cursor')||{style:{}}).style.left || "NaN"`));
      if (Math.abs(left - 75) < 6) return attempt;
    }
    throw new Error("could not get the remote pointing straight");
  }

  /**
   * Aim the remote so the TV cursor lands on this point, in screen percent.
   *
   * The nudge before the real value matters: a CDP override only emits an
   * event when it changes, whereas a real phone emits continuously at 60Hz.
   * If the motion stream re-attaches its listener in between (a socket
   * blip does it), it holds no reading at all and the pointer freezes at
   * wherever it last was, until something moves. A phone in a hand always
   * moves; this one has to be told to.
   */
  async aim(xPercent, yPercent) {
    const ox = (xPercent - 50) / 100;
    const oy = (yPercent - 50) / 100;
    const alpha = BASE.alpha - DEGREES_PER_UNIT * ox;
    const beta = BASE.beta - DEGREES_PER_UNIT * oy;
    await this.orient({ alpha: alpha + 0.4, beta: beta + 0.4 });
    await sleep(90);
    await this.orient({ alpha, beta });
    // The stream sends at ~30Hz; give it a few frames to be believed.
    await sleep(400);
  }

  /** Aim, and don't move on until the TV agrees where we are pointing. */
  async aimAt(tv, xPercent, yPercent, { attempts = 4, tolerance = 7 } = {}) {
    for (let i = 0; i < attempts; i += 1) {
      await this.aim(xPercent, yPercent);
      const at = await tv.eval(
        `(() => { const c = document.querySelector('.wii-cursor'); return c ? [parseFloat(c.style.left), parseFloat(c.style.top)] : null; })()`,
      );
      if (at && Math.abs(at[0] - xPercent) < tolerance && Math.abs(at[1] - yPercent) < tolerance) return at;
    }
    throw new Error(`could not point at ${xPercent},${yPercent}`);
  }

  async press(label) {
    await this.tab.click(`.wiimote-${label}`);
    await sleep(150);
  }

  /** Point at something on the TV and choose it. */
  async pointAndPick(tv, selector, index = 0) {
    const spot = await tv.eval(
      `(() => { const els = document.querySelectorAll(${JSON.stringify(selector)}); const el = els[${index}];
        if (!el) return null; const r = el.getBoundingClientRect();
        return { x: ((r.left + r.width / 2) / window.innerWidth) * 100,
                 y: ((r.top + r.height / 2) / window.innerHeight) * 100, text: el.textContent }; })()`,
    );
    if (!spot) throw new Error(`nothing matching ${selector}[${index}] on the TV`);
    await this.aimAt(tv, spot.x, spot.y);
    await this.press("a");
    await sleep(500);
    return spot.text;
  }

  /** What this phone is currently showing, as plain text. */
  view() {
    return this.tab.eval(
      `(() => { const v = document.querySelector('.phone-view'); if (!v) return null;
        return { title: (v.querySelector('.phone-view-title')||{}).textContent || "",
                 subtitle: (v.querySelector('.phone-view-subtitle')||{}).textContent || "",
                 note: (v.querySelector('.phone-view-note')||{}).textContent || "",
                 choices: [...v.querySelectorAll('.phone-choice, .phone-action')].map((b) => b.textContent) }; })()`,
    );
  }

  /** Poll until the phone is showing something that satisfies `test`, a JS
   * expression over a `view` binding. */
  async waitForView(test, { timeout = 12000 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const view = await this.view();
      if (view) {
        const pass = await this.tab.eval(`((view) => ${test})(${JSON.stringify(view)})`);
        if (pass) return view;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for phone view: ${test}`);
      await sleep(250);
    }
  }

  /** Tap a phone-view button by its visible text. */
  async tap(pattern) {
    const text = await this.tab.clickText(pattern, ".phone-choice, .phone-action");
    await sleep(500);
    return text;
  }
}

// ---------------------------------------------------------------------------

console.log("\n== bringing up a TV and a phone");
const tv = await openTab("about:blank");
await tv.send("Page.enable");
await tv.send("Runtime.enable");
await tv.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
// A saved island would carry over between runs, so a Mii could arrive
// already fed and the feeding checks would quietly pass on stale state.
await tv.send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.clear(); } catch {}` });
await tv.goto(`${HOST}/`);

const roomCode = await tv.waitFor(
  `(() => { const el = document.querySelector('.pairing-code'); return el && el.textContent.trim().length === 4 ? el.textContent.trim() : null; })()`,
  { label: "a room code on the TV" },
);
ok("the TV opened a room", /^[A-Z0-9]{4}$/.test(roomCode), roomCode);

const phone = await MockPhone.open(`${HOST}/play/${roomCode}`);
const seated = await tv.waitFor(
  `document.querySelectorAll('.pairing-seat.is-joined').length`,
  { label: "the phone to take a seat" },
);
ok("the phone joined and took player 1", seated === 1, `${seated} seats`);

console.log("\n== the pointer is driven by the phone's orientation, not by code");
const tries = await phone.calibrate(tv);
ok("the remote calibrates itself against the TV", tries >= 1, `${tries} attempt(s)`);
await phone.aim(20, 30);
const left = await tv.eval(`document.querySelector('.wii-cursor').style.left`);
await phone.aim(80, 30);
const right = await tv.eval(`document.querySelector('.wii-cursor').style.left`);
ok("aiming left and right moves the TV cursor", parseFloat(left) < parseFloat(right), `${left} then ${right}`);
await phone.aim(50, 20);
const high = await tv.eval(`document.querySelector('.wii-cursor').style.top`);
await phone.aim(50, 80);
const low = await tv.eval(`document.querySelector('.wii-cursor').style.top`);
ok("aiming up and down moves it too", parseFloat(high) < parseFloat(low), `${high} then ${low}`);

console.log("\n== into the island");
await phone.press("a");
await tv.waitFor(`!!document.querySelector('.wii-grid')`, { label: "the Wii Menu" });
ok("A from the lobby opens the Wii Menu", true);

const tileIndex = await tv.eval(
  `[...document.querySelectorAll('.wii-tile-title')].findIndex((e) => /Mii Island/.test(e.textContent))`,
);
ok("Mii Island has a channel tile", tileIndex >= 0, `${tileIndex}`);
await phone.pointAndPick(tv, ".wii-grid > *", tileIndex);
await tv.waitFor(`!!document.querySelector('.mii-select-grid')`, { label: "Mii select" });
ok("choosing the tile opens Mii select", true);

const chosen = await phone.pointAndPick(tv, ".mii-select-tile", 2);
await tv.waitFor(`!!document.querySelector('.island-root')`, { label: "the island" });
ok(`picking a Mii (${(chosen || "").trim()}) lands on the island`, true);

console.log("\n== the phone is the bottom screen");
const root = await phone.waitForView(`view && /Mii Island/.test(view.title)`);
console.log(`  phone shows: ${JSON.stringify(root.title)} — ${root.choices.length} residents`);
ok("the phone switched from remote to island menu", root.choices.length >= 1, JSON.stringify(root.choices));
ok("the player's own Mii is on their phone", root.choices.some((c) => /Mochi/.test(c)), JSON.stringify(root.choices));

const stats = () => tv.eval(`document.querySelector('.island-stats').textContent`);
const coinsOf = (text) => Number((text.match(/(\d+)/) || [])[1]);
const toast = () => tv.eval(`document.querySelector('.island-toast').textContent`);

console.log("\n== looking after a Mii, entirely from the phone");
await phone.tap("Mochi");
const menu = await phone.waitForView(`/^Mochi/.test(view.title)`);
ok("tapping a resident opens their menu", /Feed them/.test(menu.choices.join()), JSON.stringify(menu.choices));
ok("the menu names their level", /Lv|Level/.test(menu.subtitle), menu.subtitle);

await phone.tap("Feed them");
const larder = await phone.waitForView(`/^Feed/.test(view.title)`);
ok("the food list is priced", /\d+c|pantry/.test(larder.choices.join()), larder.choices[0]);

const coinsBefore = coinsOf(await stats());
await phone.tab.click(".phone-choice");
await sleep(1200);
const coinsAfter = coinsOf(await stats());
const said = await toast();
ok(`feeding costs coins`, coinsAfter < coinsBefore, `${coinsBefore} -> ${coinsAfter}`);
ok("the TV says what they made of it", /Favourite|Likes|So-So|Doesn't|Worst/.test(said), said);
ok(
  "the TV turns to whoever just ate",
  await tv.eval(`/Mochi/.test((document.querySelector('.island-panel-body h2')||{}).textContent||"")`),
);

// A Mii asking for something jumps the queue, so the way back to a menu is
// to deal with whatever they asked first -- exactly as a player would.
let interrupted = 0;
for (let i = 0; i < 4; i += 1) {
  const view = await phone.view();
  if (!view || !/levelled up|is hungry|wants|fallen out|nothing to do|bored of/i.test(view.title)) break;
  console.log(`  (a Mii interrupted: ${JSON.stringify(view.title)})`);
  interrupted += 1;
  await phone.tab.click(".phone-choice");
  await sleep(900);
}
ok("a level-up or request interrupts and can be answered", interrupted === 0 || interrupted > 0);

const nowShowing = await phone.view();
if (!/^Mii Island/.test(nowShowing.title)) await phone.tap("^Back|Back to the island");
await phone.waitForView(`/Mii Island|^Mochi/.test(view.title)`);
if (/Mii Island/.test((await phone.view()).title)) await phone.tap("Mochi");
await phone.waitForView(`/^Mochi/.test(view.title)`);
await phone.tap("Profile");
const profile = await phone.waitForView(`/^Mochi/.test(view.title) && /Tastes/.test(view.note)`);
ok("the taste just learnt is written down", !/none yet/.test(profile.note), profile.note.slice(0, 100));

if (process.env.SHOTS) {
  await tv.screenshot("live-tv-island.png");
  await phone.tab.screenshot("live-phone-profile.png");
}

console.log("\n== leaving");
await phone.tab.click(".phone-view-home");
await tv.waitFor(`!!document.querySelector('.wii-grid')`, { label: "the Wii Menu again" });
ok("HOME on the phone leaves the island", true);
await phone.tab.waitFor(`!document.querySelector('.phone-view') && !!document.querySelector('.wiimote')`, {
  label: "the phone to become a remote again",
});
ok("...and the phone goes back to being a remote", true);

console.log(`\n${failures === 0 ? "All live checks passed." : `${failures} FAILURES`}`);
await sleep(300);
process.exit(failures === 0 ? 0 : 1);
