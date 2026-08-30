// The 3D bowling alley: lane, gutters, pin deck, pit, masking units,
// neighbouring lanes with their own Miis, ceiling lights, ball return, and
// the camera rig that cuts between shots the way the real game does.
//
// Everything here is built from three.js primitives plus procedurally
// painted canvas textures -- no downloaded models or images, so nothing
// needs to ship in the repo and nothing is lifted from Nintendo's game.

import * as THREE from "three";
import type { Mii } from "../../mii/Mii";
import { randomMii } from "../../mii/Mii";
import {
  APPROACH_LENGTH,
  BALL_RADIUS,
  DECK_BACK_Z,
  GUTTER_DEPTH,
  GUTTER_WIDTH,
  HEAD_PIN_Z,
  LANE_HALF_WIDTH,
  LANE_PITCH,
  PIN_HEIGHT,
  PIN_LAYOUT,
  PIN_RADIUS,
} from "./constants";
import { createMiiBowler, NEUTRAL_POSE, type BowlerPose, type MiiBowler } from "./miiBowler";
import { shade } from "./miiFace";
import type { Simulation } from "./physics";

const LANE_TOTAL_LENGTH = -DECK_BACK_Z;
const CEILING_Y = 4.3;
const SIDE_WALL_X = 7.4;
const BACK_WALL_Z = DECK_BACK_Z - 1.6;
/** Half-width of the whole bank of five lanes, including gutters and the
 * capping boards between them -- where the carpet starts. */
const LANE_BED_HALF_WIDTH = 2 * LANE_PITCH + LANE_HALF_WIDTH + GUTTER_WIDTH + 0.21;

export type CameraShot = "intro" | "aim" | "lineup" | "release" | "follow" | "pins" | "result" | "gutter";

/** The aiming guide runs the full length of the lane, so the line can be
 * read all the way to the pins -- which is the whole point of the Up-button
 * close-up view. */
const GUIDE_LENGTH = -HEAD_PIN_Z - 0.5;
const GUIDE_DASH_COUNT = 46;

export interface SceneView {
  shot: CameraShot;
  /** Index into the `miis` the scene was built with: who is bowling now.
   * The others go and stand on the neighbouring lanes. */
  activeIndex: number;
  /** The lane-x line being played: where the ball sits in the bowler's hand,
   * where the aiming guide is drawn, and where the ball is released. The Mii
   * is offset sideways from it so its bowling hand lands on the line. */
  bowlerX: number;
  /** Aim angle in radians, used to point the aiming guide. */
  aimAngle: number;
  /** Show the dashed aiming guide down the lane. */
  showGuide: boolean;
  /** 0 = rack fully up, 1 = sweeper fully across the deck. */
  sweeper: number;
  pose: BowlerPose;
}

export interface BowlingScene {
  render: (dt: number, sim: Simulation, view: SceneView) => void;
  /** Snap the camera to the current shot instead of easing, for hard cuts. */
  cutCamera: () => void;
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

function makeTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Wood planks running down-lane, with board seams and grain. `boards` is
 * how many strips span the texture's width. */
function paintBoards(ctx: CanvasRenderingContext2D, w: number, h: number, boards: number, base: string, alt: string) {
  const boardWidth = w / boards;
  for (let i = 0; i < boards; i++) {
    ctx.fillStyle = i % 2 === 0 ? base : alt;
    ctx.fillRect(i * boardWidth, 0, boardWidth + 1, h);
    // Seam between boards.
    ctx.fillStyle = "rgba(70, 44, 20, 0.5)";
    ctx.fillRect(i * boardWidth, 0, 1.2, h);
  }
  // Grain: long, faint, slightly wandering streaks.
  ctx.lineWidth = 1;
  for (let i = 0; i < boards * 10; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 40 + Math.random() * 260;
    ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? "255,235,205" : "96,62,30"}, ${0.03 + Math.random() * 0.06})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 6, y + len / 2, x + (Math.random() - 0.5) * 10, y + len);
    ctx.stroke();
  }
}

/** The playing surface: 39 boards, the seven approach arrows, pin spots,
 * and a sheen of lane oil over the front half. Canvas top is the pin deck. */
