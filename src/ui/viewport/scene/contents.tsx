import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { DirectionalLight, Mesh, Object3D, PointLight, Scene, SpotLight } from "three";
import { ArrowHelper, DirectionalLightHelper, Group, PointLightHelper, SpotLightHelper, Vector3 } from "three";

import type { LightParams, LightType } from "@/core/LightParams";
import type { SceneObject } from "@/core/SceneObject";
import type { ModelHandle } from "@/loaders/ModelImporter";
import { normalizationFor } from "@/actor/ModelNormalizationPolicy";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const LOADING_START_PROGRESS = 0;

const TMP_HELPER_LIGHT_POSITION = new Vector3();
const TMP_HELPER_TARGET_POSITION = new Vector3();
const TMP_HELPER_DIRECTION = new Vector3();

const LIGHT_MARKER_RADIUS = 0.14;
const LIGHT_MARKER_SEGMENTS = 16;
const DIRECTION_HELPER_LENGTH = 0.9;
const DIRECTION_HELPER_HEAD_LENGTH = 0.22;
const DIRECTION_HELPER_HEAD_WIDTH = 0.12;
const DIRECTION_HELPER_COLOR = "#ffd54f";
const SPOT_CONE_ANGLE_RAD = Math.PI / 6;
const SPOT_RANGE = 10;
const SPOT_PENUMBRA = 0.35;

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
    const { layout, selection } = useDirectorDeskStores();
    const helperRuntimeRef = useRef<LightHelperRuntime | null>(null);
    const isHelperVisible = layout.authoringVisible && selection.isSelected(entityId);

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
        <group userData={{ helper: true }}>
            <mesh
                ref={markerRef}
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

    constructor(source: PointLight, private readonly root: Group) {
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

    constructor(private readonly source: SpotLight, private readonly target: Object3D, private readonly root: Group) {
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

    return (
        <>
            <pointLight ref={lightRef} color={light.color} intensity={light.intensity} />
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

function SpotLightContent({ entity, light }: LightContentProps) {
    const scene = useThree((state) => state.scene);
    const lightRef = useRef<SpotLight | null>(null);
    const targetRef = useRef<Group | null>(null);
    const helperRootRef = useRef<Group | null>(null);
    const markerRef = useRef<Mesh | null>(null);
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

    return (
        <>
            <spotLight
                ref={lightRef}
                color={light.color}
                intensity={light.intensity}
                angle={SPOT_CONE_ANGLE_RAD}
                distance={SPOT_RANGE}
                penumbra={SPOT_PENUMBRA}
            />
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

const LIGHT_CONTENT: Record<LightType, typeof DirectionalLightContent> = {
    directional: DirectionalLightContent,
    point: PointLightContent,
    spot: SpotLightContent,
};

/** 实光属于实体运行时 group；辅助根 portal 到 Scene 世界空间，截图摘除时不会影响照明。 */
const ObservedLightContent = observer(function ObservedLightContent({ entity }: { entity: SceneObject }) {
    const invalidate = useThree((state) => state.invalidate);
    const light = entity.light;
    useEffect(() => invalidate(), [invalidate, light]);
    if (!light) return null;
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

function ModelRequestContent({ entity }: { entity: SceneObject }) {
    const { actorRuntime, models, playback, ui, skeletons } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    // 配置缺失(无 url/格式)属静态错误,渲染期直接呈现失败占位,不进 effect
    const sourceUrl = entity.sourceUrl;
    const format = entity.format;
    const requestId = entity.id;
    const [handle, setHandle] = useState<ModelHandle | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const failed = sourceUrl === null || format === null || loadFailed;

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
                ui.reportModelOutcome(requestId, "loaded");
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
        return () => {
            actorRuntime.detach(entity.id);
            skeletons.unregister(entity.id);
        };
    }, [actorRuntime, skeletons, entity.id, shell]);

    // 文档导入用同 id 的新实体整体替换并清空骨骼索引:此处补登记并把新画像重新落到运行时。
    // 依赖实体实例——同一次挂载内它不变,导入后才换新,不会造成重复工作。
    useEffect(() => {
        if (!shell) return;
        if (!skeletons.discover(entity.id).ready) skeletons.register(entity.id, shell);
        actorRuntime.sync(entity.id);
        playback.sampleObject(entity.id);
    }, [actorRuntime, skeletons, playback, entity, shell]);
    if (shell) return <primitive object={shell} />;
    return (
        <mesh>
            <boxGeometry />
            <meshBasicMaterial wireframe color={failed ? "#e53935" : "#757575"} />
        </mesh>
    );
}
