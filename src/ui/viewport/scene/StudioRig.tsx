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
 * 投影装置档位。
 *
 * 方位取右上前方,与三点光的主光同侧——投影方向要与造型光一致,否则画面上会出现
 * 「光从左来、影子朝左」的矛盾线索。强度只用于产生投影,不参与造型(接收面是 shadowMaterial)。
 *
 * `bias`/`normalBias` 治两类失真:前者消自投影产生的条纹(shadow acne),
 * 后者消薄壁几何沿法线方向的漏影;两者都必须小,给大了投影会从接触点脱开(peter-panning)。
 */
const SHADOW_LIGHT_COLOR = "#ffffff";
const SHADOW_LIGHT_INTENSITY = 1.1;
const SHADOW_LIGHT_POSITION = [6, 12, 8] as const;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_CAMERA_NEAR = 0.5;
/** 投影相机远平面按范围放大:光源在斜上方,深度跨度大于地板边长。 */
const SHADOW_CAMERA_FAR_FACTOR = 3;
const SHADOW_BIAS = -0.0005;
const SHADOW_NORMAL_BIAS = 0.02;
/** 投影范围下限(米):地板可以很小,但投影框太小会让主体落在框外而没有投影。 */
const SHADOW_MIN_EXTENT_METERS = 12;

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

/**
 * 投影装置(独立组件,与布光模式无关)。
 *
 * 刻意不挂在 `StudioRig` 的 studio 分支里:接地投影是**几何接触线索**,不是某套布光预设的一部分,
 * 挂进去会让 `lightingMode: "custom"` 的工程静默失去它(同 IBL 的作用域判断)。
 *
 * 由自带的投射光负责,而不是给三点光加 `castShadow`:三点光只在 studio 模式存在,
 * 且它们的方位是为造型服务的,同时兼任投影会让「换布光」意外改变接地位置。
 *
 * 只负责投射,不带接收面:接收方是 `StudioFloorGrid` 的实心地面(它同时承载地板颜色)。
 * 另起一张接收面会与地面共面闪烁,并多一次全屏绘制。
 * 关闭即整体卸载,深度图不再产生成本——这才是开关的意义。
 */
export const StudioShadowRig = observer(function StudioShadowRig() {
    const { scene, studio } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const enabled = studio.shadowsEnabled;
    const gridSizeMeters = studio.gridSizeMeters;
    const revision = scene.revision;
    const extent = Math.max(gridSizeMeters, SHADOW_MIN_EXTENT_METERS);

    useEffect(() => {
        invalidate();
    }, [invalidate, enabled, extent, revision]);

    if (!enabled) return null;

    // 正交投影框跟随地板范围:给小了远处主体没有投影,给大了同一张深度图摊薄、投影发虚。
    const half = extent / 2;
    return (
        <>
            <directionalLight
                castShadow
                color={SHADOW_LIGHT_COLOR}
                intensity={SHADOW_LIGHT_INTENSITY}
                position={SHADOW_LIGHT_POSITION}
                shadow-mapSize-width={SHADOW_MAP_SIZE}
                shadow-mapSize-height={SHADOW_MAP_SIZE}
                shadow-camera-left={-half}
                shadow-camera-right={half}
                shadow-camera-top={half}
                shadow-camera-bottom={-half}
                shadow-camera-near={SHADOW_CAMERA_NEAR}
                shadow-camera-far={extent * SHADOW_CAMERA_FAR_FACTOR}
                shadow-bias={SHADOW_BIAS}
                shadow-normalBias={SHADOW_NORMAL_BIAS}
            />
        </>
    );
});
