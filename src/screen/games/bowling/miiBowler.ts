// A Mii rendered as an actual 3D character: sphere head with the face
// texture mapped onto a curved patch, rounded torso, capsule limbs, and
// procedural hair/hats built from primitives. Proportions are deliberately
// Mii-ish -- oversized head, short stubby body -- rather than anatomical.
//
// The model faces down-lane (-Z), so a positive `armAngle` swings the
// bowling arm forward and a negative one takes it back.

import * as THREE from "three";
import type { Mii } from "../../mii/Mii";
import { createMiiFaceTexture, shade } from "./miiFace";

const HEAD_RADIUS = 0.15;

export interface BowlerPose {
  /** Bowling-arm angle, radians. Negative = backswing, positive = follow-through. */
  armAngle: number;
  /** Non-bowling arm, same convention, usually counter-swinging. */
  offArmAngle: number;
  /** Forward lean at the waist, radians. */
  lean: number;
  /** Lunge depth, 0-1. Drops the hips and swings the legs into a slide, so
   * a full crouch brings the bowling hand down to the boards. */
  crouch: number;
  /** Body yaw, radians -- how far the bowler is turned off straight down-lane. */
  yaw: number;
  /** Head turn relative to the body, radians. */
  headTurn: number;
  /** Head tilt up/down, radians. Positive looks up. */
  headPitch: number;
  /** How far the bowling arm is held out from the body, radians. Keeps the
   * ball clear of the torso in the ready pose, where the camera is directly
   * behind the bowler and would otherwise see nothing but their back. */
  armSpread: number;
}

export const NEUTRAL_POSE: BowlerPose = {
  armAngle: 0,
  offArmAngle: 0,
  lean: 0.05,
  crouch: 0,
  yaw: 0,
  headTurn: 0,
  headPitch: 0,
  armSpread: 0,
};

export interface MiiBowler {
  group: THREE.Group;
  /** Empty object at the bowling hand; read its world position to place the ball. */
  handAnchor: THREE.Object3D;
  /** Lateral offset of the bowling hand from the model's own origin. Varies
   * with build and height, so callers offset the whole Mii by it to put the
   * hand -- and therefore the ball -- exactly on the line being aimed. */
  handOffsetX: number;
  setPose: (pose: BowlerPose) => void;
  dispose: () => void;
}

// The un-scaled rig is roughly 1.2 m tall; these bring it up to Mii-ish
// human height beside a 38 cm pin, and are also what puts the bowling hand
// close enough to the boards at full crouch for the ball to leave it there.
const HEIGHT_SCALE: Record<string, number> = { short: 1.22, average: 1.35, tall: 1.48 };
const BUILD_SCALE: Record<string, number> = { slim: 0.86, average: 1, wide: 1.2 };

/** Every hair style in Mii.ts collapses onto one of these buildable shapes. */
type HairShape = "none" | "cap" | "tufted" | "long" | "ponytail" | "pigtails" | "spiky" | "mohawk";

const HAIR_SHAPES: Record<string, HairShape> = {
  bald: "none",
  buzz: "cap",
  short: "cap",
  messy: "tufted",
  long: "long",
  wavy: "long",
  ponytail: "ponytail",
  pigtails: "pigtails",
  spiky: "spiky",
  mohawk: "mohawk",
  curly: "tufted",
  bob: "long",
};

function standardMaterial(color: string, roughness = 0.62): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0.02 });
}

