import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactElement } from "react";
import type { DirectionalLight, Mesh, MeshStandardMaterial, Object3D, PointLight, Scene, SpotLight } from "three";
import {
    ArrowHelper,
    DirectionalLightHelper,
    Group,
    MathUtils,
    PointLightHelper,
    SpotLightHelper,
    Vector3,
} from "three";

import type { LightParams, LightType } from "@/core/LightParams";
import type { SceneObject } from "@/core/SceneObject";
import type { ModelHandle } from "@/loaders/ModelImporter";
import { LIGHTING_MODE } from "@/store/SceneStore";
import { normalizationFor } from "@/actor/ModelNormalizationPolicy";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useCaptureHelperRegistration } from "@/ui/viewport/scene/useCaptureHelperRegistration";

const LOADING_START_PROGRESS = 0;

/** 半透明显示态的不透明度:看穿布景够用,又保留足够形体轮廓判断遮挡关系。 */
const GHOST_OPACITY = 0.35;

interface GhostMaterialSnapshot {
    readonly transparent: boolean;
    readonly opacity: number;
    readonly depthWrite: boolean;
}

/**
 * ghost 前的材质原值快照(模块级,按材质实例键控)。
 * 只在首次进入 ghost 时记录:StrictMode 双跑或依赖重跑会重复应用,
 * 若每次都记录就会把已被改写的 ghost 值当成"原值",恢复后永久半透明。
 * WeakMap:材质由 ObjectMaterialRegistry 释放,快照随之被 GC,不留悬挂表项。
 */
const GHOST_MATERIAL_SNAPSHOTS = new WeakMap<MeshStandardMaterial, GhostMaterialSnapshot>();

const TMP_HELPER_LIGHT_POSITION = new Vector3();
const TMP_HELPER_TARGET_POSITION = new Vector3();
const TMP_HELPER_DIRECTION = new Vector3();
const TMP_LIGHT_MARKER_POSITION = new Vector3();

const LIGHT_MARKER_RADIUS = 0.14;
const LIGHT_MARKER_SEGMENTS = 16;
const LIGHT_MARKER_SCREEN_FRACTION = 0.12;
const DIRECTION_HELPER_LENGTH = 0.9;
const DIRECTION_HELPER_HEAD_LENGTH = 0.22;
const DIRECTION_HELPER_HEAD_WIDTH = 0.12;
const DIRECTION_HELPER_COLOR = "#ffd54f";

interface LightContentProps {
    readonly entity: SceneObject;
    readonly light: LightParams;
}

interface LightHelperRuntime {
    update(): void;
    dispose(): void;
}

interface SceneLightHelperRootProps {
    readonly entityId: string;
    readonly markerRef: MutableRefObject<Mesh | null>;
    readonly rootRef: MutableRefObject<Group | null>;
    readonly color: string;
    readonly scene: Scene;
    readonly createRuntime: (root: Group) => LightHelperRuntime | null;
}

/** 选中灯光才装配高密度辅助线框；未选中灯光仅保留可点选的颜色标记。 */
const SceneLightHelperRoot = observer(function SceneLightHelperRoot({
    entityId,
    markerRef,
    rootRef,
    color,
    scene,
    createRuntime,
}: SceneLightHelperRootProps) {
    const { capture, layout, selection } = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const registerCaptureHelper = useCaptureHelperRegistration<Group>(capture.helpers);
    const helperRuntimeRef = useRef<LightHelperRuntime | null>(null);
    const isHelperVisible = layout.authoringVisible && selection.isSelected(entityId);
    const keepMarkerScreenSize = useCallback(() => {
        const marker = markerRef.current;
        if (!marker) return;
        marker.scale.setScalar(
            camera.position.distanceTo(marker.getWorldPosition(TMP_LIGHT_MARKER_POSITION)) *
                LIGHT_MARKER_SCREEN_FRACTION,
        );
    }, [camera, markerRef]);

    useEffect(() => {
        if (!isHelperVisible || !rootRef.current) return;
        const runtime = createRuntime(rootRef.current);
        helperRuntimeRef.current = runtime;
        return () => {
            helperRuntimeRef.current = null;
            runtime?.dispose();
        };
    }, [createRuntime, isHelperVisible, rootRef]);
    useFrame(() => helperRuntimeRef.current?.update());

    // 灯光标记属编辑期辅助物:全屏预览时画面只留成片内容
    if (!layout.authoringVisible) return null;
    return createPortal(
        <group ref={registerCaptureHelper}>
            <mesh
                ref={markerRef}
                onBeforeRender={keepMarkerScreenSize}
                onClick={(event) => {
                    event.stopPropagation();
                    selection.select(entityId, { additive: event.metaKey || event.ctrlKey });
                }}
            >
                <sphereGeometry args={[LIGHT_MARKER_RADIUS, LIGHT_MARKER_SEGMENTS, LIGHT_MARKER_SEGMENTS]} />
                <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            {isHelperVisible && <group ref={rootRef} />}
        </group>,
        scene,
    );
});

