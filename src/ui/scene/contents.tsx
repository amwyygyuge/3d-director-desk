import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { DirectionalLight, Mesh, Object3D, PointLight, Scene, SpotLight } from "three";
import { ArrowHelper, Box3, DirectionalLightHelper, Group, PointLightHelper, SpotLightHelper, Vector3 } from "three";

import type { LightParams, LightType } from "../../core/LightParams";
import type { SceneObject } from "../../core/SceneObject";
import type { ModelHandle } from "../../loaders/ModelImporter";
import { STAGE_DEFS } from "../../workspace/stages";
import { useDirectorDeskStores } from "../DirectorDeskContext";

/** 每个 id 一个稳定区分色:走查时肉眼可辨,与选择态高亮解耦 */
const PALETTE = ["#7e57c2", "#26a69a", "#ef6c00", "#5c6bc0", "#c0ca33", "#8d6e63"] as const;

function colorOf(id: string): string {
    const hash = [...id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return PALETTE[hash % PALETTE.length]!;
}

/** 导入模型归一化目标:最大边缩放到 2 个场景单位,底面贴地——游戏模型单位各异(cm/m),裸放会糊满屏 */
const MODEL_TARGET_MAX_DIM = 2;
const LOADING_START_PROGRESS = 0;

const TMP_BOX = new Box3();
const TMP_SIZE = new Vector3();
const TMP_CENTER = new Vector3();
const TMP_HELPER_LIGHT_POSITION = new Vector3();
const TMP_HELPER_TARGET_POSITION = new Vector3();
const TMP_HELPER_DIRECTION = new Vector3();

/** 给克隆体套归一化壳:等比缩放 + 水平居中 + 底面贴 y=0;实体 transform 仍是用户语义 */
function normalizedShell(object3d: Object3D): Object3D {
    TMP_BOX.setFromObject(object3d);
    TMP_BOX.getSize(TMP_SIZE);
    TMP_BOX.getCenter(TMP_CENTER);
    const maxDim = Math.max(TMP_SIZE.x, TMP_SIZE.y, TMP_SIZE.z);
    const factor = maxDim > 0 ? MODEL_TARGET_MAX_DIM / maxDim : 1;
    const shell = new Group();
    shell.scale.setScalar(factor);
    shell.position.set(-TMP_CENTER.x * factor, -TMP_BOX.min.y * factor, -TMP_CENTER.z * factor);
    shell.add(object3d);
    return shell;
}

export function PrimitiveContent({ entity }: { entity: SceneObject }) {
    return (
        <mesh>
            <boxGeometry />
            <meshStandardMaterial color={colorOf(entity.id)} />
        </mesh>
    );
}

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

interface SceneLightHelperRootProps {
    readonly entityId: string;
    readonly markerRef: MutableRefObject<Mesh | null>;
    readonly rootRef: MutableRefObject<Group | null>;
    readonly color: string;
    readonly scene: Scene;
}

const SceneLightHelperRoot = observer(function SceneLightHelperRoot({
    entityId,
    markerRef,
    rootRef,
    color,
    scene,
}: SceneLightHelperRootProps) {
    const { selection, ui } = useDirectorDeskStores();
    // 阶段透镜:灯光标记只在布景阶段显示(打灯已并入布景)
    if (!STAGE_DEFS[ui.stage].helpers.lightHelpers) return null;
    return createPortal(
        <group ref={rootRef} userData={{ helper: true }}>
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
        </group>,
        scene,
    );
});

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
    const helperRef = useRef<DirectionalLightHelper | null>(null);
    const arrowRef = useRef<ArrowHelper | null>(null);

    useEffect(() => {
        const source = lightRef.current;
        const target = targetRef.current;
        const root = helperRootRef.current;
        if (!source || !target || !root) return;
        source.target = target;
        const helper = new DirectionalLightHelper(source, DIRECTION_HELPER_LENGTH);
        const arrow = new ArrowHelper(
            new Vector3(0, 0, -1),
            new Vector3(),
            DIRECTION_HELPER_LENGTH,
            DIRECTION_HELPER_COLOR,
            DIRECTION_HELPER_HEAD_LENGTH,
            DIRECTION_HELPER_HEAD_WIDTH,
        );
        helperRef.current = helper;
        arrowRef.current = arrow;
        root.add(helper, arrow);
        return () => {
            helperRef.current = null;
            arrowRef.current = null;
            root.remove(helper, arrow);
            helper.dispose();
            arrow.dispose();
        };
    }, [scene]);

    useEffect(() => {
        helperRef.current?.update();
    }, [light]);
    useFrame(() => {
        const source = lightRef.current;
        const target = targetRef.current;
        const marker = markerRef.current;
        const helper = helperRef.current;
        const arrow = arrowRef.current;
        if (!source || !target || !marker || !helper || !arrow) return;
        helper.update();
        updateMarkerPosition(source, marker);
        updateDirectionArrow(source, target, arrow);
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
            />
        </>
    );
}

function PointLightContent({ entity, light }: LightContentProps) {
    const scene = useThree((state) => state.scene);
    const lightRef = useRef<PointLight | null>(null);
    const helperRootRef = useRef<Group | null>(null);
    const markerRef = useRef<Mesh | null>(null);
    const helperRef = useRef<PointLightHelper | null>(null);

    useEffect(() => {
        const source = lightRef.current;
        const root = helperRootRef.current;
        if (!source || !root) return;
        const helper = new PointLightHelper(source, DIRECTION_HELPER_LENGTH);
        helperRef.current = helper;
        root.add(helper);
        return () => {
            helperRef.current = null;
            root.remove(helper);
            helper.dispose();
        };
    }, [scene]);

    useEffect(() => {
        helperRef.current?.update();
    }, [light]);
    useFrame(() => {
        const source = lightRef.current;
        const marker = markerRef.current;
        const helper = helperRef.current;
        if (!source || !marker || !helper) return;
        helper.update();
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
    const helperRef = useRef<SpotLightHelper | null>(null);
    const arrowRef = useRef<ArrowHelper | null>(null);

    useEffect(() => {
        const source = lightRef.current;
        const target = targetRef.current;
        const root = helperRootRef.current;
        if (!source || !target || !root) return;
        source.target = target;
        const helper = new SpotLightHelper(source);
        const arrow = new ArrowHelper(
            new Vector3(0, 0, -1),
            new Vector3(),
            DIRECTION_HELPER_LENGTH,
            DIRECTION_HELPER_COLOR,
            DIRECTION_HELPER_HEAD_LENGTH,
            DIRECTION_HELPER_HEAD_WIDTH,
        );
        helperRef.current = helper;
        arrowRef.current = arrow;
        root.add(helper, arrow);
        return () => {
            helperRef.current = null;
            arrowRef.current = null;
            root.remove(helper, arrow);
            helper.dispose();
            arrow.dispose();
        };
    }, [scene]);

    useEffect(() => {
        helperRef.current?.update();
    }, [light]);
    useFrame(() => {
        const source = lightRef.current;
        const target = targetRef.current;
        const marker = markerRef.current;
        const helper = helperRef.current;
        const arrow = arrowRef.current;
        if (!source || !target || !marker || !helper || !arrow) return;
        helper.update();
        updateMarkerPosition(source, marker);
        updateDirectionArrow(source, target, arrow);
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
    const { models, playback, ui, skeletons } = useDirectorDeskStores();
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
                setHandle(loadedHandle);
                invalidate();
            })
            .catch((error: unknown) => {
                if (request.cancelled) return;
                ui.clearLoading(requestId);
                console.warn(`[ModelContent] 加载失败 ${sourceUrl}`, error);
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

    // 归一化壳按 handle 钉住:渲染期重复构造会导致 <primitive> 反复重挂载
    const shell = useMemo(() => (handle ? normalizedShell(handle.object3d) : null), [handle]);

    useEffect(() => {
        if (!shell) return;
        skeletons.register(entity.id, shell);
        playback.sampleObject(entity.id);
        return () => skeletons.unregister(entity.id);
    }, [skeletons, playback, entity.id, shell]);
    if (shell) return <primitive object={shell} />;
    return (
        <mesh>
            <boxGeometry />
            <meshBasicMaterial wireframe color={failed ? "#e53935" : "#757575"} />
        </mesh>
    );
}