/** The torso silhouette: a shirt that flares slightly from waist to shoulders. */
function torsoGeometry(): THREE.LatheGeometry {
  const points: THREE.Vector2[] = [];
  const profile: Array<[number, number]> = [
    [0, 0],
    [0.16, 0],
    [0.175, 0.08],
    [0.185, 0.2],
    [0.19, 0.34],
    [0.176, 0.44],
    [0.13, 0.5],
    [0, 0.51],
  ];
  for (const [r, y] of profile) points.push(new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(points, 28);
}

function buildHair(shape: HairShape, material: THREE.Material): THREE.Group {
  const hair = new THREE.Group();
  const r = HEAD_RADIUS;

  function cap(coverage: number) {
    const geo = new THREE.SphereGeometry(r * 1.045, 32, 24, 0, Math.PI * 2, 0, coverage);
    return new THREE.Mesh(geo, material);
  }

  switch (shape) {
    case "none":
      break;
    case "cap":
      hair.add(cap(Math.PI * 0.44));
      break;
    case "tufted": {
      hair.add(cap(Math.PI * 0.46));
      // Scattered lumps for a messy / curly read.
      const lumps: Array<[number, number, number]> = [
        [0.6, 0.8, -0.3],
        [-0.7, 0.75, -0.2],
        [0.1, 0.95, 0.4],
        [-0.35, 0.85, 0.6],
        [0.75, 0.6, 0.5],
      ];
      for (const [x, y, z] of lumps) {
        const lump = new THREE.Mesh(new THREE.SphereGeometry(r * 0.34, 16, 12), material);
        lump.position.set(x * r, y * r, z * r);
        hair.add(lump);
      }
      break;
    }
    case "long": {
      hair.add(cap(Math.PI * 0.5));
      const back = new THREE.Mesh(new THREE.SphereGeometry(r * 0.98, 24, 20), material);
      back.scale.set(1.04, 1.5, 0.72);
      back.position.set(0, -r * 0.42, r * 0.42);
      hair.add(back);
      break;
    }
    case "ponytail": {
      hair.add(cap(Math.PI * 0.46));
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.28, r * 0.9, 6, 14), material);
      tail.position.set(0, -r * 0.15, r * 1.05);
      tail.rotation.x = -0.5;
      hair.add(tail);
      break;
    }
    case "pigtails": {
      hair.add(cap(Math.PI * 0.46));
      for (const side of [-1, 1]) {
        const tail = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.24, r * 0.7, 6, 14), material);
        tail.position.set(side * r * 1.02, -r * 0.3, r * 0.35);
        tail.rotation.z = side * 0.5;
        hair.add(tail);
      }
      break;
    }
    case "spiky": {
      hair.add(cap(Math.PI * 0.42));
      for (let i = 0; i < 9; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.62, 8), material);
        const a = (i / 9) * Math.PI * 2;
        const ring = i % 2 === 0 ? 0.5 : 0.78;
        spike.position.set(Math.cos(a) * r * ring, r * (i % 2 === 0 ? 1.06 : 0.86), Math.sin(a) * r * ring);
        spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        hair.add(spike);
      }
      break;
    }
    case "mohawk": {
      for (let i = 0; i < 6; i++) {
        const blade = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.75, 8), material);
        const t = (i / 5 - 0.5) * 1.5;
        blade.position.set(0, r * (1.0 - Math.abs(t) * 0.28), t * r);
        hair.add(blade);
      }
      break;
    }
  }
  return hair;
}

function buildHat(style: string, color: string): THREE.Group | null {
  if (style === "none") return null;
  const hat = new THREE.Group();
  const material = standardMaterial(color, 0.7);
  const r = HEAD_RADIUS;

  switch (style) {
    case "cap": {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(r * 1.07, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.44), material);
      hat.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.15, r * 0.06, 24, 1, false, Math.PI * 0.72, Math.PI * 0.56), material);
      brim.position.set(0, r * 0.5, 0);
      hat.add(brim);
      break;
    }
    case "beanie": {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(r * 1.09, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), material);
      hat.add(crown);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.11, r * 1.11, r * 0.24, 24), standardMaterial(shade(color, 0.25), 0.7));
      band.position.y = r * 0.5;
      hat.add(band);
      const bobble = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 14, 12), standardMaterial(shade(color, 0.35), 0.8));
      bobble.position.y = r * 1.18;
      hat.add(bobble);
      break;
    }
    case "tophat": {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.5, r * 1.5, r * 0.07, 28), material);
      brim.position.y = r * 0.86;
      hat.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, r * 1.4, 28), material);
      crown.position.y = r * 1.58;
      hat.add(crown);
      break;
    }
    case "party": {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, r * 1.5, 20), material);
      cone.position.y = r * 1.5;
      cone.rotation.z = 0.16;
      hat.add(cone);
      const pom = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 14, 12), standardMaterial("#ffffff", 0.85));
      pom.position.set(-r * 0.2, r * 2.24, 0);
      hat.add(pom);
      break;
    }
    default:
      return null;
  }
  return hat;
}

