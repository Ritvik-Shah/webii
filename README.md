# Webii

An original homage to the Wii Menu: a console-style home screen on a big display,
with your phone acting as the Wiimote (motion + pointer). Not Dolphin emulation
or a real Wiimote driver — a from-scratch web app using the phone's built-in
motion sensors.

Live: https://webii.ritvikshah.workers.dev

## How it works

- **Screen** (open on a laptop/TV/tablet browser): shows a room code + QR code,
  then a 4x3 Wii Menu-style channel grid once a phone joins.
- **Controller** (open on a phone, or scan the QR): after a tap-to-enable motion
  permission prompt, tilts move a cursor on the screen and an on-screen A/B/HOME
  button pad sends input.
- **Backend**: a single Cloudflare Worker with a `GameRoom` Durable Object per
  room code, using the WebSocket Hibernation API to relay JSON messages between
  the screen and controller with low latency and no server to manage.

```
Phone (Controller)                     Laptop/TV (Screen)
  motion + touch UI                      Wii Menu shell + games
        |  WebSocket                            |  WebSocket
        +--------------> Durable Object <--------+
                         "GameRoom" (per room code)
```

## Status

Phases 0-3 of the build plan are done: scaffold + deploy, pairing/relay
plumbing, the phone controller (motion permission, tilt-to-point, touch
buttons), and the Wii Menu home screen shell (hover-wobble, chimes, launch
animation).

**Up to four phones can share a room.** The lobby shows a seat per player
that fills in as people join, each phone is assigned a player number it
keeps across reconnects, and every message it sends is stamped with that
number by the room so the screen always knows who did what.

Playable channels: **Bowling**, Shooting Range, Tanks!, Charge!, the Mii
Channel (full creator + plaza), the NES Channel and the DS Channel. The
remaining tiles are still "Coming soon" placeholders.

How the games handle multiple players:

- **Bowling** — a scorecard each, one shared frame counter, the lane passing
  along after every completed frame. Whoever is up bowls with their own Mii
  and a ball in their colour; everyone waiting stands on the neighbouring
  lanes.
- **Shooting Range** and **Charge!** — take turns. Each player plays a full
  round, then the scores are ranked. Charge!'s turn passes when that
  player's clock runs out.
- **Tanks!** — solo is the level-clearing campaign it always was; with two
  or more players it becomes a free-for-all deathmatch where everyone drives
  at once and the most kills in 90 seconds wins.

Bowling is a real 3D scene (three.js): a regulation-dimension lane with
gutters, pin deck, pit, masking units and neighbouring lanes, Miis rebuilt
as 3D characters, ball/pin physics, camera cuts that follow the ball and cut
to the deck on impact, and a full ten-frame scorecard. It's the only channel
that pulls in three.js, so it's lazy-loaded and the rest of the app stays as
light as it was before.

## Local development

```sh
npm install
npm run dev       # single dev server for both the Worker and the React app
```

Open the printed local URL on a laptop for the screen, and on a phone on the
same network (or via a tunnel) for the controller — motion sensors require a
real device, they don't work in desktop dev tools' device emulation.

## Deploy

```sh
npm run build
npx wrangler deploy
```

Requires a Cloudflare account (`npx wrangler login` first if you haven't).
