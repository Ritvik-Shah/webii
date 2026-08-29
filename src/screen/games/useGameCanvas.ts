import { useEffect, useRef } from "react";

export type DrawFn = (ctx: CanvasRenderingContext2D, dt: number, width: number, height: number) => void;

/**
 * Shared canvas game-loop scaffold used by every mini-game: mounts a
 * `<canvas>` sized to fill its parent (crisp at the display's device pixel
 * ratio), runs `draw` once per animation frame with a delta-time in seconds
 * (clamped so a tab-switch stall can't produce a huge physics step), and
 * handles resize + cleanup. Plain Canvas 2D, no rendering library -- see
 * the plan's "Open Items" note on this being a deliberate v1 scope call
 * (2.5D perspective tricks instead of true 3D/WebGL).
 *
 * `draw` is read from a ref each frame, so passing a fresh closure every
 * render (the common case, since it closes over game state) does not tear
 * down and restart the loop.
 */
export function useGameCanvas(draw: DrawFn) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let last = performance.now();

    function resize() {
      const parent = canvas!.parentElement;
      const w = parent ? parent.clientWidth : window.innerWidth;
      const h = parent ? parent.clientHeight : window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = Math.max(1, Math.round(w * dpr));
      canvas!.height = Math.max(1, Math.round(h * dpr));
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      drawRef.current(ctx!, dt, w, h);
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return canvasRef;
}
