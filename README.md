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
animation). All 12 channel tiles are currently "Coming soon" placeholders —
the Wii Sports-style mini-games, Mii avatar channel, and two-player support
are not built yet.

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