class DirectionalLightHelperRuntime implements LightHelperRuntime {
    private readonly helper: DirectionalLightHelper;
    private readonly arrow: ArrowHelper;

    constructor(
        private readonly source: DirectionalLight,
        private readonly target: Object3D,
        private readonly root: Group,
    ) {
        this.helper = new DirectionalLightHelper(source, DIRECTION_HELPER_LENGTH);
        this.arrow = new ArrowHelper(
            new Vector3(0, 0, -1),
            new Vector3(),
            DIRECTION_HELPER_LENGTH,
            DIRECTION_HELPER_COLOR,
            DIRECTION_HELPER_HEAD_LENGTH,
            DIRECTION_HELPER_HEAD_WIDTH,
        );
        root.add(this.helper, this.arrow);
    }

    update(): void {
        this.helper.update();
        updateDirectionArrow(this.source, this.target, this.arrow);
    }

    dispose(): void {
        this.root.remove(this.helper, this.arrow);
        this.helper.dispose();
        this.arrow.dispose();
    }
}

class PointLightHelperRuntime implements LightHelperRuntime {
    private readonly helper: PointLightHelper;

    constructor(
        source: PointLight,
        private readonly root: Group,
    ) {
        this.helper = new PointLightHelper(source, DIRECTION_HELPER_LENGTH);
        root.add(this.helper);
    }

    update(): void {
        this.helper.update();
    }

    dispose(): void {
        this.root.remove(this.helper);
        this.helper.dispose();
    }
}

class SpotLightHelperRuntime implements LightHelperRuntime {
    private readonly helper: SpotLightHelper;
    private readonly arrow: ArrowHelper;

    constructor(
        private readonly source: SpotLight,
        private readonly target: Object3D,
        private readonly root: Group,
    ) {
        this.helper = new SpotLightHelper(source);
        this.arrow = new ArrowHelper(
            new Vector3(0, 0, -1),
            new Vector3(),
            DIRECTION_HELPER_LENGTH,
            DIRECTION_HELPER_COLOR,
            DIRECTION_HELPER_HEAD_LENGTH,
            DIRECTION_HELPER_HEAD_WIDTH,
        );
        root.add(this.helper, this.arrow);
    }

    update(): void {
        this.helper.update();
        updateDirectionArrow(this.source, this.target, this.arrow);
    }

    dispose(): void {
        this.root.remove(this.helper, this.arrow);
        this.helper.dispose();
        this.arrow.dispose();
    }
}

function updateMarkerPosition(source: Object3D, marker: Object3D): void {
    marker.position.setFromMatrixPosition(source.matrixWorld);
}

function updateDirectionArrow(source: Object3D, target: Object3D, arrow: ArrowHelper): void {
    TMP_HELPER_LIGHT_POSITION.setFromMatrixPosition(source.matrixWorld);
    TMP_HELPER_TARGET_POSITION.setFromMatrixPosition(target.matrixWorld);
    TMP_HELPER_DIRECTION.subVectors(TMP_HELPER_TARGET_POSITION, TMP_HELPER_LIGHT_POSITION);
    const length = TMP_HELPER_DIRECTION.length();
    if (length === 0) {
        arrow.visible = false;
        return;
    }
    arrow.visible = true;
    arrow.position.copy(TMP_HELPER_LIGHT_POSITION);
    arrow.setDirection(TMP_HELPER_DIRECTION.multiplyScalar(1 / length));
    arrow.setLength(
        length,
        Math.min(DIRECTION_HELPER_HEAD_LENGTH, length),
        Math.min(DIRECTION_HELPER_HEAD_WIDTH, length / 2),
    );
}

