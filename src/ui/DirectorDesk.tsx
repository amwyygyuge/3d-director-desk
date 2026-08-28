import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { observer } from "mobx-react";
import { useEffect, useState } from "react";

import { createDirectorDeskStores, DirectorDeskProvider } from "./DirectorDeskContext";
import type { DirectorDeskStores } from "./DirectorDeskContext";

/**
 * 导演台主组件(阶段一骨架)。
 *
 * 每实例一套 stores:Monet 画布可同时存在多个导演台节点,禁全局单例。
 * 性能铁律落实:
 * - frameloop="demand":静态场景不持续渲染,状态变更显式 invalidate;
 * - three 对象经 ref 注册进 SceneManager 运行时表,不进 observable;
 * - 面板订阅走 MobX 细粒度 observer,Canvas 树不随 UI state 重渲染。
 */
export const DirectorDesk = observer(function DirectorDesk() {
    const [stores] = useState<DirectorDeskStores>(createDirectorDeskStores);

    useEffect(() => {
        return () => {
            stores.capture.detach();
            stores.scene.manager.dispose();
        };
    }, [stores]);

    return (
        <DirectorDeskProvider value={stores}>
            <div className="relative h-full w-full overflow-hidden bg-neutral-900">
                <Canvas
                    frameloop="demand"
                    camera={{ position: [6, 4, 8], fov: 45 }}
                    gl={{ antialias: true, preserveDrawingBuffer: false }}
                    onCreated={(state) => stores.capture.attach(state.gl.domElement)}
                >
                    <color attach="background" args={["#171717"]} />
                    <Grid args={[40, 40]} cellColor="#333333" sectionColor="#555555" infiniteGrid />
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[5, 10, 4]} intensity={1.2} />
                    <OrbitControls makeDefault />
                </Canvas>
            </div>
        </DirectorDeskProvider>
    );
});
