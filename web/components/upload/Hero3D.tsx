"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { useRef } from "react";
import type { Mesh } from "three";

function FloorSlab({ y, size }: { y: number; size: number }) {
  return (
    <mesh position={[0, y, 0]} castShadow receiveShadow>
      <boxGeometry args={[size, 0.5, size]} />
      <meshStandardMaterial color="#142a44" metalness={0.3} roughness={0.6} />
    </mesh>
  );
}

function Building() {
  return (
    <group>
      <FloorSlab y={0} size={4.2} />
      <FloorSlab y={1.1} size={3.2} />
      <FloorSlab y={2.2} size={2.2} />
    </group>
  );
}

function ScanRing() {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.getElapsedTime();
    ref.current.position.y = 0.3 + (Math.sin(t * 1.2) * 0.5 + 0.5) * 2.4;
    const mat = ref.current.material as { opacity: number };
    mat.opacity = 0.45 + (Math.sin(t * 1.2) * 0.5 + 0.5) * 0.55;
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[2.6, 0.04, 16, 80]} />
      <meshBasicMaterial color="#F7941D" transparent opacity={0.8} />
    </mesh>
  );
}

export default function Hero3D() {
  return (
    <Canvas
      camera={{ position: [6, 5, 9], fov: 45 }}
      style={{ width: "100%", height: "100%", cursor: "grab" }}
      dpr={[1, 2]}
    >
      <ambientLight color="#8aa0c0" intensity={0.75} />
      <directionalLight color="#ffffff" intensity={0.9} position={[5, 8, 5]} />
      <pointLight color="#F7941D" intensity={40} position={[-4, 3, 4]} />
      <Building />
      <ScanRing />
      <Grid
        args={[20, 20]}
        cellColor="#1e2d4a"
        sectionColor="#26365a"
        position={[0, -0.3, 0]}
        infiniteGrid
        fadeDistance={26}
      />
      <OrbitControls
        autoRotate
        autoRotateSpeed={1.2}
        enablePan={false}
        minDistance={6}
        maxDistance={16}
      />
    </Canvas>
  );
}