function DirectionalLightContent({ entity, light }: LightContentProps) {
    const scene = useThree((state) => state.scene);
    const lightRef = useRef<DirectionalLight | null>(null);
    const targetRef = useRef<Group | null>(null);
    const helperRootRef = useRef<Group | null>(null);
    const markerRef = useRef<Mesh | null>(null);
    const createRuntime = useCallback((root: Group) => {
        const source = lightRef.current;
        const target = targetRef.current;
        return source && target ? new DirectionalLightHelperRuntime(source, target, root) : null;
    }, []);

    useEffect(() => {
        const source = lightRef.current;
        const target = targetRef.current;
        if (!source || !target) return;
        source.target = target;
    }, [scene]);
    useFrame(() => {
        const source = lightRef.current;
        const marker = markerRef.current;
        if (!source || !marker) return;
        updateMarkerPosition(source, marker);
    });

    return (
        <>
            <directionalLight ref={lightRef} color={light.color} intensity={light.intensity} />
            <group ref={targetRef} position={[0, 0, -1]} />
            <SceneLightHelperRoot
                entityId={entity.id}
                markerRef={markerRef}
                rootRef={helperRootRef}
                color={light.color}
                scene={scene}
                createRuntime={createRuntime}
            />
        </>
    );
}
function PointLightContent({ entity, light }: LightContentProps) {
    const scene = useThree((state) => state.scene);
    const lightRef = useRef<PointLight | null>(null);
    const helperRootRef = useRef<Group | null>(null);
    const markerRef = useRef<Mesh | null>(null);
    const pointLight = light.type === "point" ? light : null;
    const createRuntime = useCallback((root: Group) => {
        const source = lightRef.current;
        return source ? new PointLightHelperRuntime(source, root) : null;
    }, []);

    useFrame(() => {
        const source = lightRef.current;
        const marker = markerRef.current;
        if (!source || !marker) return;
        updateMarkerPosition(source, marker);
    });

    if (!pointLight) return null;
    return (
        <>
            <pointLight
                ref={lightRef}
                color={pointLight.color}
                intensity={pointLight.intensity}
                distance={pointLight.distance}
                decay={pointLight.decay}
            />
            <SceneLightHelperRoot
                entityId={entity.id}
                markerRef={markerRef}
                rootRef={helperRootRef}
                color={pointLight.color}
                scene={scene}
                createRuntime={createRuntime}
            />
        </>
    );
}
function SpotLightContent({ entity, light }: LightContentProps) {
    const scene = useThree((state) => state.scene);
    const lightRef = useRef<SpotLight | null>(null);
    const targetRef = useRef<Group | null>(null);
    const helperRootRef = useRef<Group | null>(null);
    const markerRef = useRef<Mesh | null>(null);
    const spotLight = light.type === "spot" ? light : null;
    const createRuntime = useCallback((root: Group) => {
        const source = lightRef.current;
        const target = targetRef.current;
        return source && target ? new SpotLightHelperRuntime(source, target, root) : null;
    }, []);

    useEffect(() => {
        const source = lightRef.current;
        const target = targetRef.current;
        if (!source || !target) return;
        source.target = target;
    }, [scene]);
    useFrame(() => {
        const source = lightRef.current;
        const marker = markerRef.current;
        if (!source || !marker) return;
        updateMarkerPosition(source, marker);
    });

    if (!spotLight) return null;
    return (
        <>
            <spotLight
                ref={lightRef}
                color={spotLight.color}
                intensity={spotLight.intensity}
                angle={MathUtils.degToRad(spotLight.angleDegrees)}
                distance={spotLight.distance}
                decay={spotLight.decay}
                penumbra={spotLight.penumbra}
            />
            <group ref={targetRef} position={[0, 0, -1]} />
            <SceneLightHelperRoot
                entityId={entity.id}
                markerRef={markerRef}
                rootRef={helperRootRef}
                color={spotLight.color}
                scene={scene}
                createRuntime={createRuntime}
            />
        </>
    );
}

