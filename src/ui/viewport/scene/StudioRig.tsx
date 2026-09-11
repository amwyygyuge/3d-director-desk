import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { LIGHTING_MODE } from "@/store/SceneStore";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const AMBIENT_INTENSITY = 0.5;
const KEY_LIGHT_INTENSITY = 1.4;
const FILL_LIGHT_INTENSITY = 0.65;
const RIM_LIGHT_INTENSITY = 0.9;
const KEY_LIGHT_COLOR = "#ffffff";
const FILL_LIGHT_COLOR = "#b7d4ff";
const RIM_LIGHT_COLOR = "#ffd1a6";
const KEY_LIGHT_POSITION = [5, 6, 4] as const;
const FILL_LIGHT_POSITION = [-4, 2, 4] as const;
const RIM_LIGHT_POSITION = [0, 5, -6] as const;

/** PMREM 卷积的模糊半径:RoomEnvironment 的推荐量级,过大会抹平方向性、过小留下块状接缝。 */
const ENVIRONMENT_BLUR_SIGMA = 0.04;

/**
 * 演播室三点布光:仅模式为 studio 时创建,不参与用户灯光实体与其历史。
 *
 * 同时承担与布光档无关的成像状态落地(曝光/环境光照)——它是每桌唯一的演播室 rig,
 * 写 `gl.toneMappingExposure` 与 `scene.environment` 的唯一去处;
 * 这些是 Three 运行时状态,只读 store 的纯数据档位,不把 Three 对象放进 observable。
 *
 * 注意两类效果的作用域不同:曝光与环境光照对 studio/custom 两种布光模式都成立,
 * 故写在提前返回**之前**;三点光本身才是 studio 专属。
 */
export const StudioRig = observer(function StudioRig() {
    const { scene, studio } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const gl = useThree((state) => state.gl);
    const threeScene = useThree((state) => state.scene);
    const lightingMode = scene.lightingMode;
    const revision = scene.revision;
    const exposure = studio.exposure;
    const environmentLightingEnabled = studio.environmentLightingEnabled;

    useEffect(() => {
        invalidate();
    }, [invalidate, lightingMode, revision]);

    // 曝光是渲染器状态,不是场景图节点:直写 gl 并补帧(demand 模式下不会自动成像)。
    useEffect(() => {
        gl.toneMappingExposure = exposure;
        invalidate();
    }, [gl, exposure, invalidate]);

    // 环境光照:程序化 RoomEnvironment 经 PMREM 卷积,不拉取任何外部资源(内网零外部依赖)。
    // 卷积是一次性成本,产物是一张常驻立方图;关闭时必须摘除 scene.environment 并释放,
    // 否则显存常驻、且「关掉开关画面不变」。
    //
    // 释放的对象必须是 `fromScene` 返回的 **WebGLRenderTarget**,不是它的 `.texture`:
    // 只 dispose 纹理会留下 render target 自己的 GPU 分配,实测开关往返三次
    // `gl.info.memory.textures` 单调递增 2→3→4→5(零泄漏纪律)。
    useEffect(() => {
        if (!environmentLightingEnabled) return;
        const generator = new PMREMGenerator(gl);
        const room = new RoomEnvironment();
        const target = generator.fromScene(room, ENVIRONMENT_BLUR_SIGMA);
        room.dispose();
        generator.dispose();
        threeScene.environment = target.texture;
        invalidate();
        return () => {
            threeScene.environment = null;
            target.dispose();
            invalidate();
        };
    }, [environmentLightingEnabled, gl, threeScene, invalidate]);

    if (lightingMode !== LIGHTING_MODE.STUDIO) return null;

    return (
        <>
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <directionalLight color={KEY_LIGHT_COLOR} intensity={KEY_LIGHT_INTENSITY} position={KEY_LIGHT_POSITION} />
            <directionalLight
                color={FILL_LIGHT_COLOR}
                intensity={FILL_LIGHT_INTENSITY}
                position={FILL_LIGHT_POSITION}
            />
            <directionalLight color={RIM_LIGHT_COLOR} intensity={RIM_LIGHT_INTENSITY} position={RIM_LIGHT_POSITION} />
        </>
    );
});
