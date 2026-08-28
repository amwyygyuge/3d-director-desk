import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { observer } from "mobx-react";

import { sceneStore } from "../store/SceneStore";
import { selectionStore } from "../store/SelectionStore";

/**
 * 导演台主组件(阶段一骨架)。
 *
 * 性能铁律落实:
 * - frameloop="demand":静态场景不持续渲染,状态变更显式 invalidate;
 * - three 对象经 ref 注册进 SceneManager 运行时表,不进 observable;
 * - 面板订阅走 MobX 细粒度 observer,Canvas 树不随 UI state 重渲染。
 */
export const DirectorDesk = observer(function DirectorDesk() {
    void sceneStore.revision;
    void selectionStore;

    return (
        <div className="relative h-full w-full overflow-hidden bg-neutral-900">
            <Canvas
                frameloop="demand"
                camera={{ position: [6, 4, 8], fov: 45 }}
                gl={{ antialias: true, preserveDrawingBuffer: false }}
            >
                <color attach="background" args={["#171717"]} />
                <Grid args={[40, 40]} cellColor="#333333" sectionColor="#555555" infiniteGrid />
                <ambientLight intensity={0.6} />
                <directionalLight position={[5, 10, 4]} intensity={1.2} />
                <OrbitControls makeDefault />
            </Canvas>
        </div>
    );
});