type LightContentComponent = (props: LightContentProps) => ReactElement | null;

const LIGHT_CONTENT: Record<LightType, LightContentComponent> = {
    directional: DirectionalLightContent,
    point: PointLightContent,
    spot: SpotLightContent,
};

/** 实光属于实体运行时 group；仅 custom 模式创建自定义 Three 灯，避免和 StudioRig 叠加。 */
const ObservedLightContent = observer(function ObservedLightContent({ entity }: { entity: SceneObject }) {
    const { scene } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const light = entity.light;
    const lightingMode = scene.lightingMode;
    useEffect(() => invalidate(), [invalidate, light, lightingMode]);
    if (!light || lightingMode !== LIGHTING_MODE.CUSTOM) return null;
    const Content = LIGHT_CONTENT[light.type];
    return <Content entity={entity} light={light} />;
});

/** 常规函数组件出口使 Fast Refresh 只看见组件导出，响应式读取留在内部 observer。 */
export function LightContent({ entity }: { entity: SceneObject }) {
    return <ObservedLightContent entity={entity} />;
}

/**
 * 模型实体内容:异步加载 → 挂克隆体;加载中/失败显示线框占位。
 * 加载完成后必须显式 invalidate()——frameloop="demand" 下异步结果不会自动触发渲染。
 * 卸载纪律:effect cleanup 调 handle.release(),引用计数归零后 GL 资源由 ModelImporter 统一释放。
 */
export function ModelContent({ entity }: { entity: SceneObject }) {
    const requestKey = JSON.stringify([entity.id, entity.sourceUrl, entity.format]);
    return <ModelRequestContent key={requestKey} entity={entity} />;
}

