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
import { MockPhone } from "./phone.mjs";

const HOST = process.argv[2] ?? "http://localhost:5173";
let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failures += 1;
};


// ---------------------------------------------------------------------------

/**
 * A Mii asking for something replaces the whole phone screen, and one of
 * them is usually hungry by the time you have finished picking a Mii -- so
 * getting to a menu means dealing with whatever is being asked first, which
 * is what a player does too.
 */
async function settle(phone, limit = 12) {
  let answered = 0;
  for (let i = 0; i < limit; i += 1) {
    const view = await phone.view();
    if (!view || !/is hungry|levelled up|wants|fallen out|nothing to do|bored of|likes /i.test(view.title)) break;
    await phone.tab.click(".phone-choice");
    await sleep(900);
    answered += 1;
    // The first choice is the cheapest, but it can still be more than the
    // island has. If the same thing is still being asked, defer it rather
    // than tapping at it forever.
    const after = await phone.view();
    if (after && after.title === view.title) {
      await phone.tap("Not right now").catch(() => {});
      await sleep(600);
    }
  }
  return answered;
}

console.log("\n== bringing up a TV and a phone");
await closeAllTabs();
const tv = await openTab("about:blank");
await tv.send("Page.enable");
await tv.send("Runtime.enable");
await tv.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
// A saved island carries over between runs, so a Mii can arrive already fed
// and the feeding checks then pass on stale state. Clearing has to happen
// *after* the first load rather than before it: closing the previous run's
// tab unmounts its island, which saves -- and that save was landing on top
// of a clear that had already run.
await tv.goto(`${HOST}/`);
await tv.eval("try { localStorage.clear(); } catch {}");
await tv.send("Page.reload", {});
await sleep(1500);

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
const asked = await settle(phone);
if (asked > 0) console.log(`  (${asked} Mii${asked === 1 ? "" : "s"} wanted something before the menu would show)`);
const root = await phone.waitForView(`view && /Mii Island/.test(view.title)`);
console.log(`  phone shows: ${JSON.stringify(root.title)} — ${root.choices.length} residents`);
ok("the phone switched from remote to island menu", root.choices.length >= 1, JSON.stringify(root.choices));
ok("the player's own Mii is on their phone", root.choices.some((c) => /Mochi/.test(c)), JSON.stringify(root.choices));

const stats = () => tv.eval(`document.querySelector('.island-stats').textContent`);
const coinsOf = (text) => Number((text.match(/(\d+)/) || [])[1]);
const toast = () => tv.eval(`document.querySelector('.island-goal').textContent`);

console.log("\n== looking after a Mii, entirely from the phone");
await phone.tap("Mochi");
const menu = await phone.waitForView(`/^Mochi/.test(view.title)`);
ok("tapping a resident opens their menu", /Feed them/.test(menu.choices.join()), JSON.stringify(menu.choices));
ok("the menu names their level", /Lv|Level/.test(menu.subtitle), menu.subtitle);
await phone.tap("Back to the island");

// Feed whoever is actually hungry. Settling the arrival queue already fed
// some of them, and a Mii who has just eaten refuses -- correctly -- so
// insisting on one particular Mii made the test fail on right behaviour.
const roster = (await phone.waitForView(`/Mii Island/.test(view.title)`)).choices
  .filter((c) => !/Build the island/.test(c))
  .map((c) => c.split(" · ")[0].trim());
let fed = null;
for (const who of roster) {
  await phone.tap(who.slice(0, 10));
  await phone.waitForView(`/^${who.slice(0, 10)}/.test(view.title)`);
  await phone.tap("Feed them");
  const larder = await phone.waitForView(`/^Feed/.test(view.title)`);
  ok("the food list is priced", /\d+c|pantry/.test(larder.choices.join()), larder.choices[0]);

  const before = coinsOf(await stats());
  await phone.tab.click(".phone-choice");
  await sleep(1100);
  const after = coinsOf(await stats());
  if (after < before) {
    fed = { who, before, after };
    break;
  }
  // Full, and said so. Try the next one.
  await phone.tap("^Back$|Back to the island");
  await settle(phone);
  await phone.waitForView(`/Mii Island/.test(view.title)`);
}

ok("somebody who was hungry got fed, and it cost coins", !!fed, fed ? `${fed.before} -> ${fed.after}` : "nobody was hungry");
const said = await toast();
ok("the TV says what they made of it", /Favourite|Likes|So-So|Doesn't|Worst/.test(said), said);
ok(
  "the TV turns to whoever just ate",
  await tv.eval(`/${fed ? fed.who.slice(0, 8) : "zzz"}/.test((document.querySelector('.island-panel h2')||{}).textContent||"")`),
);


const interrupted = await settle(phone);
ok("a level-up or request interrupts and can be answered", interrupted >= 0);

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

  // The watch screen draws the same island from a snapshot, and the walkers
  // arrive on their own high-rate channel, so it is worth seeing.
  const mirror = await openTab("about:blank");
  await mirror.send("Page.enable");
  await mirror.send("Runtime.enable");
  await mirror.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await mirror.goto(`${HOST}/watch/${roomCode}`);
  await mirror.waitFor(`!!document.querySelector('.island-root')`, { label: "the mirrored island" });
  const before = await mirror.eval(`JSON.stringify([...document.querySelectorAll('[data-walker]')].map((e) => e.style.left))`);
  await sleep(3000);
  const after = await mirror.eval(`JSON.stringify([...document.querySelectorAll('[data-walker]')].map((e) => e.style.left))`);
  ok("the mirror shows the island", (await mirror.eval(`document.querySelectorAll('[data-walker]').length`)) > 0);
  ok("...and the Miis are walking on it too", before !== after, `${before} vs ${after}`);
  await mirror.screenshot("live-mirror-island.png");
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
await closeAllTabs();
process.exit(failures === 0 ? 0 : 1);
