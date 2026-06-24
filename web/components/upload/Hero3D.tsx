"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";

/**
 * Construction-site hero: a tower crane (slewing jib + bobbing hook) beside a
 * building under construction, on a site grid. Drag to orbit; it auto-rotates
 * when idle. Built with ONLY core @react-three/fiber primitives (no drei) so it
 * can't hit the earlier OrbitControls/Grid bundle crash.
 */

type DragState = { dragging: boolean; lastX: number; rotY: number };

function Slab({ y, size, h, color }: { y: number; size: number; h: number; color: string }) {
  return (
    <mesh position={[0, y, 0]} castShadow>
      <boxGeometry args={[size, h, size]} />
      <meshStandardMaterial color={color} metalness={0.25} roughness={0.65} />
    </mesh>
  );
}

/** Four corner columns — an open "under construction" floor. */
function Columns({ y, span, h }: { y: number; span: number; h: number }) {
  const o = span / 2;
  const pts: [number, number][] = [
    [o, o], [o, -o], [-o, o], [-o, -o],
  ];
  return (
    <group>
      {pts.map(([x, z], i) => (
        <mesh key={i} position={[x, y, z]}>
          <boxGeometry args={[0.14, h, 0.14]} />
          <meshStandardMaterial color="#3a5a82" metalness={0.3} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function Scene({ drag }: { drag: React.MutableRefObject<DragState> }) {
  const world = useRef<Group>(null);
  const jib = useRef<Group>(null);
  const hook = useRef<Mesh>(null);

  useFrame((state) => {
    const d = drag.current;
    if (!d.dragging) d.rotY += 0.004; // idle auto-rotate
    if (world.current) world.current.rotation.y = d.rotY;
    const t = state.clock.getElapsedTime();
    if (jib.current) jib.current.rotation.y = t * 0.45; // slewing crane
    if (hook.current) hook.current.position.y = -1.15 + Math.sin(t * 1.6) * 0.18; // hoist bob
  });

  return (
    <group ref={world}>
      {/* Building under construction */}
      <group position={[1.5, 0, 0]}>
        <Slab y={0.25} size={2.6} h={0.5} color="#1d3f64" />
        <Slab y={0.8} size={2.1} h={0.5} color="#224a73" />
        <Columns y={1.5} span={1.7} h={0.9} />
        <Slab y={2.02} size={1.8} h={0.14} color="#2a557f" />
      </group>

      {/* Tower crane */}
      <group position={[-1.8, 0, 0.6]}>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.6, 0.2, 0.6]} />
          <meshStandardMaterial color="#142c49" />
        </mesh>
        <mesh position={[0, 1.85, 0]}>
          <boxGeometry args={[0.16, 3.4, 0.16]} />
          <meshStandardMaterial color="#F7941D" metalness={0.3} roughness={0.5} />
        </mesh>

        <group ref={jib} position={[0, 3.55, 0]}>
          {/* working jib + counter-jib */}
          <mesh position={[1.15, 0, 0]}>
            <boxGeometry args={[2.8, 0.12, 0.16]} />
            <meshStandardMaterial color="#F7941D" metalness={0.3} roughness={0.5} />
          </mesh>
          <mesh position={[-0.65, 0, 0]}>
            <boxGeometry args={[1.1, 0.12, 0.16]} />
            <meshStandardMaterial color="#F7941D" metalness={0.3} roughness={0.5} />
          </mesh>
          {/* counterweight + operator cab + apex */}
          <mesh position={[-1.05, -0.2, 0]}>
            <boxGeometry args={[0.32, 0.42, 0.34]} />
            <meshStandardMaterial color="#0e1f34" />
          </mesh>
          <mesh position={[0.18, -0.2, 0]}>
            <boxGeometry args={[0.26, 0.28, 0.3]} />
            <meshStandardMaterial color="#2a557f" />
          </mesh>
          <mesh position={[0, 0.28, 0]}>
            <boxGeometry args={[0.18, 0.36, 0.18]} />
            <meshStandardMaterial color="#F7941D" />
          </mesh>
          {/* hoist cable + hook block */}
          <mesh position={[2.0, -0.58, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 1.0, 6]} />
            <meshBasicMaterial color="#cbd5e1" />
          </mesh>
          <mesh ref={hook} position={[2.0, -1.15, 0]}>
            <boxGeometry args={[0.16, 0.16, 0.16]} />
            <meshStandardMaterial color="#F7941D" emissive="#7a3d00" />
          </mesh>
        </group>
      </group>

      <gridHelper args={[16, 16, "#2c3f60", "#16233c"]} position={[0, -0.26, 0]} />
    </group>
  );
}

export default function Hero3D() {
  const drag = useRef<DragState>({ dragging: false, lastX: 0, rotY: 0.5 });
  return (
    <div
      style={{ width: "100%", height: "100%", cursor: "grab", touchAction: "none" }}
      onPointerDown={(e) => {
        drag.current.dragging = true;
        drag.current.lastX = e.clientX;
        (e.currentTarget as HTMLElement).style.cursor = "grabbing";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d.dragging) {
          d.rotY += (e.clientX - d.lastX) * 0.01;
          d.lastX = e.clientX;
        }
      }}
      onPointerUp={(e) => {
        drag.current.dragging = false;
        (e.currentTarget as HTMLElement).style.cursor = "grab";
      }}
      onPointerLeave={(e) => {
        drag.current.dragging = false;
        (e.currentTarget as HTMLElement).style.cursor = "grab";
      }}
    >
      <Canvas camera={{ position: [8, 5.5, 9], fov: 42 }} dpr={[1, 2]} style={{ width: "100%", height: "100%" }}>
        <ambientLight color="#8aa0c0" intensity={1.5} />
        <directionalLight color="#ffffff" intensity={2.2} position={[6, 9, 5]} />
        <pointLight color="#F7941D" intensity={90} distance={30} position={[-5, 4, 4]} />
        <Scene drag={drag} />
      </Canvas>
    </div>
  );
}