function ModelRequestContentInner({ entity }: { entity: SceneObject }) {
    const { actorRuntime, binder, materials, models, playback, scene, ui, skeletons } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    // 配置缺失(无 url/格式)属静态错误,渲染期直接呈现失败占位,不进 effect
    const sourceUrl = entity.sourceUrl;
    const format = entity.format;
    const requestId = entity.id;
    const [handle, setHandle] = useState<ModelHandle | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const failed = sourceUrl === null || format === null || loadFailed;
    // 渲染期直读量纲(observer 订阅):set-spatial-scale 重标定后落尺 effect 依它重跑;
    // 组件本不读实体字段,不包 observer 这条订阅就不存在,重标定会静默无效(实测)。
    const spatialScale = entity.spatialScale;
    // 同理直读半透明显示态:observer 壳建立订阅,object.set-ghost 后下方材质 effect 才会重跑。
    const ghost = entity.ghost;

    useEffect(() => {
        if (sourceUrl === null || format === null) {
            ui.clearLoading(requestId);
            return;
        }

        const abortController = new AbortController();
        const request = { cancelled: false, acquired: null as ModelHandle | null };
        ui.reportLoading(requestId, LOADING_START_PROGRESS);
        models
            .acquire(sourceUrl, format, {
                signal: abortController.signal,
                onProgress: (progress01) => ui.reportLoading(requestId, progress01),
            })
            .then((loadedHandle) => {
                if (request.cancelled) {
                    loadedHandle.release();
                    return;
                }
                ui.clearLoading(requestId);
                request.acquired = loadedHandle;
                // 此处**不**报 "loaded":句柄到手离内容进场还差一次提交(壳层构造 → primitive 挂到运行时组)。
                // 在这里落账会让结局表早于真实骨架若干帧转 loaded,动作挂载据此对空壳 root 预检 → 误判
                // bone-incompatible。结局改由壳层挂载 effect 落账(见下),两者寿命一致。
                setHandle(loadedHandle);
                invalidate();
            })
            .catch((error: unknown) => {
                if (request.cancelled) return;
                ui.clearLoading(requestId);
                console.warn(`[ModelContent] 加载失败 ${sourceUrl}`, error);
                ui.reportModelOutcome(requestId, "failed");
                setLoadFailed(true);
                invalidate();
            });
        return () => {
            request.cancelled = true;
            abortController.abort();
            ui.clearLoading(requestId);
            // 失败结局由本 effect 落账,也必须由本 effect 撤回(成功结局归壳层 effect,见下)。
            // 只清 loading 会留下一条陈旧结局,同 id 重新装载时就绪判据当场失真。
            ui.forgetModelOutcome(requestId);
            request.acquired?.release();
        };
    }, [models, ui, sourceUrl, format, requestId, invalidate]);

    // 壳按 handle 钉住:渲染期重复构造会导致 <primitive> 反复重挂载。
    // 归一化推迟到首轮渲染后(useFrame):蒙皮骨架矩阵由渲染器初始化,克隆期测量必失真(armature 缩放型 rig 会错百倍)
    const shell = useMemo(() => {
        if (!handle) return null;
        const group = new Group();
        group.add(handle.object3d);
        return group;
    }, [handle]);
    const fittedRef = useRef(false);
    const shellFramesRef = useRef(0);
    // 文档导入换新实体实例但 id/url/format 不变,壳层沿用旧的:落尺必须按新实体的量纲重跑一次。
    // 否则壳层保留上一份归一化结果,与新实体 transform 的配比错位(实测背景墙因此不可见)。
    // spatialScale 同理:运行期量纲重标定(object.set-spatial-scale)后必须重新落尺。
    useEffect(() => {
        fittedRef.current = false;
        shellFramesRef.current = 0;
        invalidate();
    }, [entity, shell, spatialScale, invalidate]);
    useFrame(() => {
        if (fittedRef.current || !shell) return;
        // useFrame 在渲染前触发;首帧渲染才初始化骨架矩阵 → 第二帧再测量
        shellFramesRef.current += 1;
        if (shellFramesRef.current < 2) {
            invalidate();
            return;
        }
        fittedRef.current = true;
        normalizationFor(entity).normalize(shell);
        invalidate();
    });

    useEffect(() => {
        if (!shell) return;
        skeletons.register(entity.id, shell);
        // 人偶画像落到 Three(材质克隆 + 骨骼缩放)与骨骼索引同一时机,卸载时一并摘除
        actorRuntime.attach(entity.id, shell);
        // 投影投射标记:一次性遍历本模型的壳层(不是整棵场景树),与骨骼索引同一时机。
        // 恒置 true 与开关无冲突——`castShadow` 只在渲染器开了 shadowMap 时才计价,
        // 投影关闭时 StudioShadowRig 整体卸载,没有投射光,这个标记不产生任何成本。
        shell.traverse((node) => {
            const mesh = node as { isMesh?: boolean; isSkinnedMesh?: boolean; castShadow?: boolean };
            if (mesh.isMesh === true || mesh.isSkinnedMesh === true) mesh.castShadow = true;
        });
        return () => {
            actorRuntime.detach(entity.id);
            skeletons.unregister(entity.id);
        };
    }, [actorRuntime, skeletons, entity.id, shell]);

    /**
     * 半透明显示态落到 Three:只改本实例克隆材质的透明三项 + 壳层投影投射标记。
     *
     * 只动 `materials.materialsOf` 返回的克隆材质:那是本实例独占的槽位。OBJ/FBX 的非标准
     * 材质(Phong/Basic)在同 URL 的所有实例间共享(见 ObjectMaterialRegistry),
     * 改它会让全场同资产模型一起变半透明,还会跨桌泄漏——故一律不动,宁可该实例不透明。
     * 灯光实体没有克隆材质,materialsOf 返回空数组,循环自然空转,无需特判。
     *
     * 必须排在壳层挂载 effect 之后:克隆材质由 actorRuntime.attach 建立,顺序反了就取到空表。
     */
    useEffect(() => {
        if (!shell) return;
        const applyCastShadow = (cast: boolean): void => {
            shell.traverse((node) => {
                const mesh = node as { isMesh?: boolean; isSkinnedMesh?: boolean; castShadow?: boolean };
                if (mesh.isMesh === true || mesh.isSkinnedMesh === true) mesh.castShadow = cast;
            });
        };
        const restore = (): void => {
            // 卸载路径上壳层材质可能已被 detach 回收,materialsOf 返回空表,此时循环空转即正确行为
            for (const material of materials.materialsOf(entity.id)) {
                const snapshot = GHOST_MATERIAL_SNAPSHOTS.get(material);
                if (!snapshot) continue;
                material.transparent = snapshot.transparent;
                material.opacity = snapshot.opacity;
                material.depthWrite = snapshot.depthWrite;
                // transparent 改变会切换渲染队列与混合状态,着色器需重编译:不置 needsUpdate 则本帧仍按旧管线画
                material.needsUpdate = true;
                GHOST_MATERIAL_SNAPSHOTS.delete(material);
            }
            applyCastShadow(true);
            invalidate();
        };
        if (!ghost) {
            restore();
            return;
        }
        for (const material of materials.materialsOf(entity.id)) {
            // 快照只在首次记录:StrictMode 双跑(及依赖重跑)会重复应用,重复记录会把 ghost 值当原值
            if (!GHOST_MATERIAL_SNAPSHOTS.has(material)) {
                GHOST_MATERIAL_SNAPSHOTS.set(material, {
                    transparent: material.transparent,
                    opacity: material.opacity,
                    depthWrite: material.depthWrite,
                });
            }
            material.transparent = true;
            material.opacity = GHOST_OPACITY;
            // 关掉深度写入:同一实体的前后表面才不会互相剔除,看穿才是连续的
            material.depthWrite = false;
            material.needsUpdate = true;
        }
        // 半透明体的投影是噪声(shadow map 不含 alpha,阴影仍是实心的),看穿期间不投射
        applyCastShadow(false);
        invalidate();
        return restore;
    }, [materials, entity.id, ghost, shell, invalidate]);

    // 文档导入用同 id 的新实体整体替换并清空骨骼索引:此处补登记并把新画像重新落到运行时。
    // 依赖实体实例——同一次挂载内它不变,导入后才换新,不会造成重复工作。
    //
    // 装载结局也在这里落账/撤回,而非「壳层挂载」那个 effect:
    //  - 必须晚于句柄到手。`ModelImporter.acquire` resolve 时内容还没提交到运行时组,
    //    在那里报 loaded 会让结局表早于真实骨架转 loaded,动作恢复据此对空壳 root 预检,
    //    得到匹配率 0% 并被判 bone-incompatible(实测路径:导入 → 清空 → 再导入)。
    //  - 又必须跟随**实体实例**。`object.remove` + 撤销会换新实体实例,但 id/url/format 不变,
    //    React 复用同一组件与壳层,只依赖 shell 的 effect 不会重跑;结局便永久停在缺失,
    //    该对象卡在 "loading",间距语义闸门(place-relative/scene.stage)从此拒绝它。
    useEffect(() => {
        if (!shell) return;
        if (!skeletons.discover(entity.id).ready) skeletons.register(entity.id, shell);
        actorRuntime.sync(entity.id);
        // 壳换新体(画质档切换重建 Canvas → R3F 整树重挂载)时,已落账的动作排期仍在实体上,
        // 但 mixer 还绑着旧克隆体的骨骼。不重绑就是「时间轴有段条、播放无动作」。
        // 根取 SceneManager 运行时(与 action.mount 同一个),两处根一致才能靠身份比较判断换体。
        const runtime = scene.manager.getRuntime(entity.id);
        if (runtime) binder.rebindRuntime(entity.id, runtime);
        playback.sampleObject(entity.id);
        ui.reportModelOutcome(entity.id, "loaded");
        return () => {
            ui.forgetModelOutcome(entity.id);
        };
    }, [actorRuntime, skeletons, binder, playback, scene, ui, entity, shell]);
    if (shell) return <primitive object={shell} />;
    return (
        <mesh>
            <boxGeometry />
            <meshBasicMaterial wireframe color={failed ? "#e53935" : "#757575"} />
        </mesh>
    );
}

/** observer 壳:让实体字段(spatialScale 等)的渲染期直读真正建立 MobX 订阅。 */
const ModelRequestContent = observer(ModelRequestContentInner);
