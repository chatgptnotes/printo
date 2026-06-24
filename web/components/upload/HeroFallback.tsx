"use client";

import { useEffect, useRef, type CSSProperties } from "react";

/**
 * No-WebGL hero: a draggable CSS-3D construction scene — a tower crane with a
 * slewing jib + bobbing hook beside a building under construction, on a site
 * grid. Renders on any device (pure CSS 3D transforms). Drag to spin; it
 * auto-rotates when idle. Used when the browser can't create a WebGL context.
 */

interface BoxProps {
  a: number; // size along X
  b: number; // size along Y (depth)
  c: number; // size along Z (up)
  x?: number;
  y?: number;
  z?: number;
  top: string;
  side: string;
  dark: string;
}

function Box3D({ a, b, c, x = 0, y = 0, z = 0, top, side, dark }: BoxProps) {
  const face = (w: number, h: number, transform: string, bg: string): CSSProperties => ({
    position: "absolute",
    width: w,
    height: h,
    left: -w / 2,
    top: -h / 2,
    background: bg,
    transform,
    backfaceVisibility: "hidden",
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)",
  });
  return (
    <div
      style={{
        position: "absolute",
        transformStyle: "preserve-3d",
        transform: `translate3d(${x}px, ${y}px, ${z}px)`,
      }}
    >
      <div style={face(a, b, `translateZ(${c / 2}px)`, top)} />
      <div style={face(a, c, `translateY(${b / 2}px) rotateX(-90deg)`, side)} />
      <div style={face(a, c, `translateY(${-b / 2}px) rotateX(90deg)`, dark)} />
      <div style={face(b, c, `translateX(${a / 2}px) rotateY(90deg)`, side)} />
      <div style={face(b, c, `translateX(${-a / 2}px) rotateY(-90deg)`, dark)} />
    </div>
  );
}

const NAVY = { top: "#2a557f", side: "#1d3f64", dark: "#122a44" };
const STEEL = { top: "#3a5a82", side: "#2a4a6e", dark: "#1b3147" };
const ORANGE = { top: "#ffb24d", side: "#F7941D", dark: "#c87410" };
const DECK = { top: "#34618f", side: "#244a70", dark: "#16314c" };

export default function HeroFallback() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const state = useRef({ dragging: false, lastX: 0, rotY: 25 });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = state.current;
      if (!s.dragging) s.rotY += 0.18;
      if (worldRef.current) {
        worldRef.current.style.transform = `rotateX(60deg) rotateZ(${s.rotY}deg)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    state.current.dragging = true;
    state.current.lastX = e.clientX;
    if (sceneRef.current) sceneRef.current.style.cursor = "grabbing";
  };
  const onMove = (e: React.PointerEvent) => {
    const s = state.current;
    if (s.dragging) {
      s.rotY += (e.clientX - s.lastX) * 0.4;
      s.lastX = e.clientX;
    }
  };
  const onUp = () => {
    state.current.dragging = false;
    if (sceneRef.current) sceneRef.current.style.cursor = "grab";
  };

  return (
    <div
      ref={sceneRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      style={{
        width: "100%",
        height: "100%",
        cursor: "grab",
        touchAction: "none",
        perspective: 1000,
        perspectiveOrigin: "50% 42%",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes hero-slew { from { transform: rotateZ(0deg); } to { transform: rotateZ(360deg); } }
        @keyframes hero-hoist { 0%,100% { transform: translate3d(118px,0,-44px); } 50% { transform: translate3d(118px,0,-58px); } }
      `}</style>

      {/* world: centered, tilted; auto/drag rotation set on transform via rAF */}
      <div
        ref={worldRef}
        style={{
          position: "absolute",
          left: "50%",
          top: "62%",
          transformStyle: "preserve-3d",
          transform: "rotateX(60deg) rotateZ(25deg)",
        }}
      >
        {/* site ground */}
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            left: -210,
            top: -210,
            transform: "translateZ(0px)",
            background:
              "radial-gradient(circle at 50% 50%, rgba(247,148,29,0.10), rgba(247,148,29,0) 60%)," +
              "repeating-linear-gradient(0deg, #1a2a44 0 1px, transparent 1px 38px)," +
              "repeating-linear-gradient(90deg, #1a2a44 0 1px, transparent 1px 38px)",
            borderRadius: 14,
            opacity: 0.55,
          }}
        />

        {/* Building under construction (right) */}
        <div style={{ position: "absolute", transformStyle: "preserve-3d", transform: "translate3d(78px,0,0)" }}>
          <Box3D a={120} b={120} c={22} z={11} {...NAVY} />
          <Box3D a={100} b={100} c={22} z={33} {...DECK} />
          <Box3D a={82} b={82} c={22} z={55} {...NAVY} />
          {/* open frame floor = under construction */}
          {([[30, 30], [30, -30], [-30, 30], [-30, -30]] as [number, number][]).map(([cx, cy], i) => (
            <Box3D key={i} a={8} b={8} c={40} x={cx} y={cy} z={86} {...STEEL} />
          ))}
          <Box3D a={72} b={72} c={8} z={110} {...DECK} />
        </div>

        {/* Tower crane (left) */}
        <div style={{ position: "absolute", transformStyle: "preserve-3d", transform: "translate3d(-120px,18px,0)" }}>
          <Box3D a={40} b={40} c={12} z={6} top="#1b3147" side="#122a44" dark="#0c1d30" />
          <Box3D a={13} b={13} c={150} z={87} {...ORANGE} />

          {/* slewing assembly at the mast top */}
          <div style={{ position: "absolute", transformStyle: "preserve-3d", transform: "translateZ(162px)" }}>
            <div style={{ position: "absolute", transformStyle: "preserve-3d", animation: "hero-slew 9s linear infinite" }}>
              <Box3D a={180} b={10} c={10} x={58} {...ORANGE} />
              <Box3D a={72} b={10} c={10} x={-38} {...ORANGE} />
              <Box3D a={18} b={20} c={22} x={-66} z={-12} top="#1b3147" side="#122a44" dark="#0c1d30" />
              <Box3D a={16} b={16} c={16} x={8} z={-12} {...DECK} />
              <Box3D a={10} b={10} c={24} z={15} {...ORANGE} />
              {/* hoist cable + hook */}
              <Box3D a={2} b={2} c={56} x={118} z={-30} top="#cbd5e1" side="#9aa7b8" dark="#7c8896" />
              <div style={{ position: "absolute", transformStyle: "preserve-3d", animation: "hero-hoist 3.2s ease-in-out infinite" }}>
                <Box3D a={11} b={11} c={11} {...ORANGE} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <span
        style={{ position: "absolute", left: 12, bottom: 10, fontSize: 11, color: "#7f93b0" }}
      >
        drag to rotate
      </span>
    </div>
  );
}