function createLaneTexture(): THREE.CanvasTexture {
  const W = 320;
  const H = 3072;
  return makeTexture(W, H, (ctx) => {
    paintBoards(ctx, W, H, 39, "#d9a95f", "#cf9d51");

    // Lane oil: a glossy conditioned band over the front two-thirds.
    const oil = ctx.createLinearGradient(0, H, 0, H * 0.28);
    oil.addColorStop(0, "rgba(255, 246, 214, 0.20)");
    oil.addColorStop(0.55, "rgba(255, 246, 214, 0.12)");
    oil.addColorStop(1, "rgba(255, 246, 214, 0)");
    ctx.fillStyle = oil;
    ctx.fillRect(W * 0.13, H * 0.28, W * 0.74, H * 0.72);

    // The seven targeting arrows, ~14 ft down the lane, in a shallow V.
    const arrowV = 4.27 / LANE_TOTAL_LENGTH;
    ctx.fillStyle = "rgba(92, 56, 22, 0.85)";
    for (let i = -3; i <= 3; i++) {
      const depth = arrowV + Math.abs(i) * 0.0125;
      const cx = W / 2 + (i * W) / 11.5;
      const cy = H * (1 - depth);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 26);
      ctx.lineTo(cx + 9, cy + 22);
      ctx.lineTo(cx - 9, cy + 22);
      ctx.closePath();
      ctx.fill();
    }

    // Faint spots marking where each pin stands.
    ctx.strokeStyle = "rgba(90, 56, 22, 0.5)";
    ctx.lineWidth = 2;
    for (const pin of PIN_LAYOUT) {
      const cx = W / 2 + (pin.x / (LANE_HALF_WIDTH * 2)) * W;
      const cy = H * (1 - -pin.z / LANE_TOTAL_LENGTH);
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Foul line at the very near end.
    ctx.fillStyle = "#8f2f2f";
    ctx.fillRect(0, H - 7, W, 7);
  });
}

/** White pin body with the two red neck stripes. Lathe v=0 is the base. */
function createPinTexture(): THREE.CanvasTexture {
  const W = 96;
  const H = 384;
  return makeTexture(W, H, (ctx) => {
    ctx.fillStyle = "#f7f5ef";
    ctx.fillRect(0, 0, W, H);
    // Canvas top is the pin's crown, so stripes sit near the top.
    ctx.fillStyle = "#cf3030";
    ctx.fillRect(0, H * 0.16, W, H * 0.045);
    ctx.fillRect(0, H * 0.235, W, H * 0.045);
    // A soft vertical shade so the cylinder doesn't read as flat white.
    const shadeGrad = ctx.createLinearGradient(0, 0, W, 0);
    shadeGrad.addColorStop(0, "rgba(60, 60, 80, 0.22)");
    shadeGrad.addColorStop(0.35, "rgba(255, 255, 255, 0)");
    shadeGrad.addColorStop(0.75, "rgba(255, 255, 255, 0.12)");
    shadeGrad.addColorStop(1, "rgba(60, 60, 80, 0.24)");
    ctx.fillStyle = shadeGrad;
    ctx.fillRect(0, 0, W, H);
  });
}

/** Bowling-centre carpet: a busy dark pattern, like every alley ever built. */
function createCarpetTexture(): THREE.CanvasTexture {
  const S = 256;
  const texture = makeTexture(S, S, (ctx) => {
    ctx.fillStyle = "#231a3a";
    ctx.fillRect(0, 0, S, S);
    const colors = ["#3d2a63", "#1f6f8b", "#8b2f5e", "#c8963a"];
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.5;
      ctx.save();
      ctx.translate(Math.random() * S, Math.random() * S);
      ctx.rotate(Math.random() * Math.PI);
      ctx.fillRect(-16, -3, 32, 6);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 26);
  return texture;
}

/** The masking unit above each pit -- the big colourful panel with the lane
 * number that you stare at all game. */
function createMaskingTexture(laneNumber: number, accent: string): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  return makeTexture(W, H, (ctx) => {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, shade(accent, 0.3));
    bg.addColorStop(1, shade(accent, -0.45));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 10;
    for (let i = -2; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 64, 0);
      ctx.lineTo(i * 64 + 90, H);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(12, 14, 24, 0.55)";
    ctx.fillRect(W / 2 - 68, H / 2 - 68, 136, 136);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 108px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(laneNumber), W / 2, H / 2 + 6);
  });
}

/**
 * A tiny environment probe: a gradient sky-and-floor sphere run through
 * PMREM, giving the ball its glossy highlights and the lane its sheen
 * without loading an HDRI.
 */
function createEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const gradient = makeTexture(4, 128, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#dfe9ff");
    grad.addColorStop(0.42, "#8fa6c8");
    grad.addColorStop(0.52, "#4a4256");
    grad.addColorStop(1, "#171420");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 128);
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(12, 24, 16),
    new THREE.MeshBasicMaterial({ map: gradient, side: THREE.BackSide }),
  );
  envScene.add(dome);
  // Two bright bars standing in for the ceiling strip lights, so the ball
  // picks up moving highlights as it rolls.
  for (const x of [-3, 3]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    light.position.set(x, 5, -4);
    envScene.add(light);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  gradient.dispose();
  return target.texture;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** The classic bowling-pin silhouette, as a lathe profile from base to crown. */
function pinGeometry(): THREE.LatheGeometry {
  const h = PIN_HEIGHT;
  const profile: Array<[number, number]> = [
    [0, 0],
    [0.052, 0],
    [0.055, 0.035],
    [0.049, 0.075],
    [0.0605, 0.16],
    [0.058, 0.235],
    [0.042, 0.315],
    [0.031, 0.4],
    [0.028, 0.52],
    [0.03, 0.62],
    [0.038, 0.74],
    [0.041, 0.83],
    [0.034, 0.92],
    [0.019, 0.985],
    [0, 1],
  ];
  const points = profile.map(([r, t]) => new THREE.Vector2(r * (PIN_RADIUS / 0.0605), t * h));
  return new THREE.LatheGeometry(points, 28);
}

function ballMesh(color: string, envMap: THREE.Texture): { group: THREE.Group; material: THREE.MeshPhysicalMaterial } {
  const group = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness: 0.09,
      metalness: 0.0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMap,
      envMapIntensity: 1.1,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 44, 32), material);
  body.castShadow = true;
  group.add(body);

  // Three finger holes, arranged like a real drilled ball.
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x14141a, roughness: 0.9 });
  const holes: Array<[number, number]> = [
    [0, 0],
    [-0.34, 0.42],
    [0.34, 0.42],
  ];
  for (const [dx, dy] of holes) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 0.05, 12), holeMat);
    const dir = new THREE.Vector3(dx, 1, dy).normalize();
    hole.position.copy(dir).multiplyScalar(BALL_RADIUS - 0.012);
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    group.add(hole);
  }
  return { group, material };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export function createBowlingScene(container: HTMLElement, miis: Mii[]): BowlingScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#131b33");
  scene.fog = new THREE.Fog("#1b2440", 18, 38);

  const envMap = createEnvironment(renderer);
  scene.environment = envMap;

  const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.05, 90);
  camera.position.set(0, 1.6, 2.6);

  const disposables: Array<{ dispose: () => void }> = [];
  function track<T extends { dispose: () => void }>(item: T): T {
    disposables.push(item);
    return item;
  }

  // --- lighting ---------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0xd8e6ff, 0x4a3a26, 1.05));

  const key = new THREE.DirectionalLight(0xfff4e0, 1.35);
  key.position.set(3.2, 6.4, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 22;
  key.shadow.camera.left = -3.5;
  key.shadow.camera.right = 3.5;
  key.shadow.camera.top = 3.5;
  key.shadow.camera.bottom = -3.5;
  key.shadow.bias = -0.0012;
  // Aim the key light at the approach, where the bowler and their shadow are.
  key.target.position.set(0, 0, -1.5);
  scene.add(key);
  scene.add(key.target);

  // A second shadow-casting light over the deck, so the pin scatter reads.
  const deckLight = new THREE.DirectionalLight(0xffffff, 0.85);
  deckLight.position.set(1.2, 4.2, HEAD_PIN_Z + 3.4);
  deckLight.castShadow = true;
  deckLight.shadow.mapSize.set(1024, 1024);
  deckLight.shadow.camera.near = 0.5;
  deckLight.shadow.camera.far = 9;
  deckLight.shadow.camera.left = -2.4;
  deckLight.shadow.camera.right = 2.4;
  deckLight.shadow.camera.top = 2.4;
  deckLight.shadow.camera.bottom = -2.4;
  deckLight.shadow.bias = -0.0006;
  deckLight.target.position.set(0, 0, HEAD_PIN_Z - 0.4);
  scene.add(deckLight);
  scene.add(deckLight.target);

  // --- floor / carpet ---------------------------------------------------
  const carpetTex = track(createCarpetTexture());
  const carpetMat = track(new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95 }));
  // Carpet runs down both sides of the bank of lanes and across the seating
  // area behind the approach, but deliberately NOT under the lane bed: the
  // lane is drawn semi-transparent over mirrored pins, and a carpet plane
  // there would sit between the camera and those reflections.
  const carpetSideWidth = SIDE_WALL_X - LANE_BED_HALF_WIDTH;
  for (const side of [-1, 1]) {
    const strip = new THREE.Mesh(track(new THREE.PlaneGeometry(carpetSideWidth, 40)), carpetMat);
    strip.scale.setScalar(1);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(side * (LANE_BED_HALF_WIDTH + carpetSideWidth / 2), -0.02, -10);
    strip.receiveShadow = true;
    scene.add(strip);
  }
  const backCarpet = new THREE.Mesh(track(new THREE.PlaneGeometry(SIDE_WALL_X * 2, 16)), carpetMat);
  backCarpet.rotation.x = -Math.PI / 2;
  backCarpet.position.set(0, -0.02, APPROACH_LENGTH + 8);
  backCarpet.receiveShadow = true;
  scene.add(backCarpet);

  // Dark backing under the whole lane bed, so the 10% of light that passes
  // through the lane surface lands on something rather than the fog.
  const underLane = new THREE.Mesh(
    track(new THREE.PlaneGeometry(LANE_BED_HALF_WIDTH * 2, LANE_TOTAL_LENGTH + APPROACH_LENGTH)),
    track(new THREE.MeshBasicMaterial({ color: 0x0a1020 })),
  );
  underLane.rotation.x = -Math.PI / 2;
  underLane.position.set(0, -0.55, (APPROACH_LENGTH - LANE_TOTAL_LENGTH) / 2);
  scene.add(underLane);

  // --- lane surfaces ----------------------------------------------------
  const laneTex = track(createLaneTexture());
  const laneMat = track(
    new THREE.MeshStandardMaterial({
      map: laneTex,
      roughness: 0.22,
      metalness: 0.0,
      envMapIntensity: 0.7,
      // Just transparent enough to let the mirrored pins and ball underneath
      // show through as reflections in the polished boards.
      transparent: true,
      opacity: 0.88,
    }),
  );
  const lane = new THREE.Mesh(track(new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, LANE_TOTAL_LENGTH)), laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0, -LANE_TOTAL_LENGTH / 2);
  lane.receiveShadow = true;
  // Drawn after the mirrored geometry beneath it, so the reflections blend
  // through the boards rather than being sorted on top of them.
  lane.renderOrder = 2;
  scene.add(lane);

  // Everything added to this group is mirrored through the lane surface by
  // the negative Y scale, which is what turns a copied position + rotation
  // into a correct reflection with no per-object maths.
  const reflections = new THREE.Group();
  reflections.scale.set(1, -1, 1);
  scene.add(reflections);

  /** A dim, double-sided copy of a material for use in the reflection group
   * (the mirror flips winding, so single-sided faces would vanish). */
  function reflectionMaterial(base: THREE.Material, opacity: number): THREE.Material {
    const mat = base.clone();
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    return track(mat);
  }

  const approachTex = track(
    makeTexture(320, 640, (ctx) => {
      paintBoards(ctx, 320, 640, 60, "#b98a4a", "#b08243");
      ctx.fillStyle = "rgba(20, 14, 8, 0.18)";
      ctx.fillRect(0, 0, 320, 640);
    }),
  );
  const approach = new THREE.Mesh(
    track(new THREE.PlaneGeometry(LANE_BED_HALF_WIDTH * 2, APPROACH_LENGTH)),
    track(new THREE.MeshStandardMaterial({ map: approachTex, roughness: 0.5 })),
  );
  approach.rotation.x = -Math.PI / 2;
  approach.position.set(0, 0.001, APPROACH_LENGTH / 2);
  approach.receiveShadow = true;
  scene.add(approach);

  const foulLine = new THREE.Mesh(
    track(new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2 + GUTTER_WIDTH * 2, 0.05)),
    track(new THREE.MeshStandardMaterial({ color: 0x2c2c34, roughness: 0.6 })),
  );
  foulLine.rotation.x = -Math.PI / 2;
  foulLine.position.set(0, 0.004, 0.03);
  scene.add(foulLine);

  // --- gutters ----------------------------------------------------------
  const gutterMat = track(new THREE.MeshStandardMaterial({ color: 0x1b2c50, roughness: 0.35, metalness: 0.25 }));
  const capMat = track(new THREE.MeshStandardMaterial({ color: 0x0f1830, roughness: 0.6 }));
  for (const side of [-1, 1]) {
    const gutter = new THREE.Mesh(track(new THREE.BoxGeometry(GUTTER_WIDTH, GUTTER_DEPTH, LANE_TOTAL_LENGTH)), gutterMat);
    gutter.position.set(side * (LANE_HALF_WIDTH + GUTTER_WIDTH / 2), -GUTTER_DEPTH / 2, -LANE_TOTAL_LENGTH / 2);
    gutter.receiveShadow = true;
    scene.add(gutter);

    // The capping board between this lane and the next one over.
    const capping = new THREE.Mesh(track(new THREE.BoxGeometry(0.34, 0.09, LANE_TOTAL_LENGTH)), capMat);
    capping.position.set(side * (LANE_HALF_WIDTH + GUTTER_WIDTH + 0.17), 0.045, -LANE_TOTAL_LENGTH / 2);
    scene.add(capping);
  }

  // --- pit, sweeper, masking unit ---------------------------------------
  const pit = new THREE.Mesh(
    track(new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + GUTTER_WIDTH * 2, 1.4, 1.7)),
    track(new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 1 })),
  );
  pit.position.set(0, -0.72, DECK_BACK_Z - 0.85);
  scene.add(pit);

  const sweeper = new THREE.Mesh(
    track(new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + 0.1, 0.34, 0.07)),
    track(new THREE.MeshStandardMaterial({ color: 0x1d2740, roughness: 0.5, metalness: 0.4 })),
  );
  sweeper.position.set(0, 1.4, HEAD_PIN_Z - 1.2);
  scene.add(sweeper);

  function buildMaskingUnit(centerX: number, laneNumber: number, accent: string) {
    const unit = new THREE.Mesh(
      track(new THREE.PlaneGeometry(LANE_PITCH - 0.06, 2.1)),
      track(new THREE.MeshStandardMaterial({ map: track(createMaskingTexture(laneNumber, accent)), roughness: 0.75 })),
    );
    unit.position.set(centerX, 1.55, BACK_WALL_Z + 0.02);
    scene.add(unit);
  }

  // --- walls & ceiling --------------------------------------------------
  const wallMat = track(new THREE.MeshStandardMaterial({ color: 0x2b3860, roughness: 0.9 }));
  const backWall = new THREE.Mesh(track(new THREE.PlaneGeometry(SIDE_WALL_X * 2, 6)), wallMat);
  backWall.position.set(0, 2.6, BACK_WALL_Z);
  scene.add(backWall);

  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(34, 5.4)), wallMat);
    wall.position.set(side * SIDE_WALL_X, 2.3, -9);
    wall.rotation.y = side * -Math.PI / 2;
    scene.add(wall);
  }

  const ceiling = new THREE.Mesh(
    track(new THREE.PlaneGeometry(SIDE_WALL_X * 2, 34)),
    track(new THREE.MeshStandardMaterial({ color: 0x252f4d, roughness: 1, emissive: 0x161d33 })),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, CEILING_Y, -9);
  scene.add(ceiling);

  const stripMat = track(new THREE.MeshBasicMaterial({ color: 0xfff6e2 }));
  for (let i = 0; i < 7; i++) {
    const z = 1.5 - i * 3.1;
    for (const x of [-3.4, 3.4]) {
      const strip = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 0.06, 2.1)), stripMat);
      strip.position.set(x, CEILING_Y - 0.06, z);
      scene.add(strip);
    }
    // Sparse fill lights so the alley isn't lit from one direction only.
    if (i % 2 === 0) {
      const point = new THREE.PointLight(0xfff0d8, 22, 14, 2);
      point.position.set(0, CEILING_Y - 0.5, z);
      scene.add(point);
    }
  }

  // --- ball return ------------------------------------------------------
  const returnX = LANE_HALF_WIDTH + GUTTER_WIDTH + 0.21;
  const returnBody = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.42, 0.6, 1.7)),
    track(new THREE.MeshStandardMaterial({ color: 0x25304d, roughness: 0.4, metalness: 0.3 })),
  );
  returnBody.position.set(returnX, 0.3, 1.55);
  returnBody.castShadow = true;
  returnBody.receiveShadow = true;
  scene.add(returnBody);

  const rackBallGeo = track(new THREE.SphereGeometry(BALL_RADIUS, 24, 18));
  const rackColors = ["#c43b3b", "#2f6fd0", "#f4a300", "#3bb54a"];
  rackColors.forEach((color, i) => {
    const rackBall = new THREE.Mesh(
      rackBallGeo,
      track(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: 0.12, clearcoat: 1, envMap, envMapIntensity: 0.9 })),
    );
    rackBall.position.set(returnX, 0.6 + BALL_RADIUS * 0.7, 0.98 + i * 0.24);
    rackBall.castShadow = true;
    scene.add(rackBall);
  });

  // --- pins -------------------------------------------------------------
  const pinGeo = track(pinGeometry());
  const pinMat = track(
    new THREE.MeshStandardMaterial({ map: track(createPinTexture()), roughness: 0.28, metalness: 0.02, envMapIntensity: 0.6 }),
  );
  const pinReflectionMat = reflectionMaterial(pinMat, 0.34);
  const pinMeshes = PIN_LAYOUT.map(() => {
    const pin = new THREE.Mesh(pinGeo, pinMat);
    pin.castShadow = true;
    pin.receiveShadow = true;
    scene.add(pin);
    return pin;
  });
  const pinReflections = PIN_LAYOUT.map(() => {
    const mirrored = new THREE.Mesh(pinGeo, pinReflectionMat);
    mirrored.renderOrder = 1;
    reflections.add(mirrored);
    return mirrored;
  });

  // --- player ball ------------------------------------------------------
  // Darker than the Mii's shirt it's derived from: at the ready pose the ball
  // sits right against the torso, and an exact colour match made it vanish.
  const ballColorFor = (index: number) => shade(miis[index % miis.length].shirtColor, -0.32);
  const { group: ball, material: ballMaterial } = ballMesh(ballColorFor(0), envMap);
  scene.add(ball);
  const ballReflectionMat = track(
    new THREE.MeshBasicMaterial({ color: new THREE.Color(ballColorFor(0)), transparent: true, opacity: 0.3, depthWrite: false }),
  );
  const ballReflection = new THREE.Mesh(track(new THREE.SphereGeometry(BALL_RADIUS, 28, 20)), ballReflectionMat);
  ballReflection.renderOrder = 1;
  reflections.add(ballReflection);
  ball.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      track(child.geometry);
      track(child.material as THREE.Material);
    }
  });

  // --- bowlers ----------------------------------------------------------
  // One per player, all built up front: whoever is up stands on this lane
  // and the rest wait on the neighbouring ones, so a four-player game looks
  // like four friends at the alley rather than one Mii being recoloured.
  const bowlers = miis.map((playerMii) => {
    const built = createMiiBowler(playerMii);
    scene.add(built.group);
    return built;
  });

  // --- neighbouring lanes ----------------------------------------------
  /** Lane-x of each neighbouring lane a waiting player can be stood on,
   * nearest first so a two-player game seats them side by side. */
  const neighbourSpots: number[] = [];
  const fillerBowlers: MiiBowler[] = [];
  const idlePhase: number[] = [];
  for (let i = 0; i < 8; i++) idlePhase.push(Math.random() * Math.PI * 2);
  for (const offset of [-1, 1, -2, 2]) {
    const centerX = offset * LANE_PITCH;
    const neighbourLane = new THREE.Mesh(track(new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, LANE_TOTAL_LENGTH)), laneMat);
    neighbourLane.rotation.x = -Math.PI / 2;
    neighbourLane.position.set(centerX, 0, -LANE_TOTAL_LENGTH / 2);
    neighbourLane.renderOrder = 2;
    scene.add(neighbourLane);

    for (const side of [-1, 1]) {
      const gutter = new THREE.Mesh(track(new THREE.BoxGeometry(GUTTER_WIDTH, GUTTER_DEPTH, LANE_TOTAL_LENGTH)), gutterMat);
      gutter.position.set(centerX + side * (LANE_HALF_WIDTH + GUTTER_WIDTH / 2), -GUTTER_DEPTH / 2, -LANE_TOTAL_LENGTH / 2);
      scene.add(gutter);
      const capping = new THREE.Mesh(track(new THREE.BoxGeometry(0.34, 0.09, LANE_TOTAL_LENGTH)), capMat);
      capping.position.set(centerX + side * (LANE_HALF_WIDTH + GUTTER_WIDTH + 0.17), 0.045, -LANE_TOTAL_LENGTH / 2);
      scene.add(capping);
    }

    // A full rack standing on every neighbouring lane -- static scenery,
    // mirrored once at build time since these pins never move.
    for (const layout of PIN_LAYOUT) {
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.set(centerX + layout.x, 0, layout.z);
      scene.add(pin);
      const mirrored = new THREE.Mesh(pinGeo, pinReflectionMat);
      mirrored.position.copy(pin.position);
      mirrored.renderOrder = 1;
      reflections.add(mirrored);
    }

    // Only the immediate neighbours are close enough for a Mii to be worth
    // drawing; further lanes just get their static rack.
    if (Math.abs(offset) === 1) neighbourSpots.push(centerX);
  }

  // Waiting players occupy the neighbouring lanes; if there aren't enough
  // of them, strangers fill the rest so the alley never looks deserted.
  for (let i = miis.length - 1; i < neighbourSpots.length; i++) {
    const filler = createMiiBowler(randomMii(`neighbour-${i}`));
    scene.add(filler.group);
    fillerBowlers.push(filler);
  }

  const laneAccents = ["#c43b3b", "#3b82c4", "#f4a300", "#3bb54a", "#8a3bc4"];
  for (let i = -2; i <= 2; i++) {
    buildMaskingUnit(i * LANE_PITCH, 12 + i, laneAccents[i + 2]);
  }

  // --- aiming guide -----------------------------------------------------
  const guide = new THREE.Group();
  // Cool blue, not the warm yellow it started as: the lane is pale honey
  // wood and a warm guide washed straight into it.
  const guideMat = track(new THREE.MeshBasicMaterial({ color: 0x24c8ff, transparent: true, opacity: 0.9 }));
  const guideDashGeo = track(new THREE.PlaneGeometry(0.055, 0.3));
  const guideDashes: THREE.Mesh[] = [];
  for (let i = 0; i < GUIDE_DASH_COUNT; i++) {
    const dash = new THREE.Mesh(guideDashGeo, guideMat);
    dash.rotation.x = -Math.PI / 2;
    guide.add(dash);
    guideDashes.push(dash);
  }
  scene.add(guide);

  // --- resize -----------------------------------------------------------
  function resize() {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  // --- camera rig -------------------------------------------------------
  const camPos = new THREE.Vector3().copy(camera.position);
  const camLook = new THREE.Vector3(0, 0.9, -6);
  const targetPos = new THREE.Vector3();
  const targetLook = new THREE.Vector3();
  let snapNext = true;

  function computeShot(view: SceneView, sim: Simulation) {
    const { ball: b } = sim;
    switch (view.shot) {
      case "intro":
        // Front three-quarter view, so the player actually sees their Mii.
        targetPos.set(view.bowlerX + 2.15, 1.5, -1.15);
        targetLook.set(view.bowlerX - 0.1, 1.02, 0.8);
        break;
      case "aim":
        // Biased to the bowling-arm side of the line and lifted a little, so
        // the Mii sits right of centre and never stands on top of their own
        // aiming line -- which they did when moved to the left of the lane.
        targetPos.set(view.bowlerX * 0.5 - 0.3, 2.12, 4.5);
        targetLook.set(view.bowlerX * 0.8 - 0.06, 0.48, -8.5);
        break;
      case "lineup": {
        // Up-button close-up: ride the aim line most of the way down the
        // lane and look straight along it at the rack, so the player can see
        // exactly where their line lands relative to the pocket.
        const lineAt = (z: number) => view.bowlerX + Math.tan(view.aimAngle) * -z;
        const standoff = HEAD_PIN_Z + 6.4;
        targetPos.set(lineAt(standoff), 0.62, standoff);
        targetLook.set(lineAt(HEAD_PIN_Z), 0.28, HEAD_PIN_Z);
        break;
      }
      case "release":
        targetPos.set(view.bowlerX * 0.6 + 0.5, 1.5, 3.2);
        targetLook.set(view.bowlerX * 0.6, 0.36, -7.5);
        break;
      case "follow": {
        // Trail the ball, hanging back and slightly above it.
        targetPos.set(b.x * 0.55, 0.78, Math.max(b.z + 2.7, HEAD_PIN_Z + 3.9));
        targetLook.set(b.x * 0.7, 0.24, b.z - 2.6);
        break;
      }
      case "gutter":
        targetPos.set(b.x * 1.5, 0.62, b.z + 2.4);
        targetLook.set(b.x, 0.05, b.z - 1.2);
        break;
      case "pins":
        // Low and off to one side of the deck, the cut the real game makes
        // right before the ball arrives.
        targetPos.set(0.9, 0.62, HEAD_PIN_Z + 2.4);
        targetLook.set(-0.02, 0.24, HEAD_PIN_Z - 0.55);
        break;
      case "result":
        targetPos.set(0.08, 1.28, HEAD_PIN_Z + 2.55);
        targetLook.set(0, 0.24, HEAD_PIN_Z - 0.55);
        break;
    }
  }

  let lastActiveIndex = 0;

  /** Gentle waiting-their-turn animation for anyone not currently bowling. */
  function idlePose(who: MiiBowler, phase: number) {
    const now = performance.now() / 1000;
    who.setPose({
      ...NEUTRAL_POSE,
      armAngle: Math.sin(now * 1.1 + phase) * 0.22,
      offArmAngle: Math.sin(now * 1.1 + phase + Math.PI) * 0.22,
      yaw: Math.sin(now * 0.4 + phase) * 0.2,
      headTurn: Math.sin(now * 0.31 + phase) * 0.35,
    });
  }

  const tmpAxis = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const upVector = new THREE.Vector3(0, 1, 0);

  function render(dt: number, sim: Simulation, view: SceneView) {
    // --- bowler + held ball ---
    const activeIndex = view.activeIndex % bowlers.length;
    const bowler = bowlers[activeIndex];
    bowler.group.position.set(view.bowlerX - bowler.handOffsetX, 0, 0.85);
    bowler.setPose(view.pose);

    if (activeIndex !== lastActiveIndex) {
      // The ball belongs to whoever is up, so it takes their colour.
      lastActiveIndex = activeIndex;
      ballMaterial.color.set(ballColorFor(activeIndex));
      ballReflectionMat.color.set(ballColorFor(activeIndex));
    }

    // Everyone waiting stands on a neighbouring lane, nearest first.
    let spot = 0;
    for (let i = 0; i < bowlers.length; i++) {
      if (i === activeIndex) continue;
      const waiting = bowlers[i];
      if (spot < neighbourSpots.length) {
        waiting.group.visible = true;
        waiting.group.position.set(neighbourSpots[spot], 0, 0.3);
        idlePose(waiting, idlePhase[i]);
        spot += 1;
      } else {
        // More players than neighbouring lanes -- the rest sit this one out.
        waiting.group.visible = false;
      }
    }
    for (const filler of fillerBowlers) {
      const hasRoom = spot < neighbourSpots.length;
      filler.group.visible = hasRoom;
      if (hasRoom) {
        filler.group.position.set(neighbourSpots[spot], 0, 0.3);
        idlePose(filler, idlePhase[spot + bowlers.length]);
        spot += 1;
      }
    }

    if (!sim.ball.released) {
      bowler.handAnchor.getWorldPosition(ball.position);
    } else {
      ball.position.set(sim.ball.x, sim.ball.y, sim.ball.z);
    }
    // Spin the ball about the axis perpendicular to its travel.
    const speed = Math.hypot(sim.ball.vx, sim.ball.vz);
    if (sim.ball.released && speed > 0.01) {
      tmpAxis.set(-sim.ball.vz / speed, 0, sim.ball.vx / speed);
      tmpQuat.setFromAxisAngle(tmpAxis, (speed / BALL_RADIUS) * dt);
      ball.quaternion.premultiply(tmpQuat);
    }

    // --- pins ---
    // Pins knocked down on an earlier ball aren't in the simulation at all;
    // those meshes stay hidden until the rack is reset.
    for (const mesh of pinMeshes) mesh.visible = false;
    for (const state of sim.pins) {
      const mesh = pinMeshes[state.id];
      mesh.visible = state.y > -3;
      mesh.position.set(state.x, state.y, state.z);
      tmpAxis.set(state.axisX, 0, state.axisZ).normalize();
      mesh.quaternion.setFromAxisAngle(tmpAxis, state.tilt);
      // Yaw wobble is applied after the topple so it reads as the pin
      // spinning about its own length as it falls.
      tmpQuat.setFromAxisAngle(upVector, state.yaw);
      mesh.quaternion.multiply(tmpQuat);
    }

    // --- reflections ---
    // Positions and rotations are copied verbatim; the group's -Y scale does
    // the mirroring, including for a toppling pin's tilt.
    for (let i = 0; i < pinMeshes.length; i++) {
      pinReflections[i].visible = pinMeshes[i].visible;
      pinReflections[i].position.copy(pinMeshes[i].position);
      pinReflections[i].quaternion.copy(pinMeshes[i].quaternion);
    }
    ballReflection.position.copy(ball.position);
    ballReflection.visible = ball.position.y < 0.6;

    // --- sweeper ---
    sweeper.position.y = 1.4 - view.sweeper * 1.22;
    sweeper.position.z = HEAD_PIN_Z - 1.2 + Math.max(0, view.sweeper - 0.55) * 2.4;
    sweeper.visible = view.sweeper > 0.01;

    // --- aiming guide ---
    guide.visible = view.showGuide;
    if (view.showGuide) {
      for (let i = 0; i < guideDashes.length; i++) {
        const t = i / guideDashes.length;
        const z = -0.4 - t * GUIDE_LENGTH;
        // The ball rolls straight, so the guide is the literal path it will
        // take -- what the player lines up against the pocket.
        const dash = guideDashes[i];
        dash.position.set(view.bowlerX + Math.tan(view.aimAngle) * -z, 0.006, z);
        dash.scale.setScalar(1 - t * 0.3);
      }
    }

    // --- camera ---
    computeShot(view, sim);
    if (snapNext) {
      camPos.copy(targetPos);
      camLook.copy(targetLook);
      snapNext = false;
    } else {
      // Frame-rate independent exponential damping.
      const ease = 1 - Math.pow(0.0016, dt);
      camPos.lerp(targetPos, ease);
      camLook.lerp(targetLook, ease);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    renderer.render(scene, camera);
  }

  return {
    render,
    cutCamera() {
      snapNext = true;
    },
    dispose() {
      observer.disconnect();
      for (const built of bowlers) built.dispose();
      for (const filler of fillerBowlers) filler.dispose();
      for (const item of disposables) item.dispose();
      envMap.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}
