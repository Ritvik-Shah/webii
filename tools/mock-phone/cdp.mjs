// Minimal Chrome DevTools Protocol client: enough to drive two pages at once
// (a TV and a phone) without pulling in puppeteer.
import WebSocket from "ws";

export async function openTab(url = "about:blank") {
  const target = await (
    await fetch(`http://localhost:9222/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
  ).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? "")})`));
      else resolve(msg.result);
    }
  });
  await new Promise((r) => ws.on("open", r));

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  // Otherwise a run can quietly test the previous deploy: the HTML comes
  // from cache and pulls in the old, content-hashed bundle with it.
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });

  const tab = {
    id: target.id,
    send,
    async goto(to) {
      await send("Page.navigate", { url: to });
      await sleep(1200);
    },
    /** Evaluates in the page and returns the value. */
    async eval(expression) {
      const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? "eval failed");
      return res.result.value;
    },
    /** Polls until `expression` is truthy, or gives up. */
    async waitFor(expression, { timeout = 12000, label = expression } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const value = await tab.eval(expression);
        if (value) return value;
        if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
        await sleep(200);
      }
    },
    /** A real mouse press at a point, in CSS pixels. Chrome ignores clicks
     * that arrive without the button bitmask set. */
    async clickAt(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await sleep(60);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    },
    /** Clicks the centre of the first element matching `selector`. */
    async click(selector) {
      const box = await tab.locate(`document.querySelector(${JSON.stringify(selector)})`);
      if (!box) throw new Error(`no element for ${selector}`);
      await tab.clickAt(box.x, box.y);
    },
    /** Clicks the first element whose text matches. */
    async clickText(pattern, selector = "button") {
      const box = await tab.locate(
        `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => new RegExp(${JSON.stringify(pattern)}, "i").test(e.textContent || ""))`,
      );
      if (!box) throw new Error(`no ${selector} matching /${pattern}/`);
      await tab.clickAt(box.x, box.y);
      return box.text;
    },
    /**
     * Where to click for an element. Scrolls it into view first: a long
     * phone menu scrolls, and an element above the fold reports a negative
     * y, so the click was landing outside the page and being dropped
     * silently.
     */
    async locate(finder) {
      const box = await tab.eval(
        `(() => { const el = ${finder}; if (!el) return null;
          el.scrollIntoView({ block: "center", inline: "center" });
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent }; })()`,
      );
      if (box) await sleep(120);
      return box;
    },
    async screenshot(path) {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path, Buffer.from(shot.data, "base64"));
      return path;
    },
    close() {
      ws.close();
      return fetch(`http://localhost:9222/json/close/${target.id}`);
    },
  };
  return tab;
}

/** Shuts every open page. A TV left running from a previous run keeps its
 * one-second island tick going, and keeps writing that island back over the
 * fresh one -- so a run has to start from an empty browser. */
export async function closeAllTabs() {
  const list = await (await fetch("http://localhost:9222/json/list")).json();
  for (const target of list) {
    if (target.type === "page") await fetch(`http://localhost:9222/json/close/${target.id}`);
  }
  await sleep(500);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
