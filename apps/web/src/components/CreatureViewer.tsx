import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";

interface CreatureViewerProps {
  url: string | null | undefined;
}

/**
 * Turntable inspector for the creature's .glb.
 *
 * This is the ONE place in the app where the camera-e-perspectiva rule of
 * "no rotation, no zoom" is deliberately broken — the doc calls out
 * "bestiário/vitrina de criatura" as the free-orbit exception. The initial
 * camera sits near the game's isometric angle so what the reader sees first
 * matches what the game shows.
 *
 * Materials come from the .glb as authored by Meshy; the cel-shaded toon
 * shader that the game applies is not reproduced here. This is documentation
 * of the mesh, not a preview of gameplay lighting.
 */
export function CreatureViewer({ url }: CreatureViewerProps) {
  if (!url) {
    return (
      <div className="flex h-[360px] items-center justify-center border border-graphite/40 bg-void">
        <div className="text-center">
          <p className="font-mono text-micro uppercase tracking-widest text-graphite">
            modelo 3D
          </p>
          <p className="mt-3 font-sans text-xs text-bone/50">
            não anexado — modelo ainda em produção
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[360px] border border-graphite/40 bg-void">
      <Canvas
        camera={{ position: [1.6, 1.1, 1.6], fov: 32 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 4, 2]} intensity={1.1} />
        <directionalLight position={[-2, -1, -3]} intensity={0.3} />
        <Suspense fallback={null}>
          <Model url={url} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom
          autoRotate
          autoRotateSpeed={0.6}
          minDistance={0.6}
          maxDistance={6}
        />
      </Canvas>
      <p className="pointer-events-none absolute left-3 top-3 font-mono text-micro uppercase tracking-widest text-graphite/70">
        modelo 3D · turntable
      </p>
    </div>
  );
}

function Model({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} />;
}
