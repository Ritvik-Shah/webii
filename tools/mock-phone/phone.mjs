// The mock phone itself: the real controller page, driven the way a hand
// drives it. Shared by every harness in here.
import { openWindow, sleep } from "./cdp.mjs";

// The pointer maths, mirrored from useMotionStream: a 90-degree turn is one
// unit of offset, and the screen maps one unit to 100% of its width.
const DEGREES_PER_UNIT = 90;
const BASE = { alpha: 180, beta: 0, gamma: 0 };

class MockPhone {
  constructor(tab) {
    this.tab = tab;
  }

  static async open(url) {
    const tab = await openWindow("about:blank");
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


  // --- things a fishing rod needs ---------------------------------------

  /**
   * Records every buzz the phone is asked to make.
   *
   * The host sends haptics down the room socket and the controller calls
   * `navigator.vibrate`; headless Chrome has no motor, so the call is
   * wrapped and logged instead. It is still the app's own code path, so
   * this proves the whole chain from the game deciding "that's a bite" to
   * the phone being told about it.
   */
  async watchVibrations() {
    await this.tab.eval(
      `(() => { window.__buzz = []; const real = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
        navigator.vibrate = (p) => { window.__buzz.push(Array.isArray(p) ? p : [p]); return real ? real(p) : true; };
        return true; })()`,
    );
  }

  buzzes() {
    return this.tab.eval("window.__buzz ? window.__buzz.length : -1");
  }

  /**
   * A flick of the wrist.
   *
   * Orientation can be overridden over CDP, but acceleration cannot, so the
   * motion event is constructed and dispatched in the page. It still goes
   * through the controller's own `devicemotion` listener and out over the
   * real socket -- what is faked is the sensor, not the app.
   */
  async flick(magnitude = 26, holdMs = 400) {
    const fire = (m) =>
      this.tab.eval(
        `window.dispatchEvent(new DeviceMotionEvent("devicemotion", {
           accelerationIncludingGravity: { x: 0, y: ${m}, z: 0 } })) || true`,
      );
    // Hold the peak for a few hundred milliseconds rather than firing it
    // once. The controller samples on its own timer, and a single spike
    // dispatched between two samples is a flick nobody ever sees -- which
    // is exactly what swallowed the strike when the phone tab was in the
    // background and its timer was being throttled.
    const until = Date.now() + holdMs;
    while (Date.now() < until) {
      await fire(magnitude);
      await sleep(50);
    }
    // Settle back to gravity, so the detector re-arms and one throw counts
    // once. It has to be 9.81 rather than zero: the game measures how far
    // the reading is *from* gravity, so a phone sitting still on a table
    // reads 0 and a "settle" of 0 would read as another 9.8 of throw --
    // which left the detector permanently un-armed after the first cast.
    for (let i = 0; i < 3; i += 1) await fire(9.81);
    await sleep(150);
  }

  /**
   * Wind the wrist in circles for a while. Unlike the flick this is entirely
   * real: rocking the orientation override back and forth is genuine angular
   * speed, which is exactly what the game measures.
   */
  async crank(ms, swing = 26) {
    const started = Date.now();
    let flip = 1;
    while (Date.now() - started < ms) {
      await this.orient({ alpha: BASE.alpha + swing * flip, beta: BASE.beta + swing * flip * 0.6 });
      flip *= -1;
      await sleep(55);
    }
  }

  /** Tap a phone-view button by its visible text. */
  async tap(pattern) {
    const text = await this.tab.clickText(pattern, ".phone-choice, .phone-action");
    await sleep(500);
    return text;
  }
}

export { MockPhone, BASE, DEGREES_PER_UNIT };
