// Paints a Mii's face onto a transparent canvas, which the 3D bowler maps
// onto a curved patch on the front of its head sphere. The CSS MiiAvatar
// used everywhere else in the app can't be reused here -- a DOM element
// can't live inside a WebGL scene -- so this is the same feature set
// (eyes, brows, nose, mouth, facial hair, glasses) redrawn in Canvas 2D.
//
// Everything is laid out in a 512x512 square whose centre is the middle of
// the face; the sphere patch it maps onto stretches it back over the head's
// curvature, so features are drawn slightly tighter than they read flat.

import * as THREE from "three";
import type { Mii } from "../../mii/Mii";

const SIZE = 512;
const CX = SIZE / 2;
const EYE_Y = 214;
const EYE_DX = 66;
const BROW_Y = 158;
const NOSE_Y = 272;
const MOUTH_Y = 336;

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, style: string, color: string, mirrored: boolean) {
  const flip = mirrored ? -1 : 1;
  ctx.save();
  ctx.translate(x, EYE_Y);
  ctx.scale(flip, 1);
  ctx.fillStyle = "#2a2a2a";

  switch (style) {
    case "round":
      ellipse(ctx, 0, 0, 20, 20);
      ctx.fill();
      ctx.fillStyle = color;
      ellipse(ctx, 0, 1, 11, 11);
      ctx.fill();
      break;
    case "sleepy":
      // A half-lidded eye: the lid line plus just the lower arc of the iris.
      ctx.beginPath();
      ctx.ellipse(0, 4, 20, 13, 0, Math.PI, Math.PI * 2, true);
      ctx.fill();
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#2a2a2a";
      ctx.beginPath();
      ctx.moveTo(-22, -4);
      ctx.lineTo(22, -6);
      ctx.stroke();
      ctx.fillStyle = color;
      ellipse(ctx, 0, 5, 8, 7);
      ctx.fill();
      break;
    case "angry":
      ctx.save();
      ctx.rotate(0.22);
      ellipse(ctx, 0, 0, 19, 15);
      ctx.fill();
      ctx.fillStyle = color;
      ellipse(ctx, 1, 1, 9, 9);
      ctx.fill();
      ctx.restore();
      break;
    case "wide":
      ellipse(ctx, 0, 0, 22, 25);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ellipse(ctx, 0, 0, 16, 19);
      ctx.fill();
      ctx.fillStyle = color;
      ellipse(ctx, 0, 1, 10, 11);
      ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      ellipse(ctx, 0, 1, 5, 5);
      ctx.fill();
      break;
    case "happy":
      // Upward-curving closed arc, the classic ^_^ eye.
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#2a2a2a";
      ctx.beginPath();
      ctx.arc(0, 8, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      break;
    case "star":
      drawStar(ctx, 0, 0, 5, 22, 9, color);
      break;
    default:
      ellipse(ctx, 0, 0, 17, 21);
      ctx.fill();
      ctx.fillStyle = color;
      ellipse(ctx, 0, 2, 9, 10);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ellipse(ctx, -5, -6, 4, 4);
      ctx.fill();
      break;
  }
  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  points: number,
  outer: number,
  inner: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawBrow(ctx: CanvasRenderingContext2D, x: number, style: string, color: string, mirrored: boolean) {
  if (style === "unibrow") {
    // One bar spanning both eyes, so it's drawn once rather than per side.
    if (mirrored) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(CX - EYE_DX - 30, BROW_Y - 9, EYE_DX * 2 + 60, 18);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(x, BROW_Y);
  ctx.scale(mirrored ? -1 : 1, 1);
  ctx.fillStyle = color;

  switch (style) {
    case "thick":
      ctx.fillRect(-30, -12, 60, 22);
      break;
    case "thin":
      ctx.fillRect(-28, -4, 56, 8);
      break;
    case "angled":
      ctx.beginPath();
      ctx.moveTo(-30, 4);
      ctx.lineTo(30, -14);
      ctx.lineTo(30, -2);
      ctx.lineTo(-30, 16);
      ctx.closePath();
      ctx.fill();
      break;
    case "raised":
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(0, 14, 28, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      break;
    default:
      ctx.fillRect(-28, -8, 56, 15);
      break;
  }
  ctx.restore();
}

function drawNose(ctx: CanvasRenderingContext2D, style: string, skin: string) {
  ctx.save();
  ctx.translate(CX, NOSE_Y);
  ctx.fillStyle = shade(skin, -0.16);
  ctx.strokeStyle = shade(skin, -0.3);
  ctx.lineWidth = 4;

  switch (style) {
    case "small":
      ellipse(ctx, 0, 0, 13, 10);
      ctx.fill();
      break;
    case "large":
      ellipse(ctx, 0, 0, 26, 21);
      ctx.fill();
      ctx.stroke();
      break;
    case "button":
      ellipse(ctx, 0, 0, 17, 17);
      ctx.fill();
      ctx.stroke();
      break;
    case "pointy":
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(16, 14);
      ctx.lineTo(-16, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    default:
      ellipse(ctx, 0, 0, 20, 15);
      ctx.fill();
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawMouth(ctx: CanvasRenderingContext2D, style: string) {
  ctx.save();
  ctx.translate(CX, MOUTH_Y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const lip = "#8f3a36";
  const inner = "#7a2b2b";

  switch (style) {
    case "smile":
      ctx.strokeStyle = lip;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0, -14, 34, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
      break;
    case "grin":
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(-40, -8);
      ctx.quadraticCurveTo(0, 40, 40, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-34, -6);
      ctx.lineTo(34, -6);
      ctx.lineTo(30, 6);
      ctx.lineTo(-30, 6);
      ctx.closePath();
      ctx.fill();
      break;
    case "smirk":
      ctx.strokeStyle = lip;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(-30, 4);
      ctx.quadraticCurveTo(6, 14, 30, -12);
      ctx.stroke();
      break;
    case "surprised":
      ctx.fillStyle = inner;
      ellipse(ctx, 0, 0, 20, 26);
      ctx.fill();
      break;
    case "frown":
      ctx.strokeStyle = lip;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(0, 26, 32, Math.PI * 1.22, Math.PI * 1.78);
      ctx.stroke();
      break;
    case "tongue":
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(-36, -8);
      ctx.quadraticCurveTo(0, 34, 36, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#e2707a";
      ellipse(ctx, 0, 16, 17, 14);
      ctx.fill();
      break;
    case "flat":
      ctx.strokeStyle = lip;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(-30, 0);
      ctx.lineTo(30, 0);
      ctx.stroke();
      break;
    default:
      ctx.strokeStyle = lip;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(-26, -2);
      ctx.quadraticCurveTo(0, 10, 26, -2);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawFacialHair(ctx: CanvasRenderingContext2D, style: string, color: string) {
  if (style === "none") return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(CX, 0);

  switch (style) {
    case "mustache":
      ctx.beginPath();
      ctx.moveTo(-44, MOUTH_Y - 34);
      ctx.quadraticCurveTo(0, MOUTH_Y - 12, 44, MOUTH_Y - 34);
      ctx.quadraticCurveTo(0, MOUTH_Y - 4, -44, MOUTH_Y - 34);
      ctx.fill();
      break;
    case "goatee":
      ctx.beginPath();
      ctx.moveTo(-24, MOUTH_Y + 20);
      ctx.quadraticCurveTo(0, MOUTH_Y + 78, 24, MOUTH_Y + 20);
      ctx.quadraticCurveTo(0, MOUTH_Y + 34, -24, MOUTH_Y + 20);
      ctx.fill();
      break;
    case "beard":
      ctx.beginPath();
      ctx.moveTo(-110, MOUTH_Y - 62);
      ctx.quadraticCurveTo(-96, MOUTH_Y + 116, 0, MOUTH_Y + 128);
      ctx.quadraticCurveTo(96, MOUTH_Y + 116, 110, MOUTH_Y - 62);
      ctx.quadraticCurveTo(60, MOUTH_Y + 4, 0, MOUTH_Y - 6);
      ctx.quadraticCurveTo(-60, MOUTH_Y + 4, -110, MOUTH_Y - 62);
      ctx.fill();
      break;
    case "soulpatch":
      ctx.fillRect(-13, MOUTH_Y + 22, 26, 26);
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawGlasses(ctx: CanvasRenderingContext2D, style: string) {
  if (style === "none") return;
  ctx.save();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#3a3a3a";

  const left = CX - EYE_DX;
  const right = CX + EYE_DX;

  if (style === "sunglasses") {
    ctx.fillStyle = "rgba(24, 26, 34, 0.92)";
    ellipse(ctx, left, EYE_Y, 42, 32);
    ctx.fill();
    ellipse(ctx, right, EYE_Y, 42, 32);
    ctx.fill();
  } else if (style === "square") {
    ctx.strokeRect(left - 38, EYE_Y - 28, 76, 56);
    ctx.strokeRect(right - 38, EYE_Y - 28, 76, 56);
  } else if (style === "star") {
    drawStar(ctx, left, EYE_Y, 5, 44, 20, "rgba(244, 163, 0, 0.55)");
    drawStar(ctx, right, EYE_Y, 5, 44, 20, "rgba(244, 163, 0, 0.55)");
  } else {
    ellipse(ctx, left, EYE_Y, 38, 34);
    ctx.stroke();
    ellipse(ctx, right, EYE_Y, 38, 34);
    ctx.stroke();
  }

  // Bridge, plus temples running off toward the ears.
  ctx.beginPath();
  ctx.moveTo(left + 38, EYE_Y - 4);
  ctx.lineTo(right - 38, EYE_Y - 4);
  ctx.moveTo(left - 42, EYE_Y - 6);
  ctx.lineTo(left - 92, EYE_Y - 12);
  ctx.moveTo(right + 42, EYE_Y - 6);
  ctx.lineTo(right + 92, EYE_Y - 12);
  ctx.stroke();
  ctx.restore();
}

/** Lighten (amount > 0) or darken (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  const to = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const r = Math.round((num >> 16) + (to - (num >> 16)) * t);
  const g = Math.round(((num >> 8) & 255) + (to - ((num >> 8) & 255)) * t);
  const b = Math.round((num & 255) + (to - (num & 255)) * t);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * A transparent texture with just the Mii's features on it. The head sphere
 * underneath supplies the skin colour, so this only draws what sits on top.
 */
export function createMiiFaceTexture(mii: Mii): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;

  // Cheek blush, a subtle nod to the Wii's own Mii shading.
  const blush = ctx.createRadialGradient(CX - 118, MOUTH_Y - 30, 4, CX - 118, MOUTH_Y - 30, 62);
  blush.addColorStop(0, "rgba(226, 122, 122, 0.30)");
  blush.addColorStop(1, "rgba(226, 122, 122, 0)");
  ctx.fillStyle = blush;
  ctx.fillRect(CX - 190, MOUTH_Y - 100, 150, 150);
  const blush2 = ctx.createRadialGradient(CX + 118, MOUTH_Y - 30, 4, CX + 118, MOUTH_Y - 30, 62);
  blush2.addColorStop(0, "rgba(226, 122, 122, 0.30)");
  blush2.addColorStop(1, "rgba(226, 122, 122, 0)");
  ctx.fillStyle = blush2;
  ctx.fillRect(CX + 40, MOUTH_Y - 100, 150, 150);

  drawBrow(ctx, CX - EYE_DX, mii.eyebrowStyle, mii.hairColor, false);
  drawBrow(ctx, CX + EYE_DX, mii.eyebrowStyle, mii.hairColor, true);
  drawEye(ctx, CX - EYE_DX, mii.eyeStyle, mii.eyeColor, false);
  drawEye(ctx, CX + EYE_DX, mii.eyeStyle, mii.eyeColor, true);
  drawNose(ctx, mii.noseStyle, mii.skinTone);
  drawFacialHair(ctx, mii.facialHair, mii.hairColor);
  drawMouth(ctx, mii.mouthStyle);
  drawGlasses(ctx, mii.glassesStyle);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