export function createMiiBowler(mii: Mii): MiiBowler {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  function track<T extends { dispose: () => void }>(item: T): T {
    disposables.push(item);
    return item;
  }

  const skin = track(standardMaterial(mii.skinTone, 0.72));
  const hairMat = track(standardMaterial(mii.hairColor, 0.75));
  const shirt = track(standardMaterial(mii.shirtColor, 0.68));
  const trousers = track(standardMaterial("#3a4258", 0.8));
  const shoe = track(standardMaterial("#20242e", 0.6));

  const heightScale = HEIGHT_SCALE[mii.height] ?? 1;
  const buildScale = BUILD_SCALE[mii.build] ?? 1;

  // --- body -------------------------------------------------------------
  const body = new THREE.Group();
  body.scale.setScalar(heightScale);
  group.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.42;
  body.add(hips);

  const torso = new THREE.Mesh(track(torsoGeometry()), shirt);
  torso.scale.set(buildScale, 1, buildScale * 0.86);
  torso.castShadow = true;
  hips.add(torso);

  // Shirt detailing -- a collar band or a hoodie pouch, matching the CSS avatar's styles.
  if (mii.shirtStyle === "collared") {
    const collar = new THREE.Mesh(track(new THREE.TorusGeometry(0.1, 0.022, 8, 20)), track(standardMaterial(shade(mii.shirtColor, 0.4), 0.7)));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.5;
    hips.add(collar);
  } else if (mii.shirtStyle === "hoodie") {
    const hood = new THREE.Mesh(track(new THREE.SphereGeometry(0.13, 20, 14)), track(standardMaterial(shade(mii.shirtColor, -0.2), 0.75)));
    hood.scale.set(1.1, 0.7, 0.8);
    hood.position.set(0, 0.46, 0.11);
    hips.add(hood);
  } else if (mii.shirtStyle === "striped") {
    const stripeMat = track(standardMaterial(shade(mii.shirtColor, 0.45), 0.7));
    for (let i = 0; i < 3; i++) {
      const stripe = new THREE.Mesh(track(new THREE.CylinderGeometry(0.193 * buildScale, 0.193 * buildScale, 0.035, 24, 1, true)), stripeMat);
      stripe.scale.z = 0.87;
      stripe.position.y = 0.14 + i * 0.12;
      hips.add(stripe);
    }
  }

  // --- legs -------------------------------------------------------------
  const legs = new THREE.Group();
  body.add(legs);
  const knees: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.075, 0.42, 0);
    const thigh = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.055, 0.26, 6, 14)), trousers);
    thigh.position.y = -0.19;
    thigh.castShadow = true;
    leg.add(thigh);
    const foot = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.06, 0.19)), shoe);
    foot.position.set(0, -0.36, -0.035);
    foot.castShadow = true;
    leg.add(foot);
    legs.add(leg);
    knees.push(leg);
  }

  // --- arms -------------------------------------------------------------
  function buildArm(side: number): { pivot: THREE.Group; hand: THREE.Object3D } {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.185 * buildScale, 0.44, 0);
    const upper = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.045, 0.2, 6, 14)), shirt);
    upper.position.y = -0.1;
    upper.castShadow = true;
    pivot.add(upper);
    const forearm = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.042, 0.16, 6, 14)), skin);
    forearm.position.y = -0.29;
    forearm.castShadow = true;
    pivot.add(forearm);
    const hand = new THREE.Mesh(track(new THREE.SphereGeometry(0.058, 16, 12)), skin);
    hand.position.y = -0.4;
    hand.castShadow = true;
    pivot.add(hand);
    hips.add(pivot);
    return { pivot, hand };
  }

  // The bowling arm is the Mii's right, which is world -X when facing -Z.
  const bowlingArm = buildArm(-1);
  const offArm = buildArm(1);

  const handAnchor = new THREE.Object3D();
  handAnchor.position.y = -0.075;
  bowlingArm.hand.add(handAnchor);

  // --- head -------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.y = 0.52;
  hips.add(neck);

  const head = new THREE.Group();
  neck.add(head);
  head.position.y = HEAD_RADIUS * 0.96;

  const headGeo = track(new THREE.SphereGeometry(HEAD_RADIUS, 40, 32));
  const headMesh = new THREE.Mesh(headGeo, skin);
  // Face-shape variations, matching the CSS avatar's four options.
  const shapeScale: Record<string, [number, number, number]> = {
    round: [1, 1.02, 0.98],
    oval: [0.92, 1.14, 0.95],
    square: [1.05, 1.0, 0.98],
    heart: [1.04, 1.06, 0.96],
  };
  const [sx, sy, sz] = shapeScale[mii.faceShape] ?? shapeScale.round;
  headMesh.scale.set(sx, sy, sz);
  headMesh.castShadow = true;
  head.add(headMesh);

  const faceTexture = track(createMiiFaceTexture(mii));
  const faceMat = track(
    new THREE.MeshStandardMaterial({
      map: faceTexture,
      transparent: true,
      roughness: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  // A curved patch hugging the front of the head, so features wrap around
  // the face instead of floating on a flat billboard.
  const faceGeo = track(
    new THREE.SphereGeometry(HEAD_RADIUS * 1.005, 48, 40, -Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.62, 1.24),
  );
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.scale.set(sx, sy, sz);
  head.add(faceMesh);

  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(track(new THREE.SphereGeometry(HEAD_RADIUS * 0.22, 12, 10)), skin);
    ear.position.set(side * HEAD_RADIUS * 0.97 * sx, -HEAD_RADIUS * 0.05, 0);
    ear.scale.set(0.5, 1, 0.85);
    head.add(ear);
  }

  head.add(buildHair(HAIR_SHAPES[mii.hairStyle] ?? "cap", hairMat));
  const hat = buildHat(mii.hatStyle, mii.hatColor);
  if (hat) head.add(hat);

  // ----------------------------------------------------------------------

  function setPose(pose: BowlerPose) {
    group.rotation.y = pose.yaw;
    hips.rotation.x = pose.lean;
    hips.position.y = 0.42 - pose.crouch * 0.34;
    bowlingArm.pivot.rotation.x = pose.armAngle;
    // The bowling arm sits at -X, so a positive spread has to rotate the
    // shoulder the other way to swing the ball out clear of the body.
    bowlingArm.pivot.rotation.z = -pose.armSpread;
    offArm.pivot.rotation.x = pose.offArmAngle;
    offArm.pivot.rotation.z = pose.armSpread * 0.5;
    head.rotation.y = pose.headTurn;
    head.rotation.x = -pose.lean * 0.7 + pose.headPitch;
    for (const leg of knees) leg.rotation.x = pose.crouch * 0.45;
  }

  setPose(NEUTRAL_POSE);

  return {
    group,
    handAnchor,
    handOffsetX: -0.185 * buildScale * heightScale,
    setPose,
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
