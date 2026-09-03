import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { reaction } from "mobx";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    BufferAttribute,
    BufferGeometry,
    Color,
    Line as ThreeLine,
    LineBasicMaterial,
    LineDashedMaterial,
    LineSegments as ThreeLineSegments,
    Plane,
    Raycaster,
    Vector2,
    Vector3,
} from "three";
import type { Group } from "three";

import type { CameraFollowTrack } from "@/camera/CameraFollowTrack";
import type { CameraKey } from "@/camera/CameraKey";
import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import { FOLLOW_SPACE, followSpaceCodecFor } from "@/camera/FollowSpaceCodec";
import type { FollowSpaceCodec } from "@/camera/FollowSpaceCodec";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import type { Vec3 } from "@/core/SceneObject";
import type { SceneManager } from "@/core/SceneManager";
import { AutoHandleSolver, createHandlePair } from "@/motion/AutoHandleSolver";
import { createPositionSample } from "@/motion/MotionTrajectory";
import type { MotionPositionSample } from "@/motion/MotionTrajectory";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { SubjectFrameResolver } from "@/motion/SubjectFrameResolver";
import { SubjectFrameSample } from "@/motion/SubjectFrameSample";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useOrbitSuspension } from "@/ui/viewport/scene/useOrbitSuspension";

const PATH_SAMPLES_PER_SEGMENT = 24;
const POSITION_COMPONENTS = 3;
const STRAP_VERTEX_COUNT = 2;
const KEY_RADIUS_METERS = 0.11;
const HANDLE_RADIUS_METERS = 0.075;
const KEY_COLOR = "#6366f1";
const SWEEP_OPACITY = 0.35;
const SELECTED_KEY_COLOR = "#a5b4fc";
const AUTO_HANDLE_COLOR = "#818cf8";
const MANUAL_HANDLE_COLOR = "#f5f3ff";
const FOLLOW_SUBJECT_COLOR = "#10b981";
const FOLLOW_FRAME_UNAVAILABLE_NOTICE = "跟拍主体当前无法定位,未保存关键帧修改";
const STRAP_CAMERA_COLOR = new Color(KEY_COLOR);
const STRAP_SUBJECT_COLOR = new Color(FOLLOW_SUBJECT_COLOR);

const TMP_CAMERA_FORWARD = new Vector3();
const TMP_INTERSECTION = new Vector3();
const TMP_DRAG_PLANE = new Plane();
const TMP_RAYCASTER = new Raycaster();
const TMP_POINTER = new Vector2();
const HANDLE_SOLVER = new AutoHandleSolver();
/** 屏幕坐标 → NDC 的量程(0~1 映射到 -1~1) */
const NDC_SPAN = 2;

/** 选中一枚关键帧即把右栏收敛到独立运镜资产,不再选择创建来源机位。 */
function selectMotionKey(stores: DirectorDeskStores, clipId: string, keyId: string): void {
    stores.selection.clear();
    stores.timelineSelection.select(TimelineSelection.motionKey(clipId, keyId));
}

interface FollowPreviewGeometry {
    readonly relativePath: BufferGeometry;
    readonly relativeLine: ThreeLine;
    readonly relativeMaterial: LineDashedMaterial;
    readonly strap: BufferGeometry;
    readonly strapLine: ThreeLineSegments;
    readonly strapMaterial: LineBasicMaterial;
    readonly frame: SubjectFrameSample;
    readonly sample: MotionPositionSample;
}

interface DragState {
    readonly kind: "key" | "in" | "out";
    readonly target: Group;
    readonly geometry: BufferGeometry | null;
    readonly codec: FollowSpaceCodec | null;
    readonly follow: CameraFollowTrack | null;
    readonly timeSeconds: number;
}

export interface MotionKeyContextRequest {
    readonly clientX: number;
    readonly clientY: number;
}

export interface MotionClipPathPreviewProps {
    readonly clipId: string;
    readonly onKeyContextMenu: (request: MotionKeyContextRequest) => void;
}

function sampleCountFor(clip: CameraMotionClip): number {
    return clip.trajectory.segmentCount * PATH_SAMPLES_PER_SEGMENT;
}

function createPathGeometry(clip: CameraMotionClip): BufferGeometry {
    const sampleCount = sampleCountFor(clip);
    const positions = new Float32Array((sampleCount + 1) * 3);
    const sample = createPositionSample();
    // 索引式取样避免轨迹预览构建时产生迭代器和闭包。
    for (let step = 0; step <= sampleCount; step += 1) {
        clip.trajectory.samplePosition(step / sampleCount, sample);
        const offset = step * 3;
        positions[offset] = sample.x;
        positions[offset + 1] = sample.y;
        positions[offset + 2] = sample.z;
    }
    const path = new BufferGeometry();
    path.setAttribute("position", new BufferAttribute(positions, 3));
    return path;
}

function seedFrameAtSubject(frame: SubjectFrameSample, follow: CameraFollowTrack, scene: SceneManager): void {
    const entity = scene.getEntity(follow.objectId);
    if (!entity) return;
    const position = entity.transform.position;
    frame.originX = position[0];
    frame.originY = position[1];
    frame.originZ = position[2];
}

function createFollowSweepGeometry(
    clip: CameraMotionClip,
    resolver: SubjectFrameResolver,
    scene: SceneManager,
): BufferGeometry {
    const follow = clip.follow;
    const geometry = createPathGeometry(clip);
    if (!follow) return geometry;
    const positions = geometry.getAttribute("position");
    if (!(positions instanceof BufferAttribute)) return geometry;
    const frame = new SubjectFrameSample();
    const sample = createPositionSample();
    const sampleCount = sampleCountFor(clip);
    seedFrameAtSubject(frame, follow, scene);
    // 索引式取样避免轨迹预览构建时产生迭代器和闭包。
    for (let step = 0; step <= sampleCount; step += 1) {
        const progress = step / sampleCount;
        if (!resolver.resolveFrame(follow, clip.timeAtProgress(progress), frame)) {
            positions.setXYZ(step, frame.originX, frame.originY, frame.originZ);
            continue;
        }
        clip.trajectory.samplePosition(progress, sample);
        frame.toWorld(sample.x, sample.y, sample.z, sample);
        positions.setXYZ(step, sample.x, sample.y, sample.z);
    }
    return geometry;
}

function createFollowStrapGeometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(STRAP_VERTEX_COUNT * POSITION_COMPONENTS);
    const colors = new Float32Array([
        STRAP_CAMERA_COLOR.r,
        STRAP_CAMERA_COLOR.g,
        STRAP_CAMERA_COLOR.b,
        STRAP_SUBJECT_COLOR.r,
        STRAP_SUBJECT_COLOR.g,
        STRAP_SUBJECT_COLOR.b,
    ]);
    geometry.setAttribute("position", new BufferAttribute(positions, POSITION_COMPONENTS));
    geometry.setAttribute("color", new BufferAttribute(colors, POSITION_COMPONENTS));
    return geometry;
}

function createFollowGeometry(
    clip: CameraMotionClip,
    follow: CameraFollowTrack,
    scene: SceneManager,
): FollowPreviewGeometry {
    const relativePath = createPathGeometry(clip);
    const relativeMaterial = new LineDashedMaterial({
        color: KEY_COLOR,
        dashSize: 0.18,
        gapSize: 0.12,
        toneMapped: false,
    });
    const relativeLine = new ThreeLine(relativePath, relativeMaterial);
    const strap = createFollowStrapGeometry();
    const strapMaterial = new LineBasicMaterial({ vertexColors: true, toneMapped: false });
    const strapLine = new ThreeLineSegments(strap, strapMaterial);
    const frame = new SubjectFrameSample();
    seedFrameAtSubject(frame, follow, scene);
    relativeLine.computeLineDistances();
    return {
        relativePath,
        relativeLine,
        relativeMaterial,
        strap,
        strapLine,
        strapMaterial,
        frame,
        sample: createPositionSample(),
    };
}

/** 相对轨迹是片段属性而非当前时刻的属性，固定在片段起点参考系以保持形状稳定。 */
function updateRelativePath(
    geometry: FollowPreviewGeometry,
    clip: CameraMotionClip,
    resolver: SubjectFrameResolver,
    timeSeconds: number,
): void {
    const follow = clip.follow;
    const positions = geometry.relativePath.getAttribute("position");
    if (!follow || !(positions instanceof BufferAttribute)) return;
    const sampleCount = sampleCountFor(clip);
    if (!resolver.resolveFrame(follow, timeSeconds, geometry.frame)) {
        collapsePathAtFrame(positions, sampleCount, geometry.frame);
        return;
    }
    // 索引式原地重写既有 BufferAttribute,禁止迭代器/临时数组分配。
    for (let step = 0; step <= sampleCount; step += 1) {
        clip.trajectory.samplePosition(step / sampleCount, geometry.sample);
        geometry.frame.toWorld(geometry.sample.x, geometry.sample.y, geometry.sample.z, geometry.sample);
        positions.setXYZ(step, geometry.sample.x, geometry.sample.y, geometry.sample.z);
    }
    positions.needsUpdate = true;
}

function collapsePathAtFrame(positions: BufferAttribute, sampleCount: number, frame: SubjectFrameSample): void {
    // 解析失败时退化为上一个成功顶点(首帧为主体当前位置),绝不保留跟随系局部坐标。
    for (let step = 0; step <= sampleCount; step += 1) {
        positions.setXYZ(step, frame.originX, frame.originY, frame.originZ);
    }
    positions.needsUpdate = true;
}

function updateFollowStrap(
    geometry: FollowPreviewGeometry,
    clip: CameraMotionClip,
    resolver: SubjectFrameResolver,
    timeSeconds: number,
): void {
    const follow = clip.follow;
    if (!follow || timeSeconds < clip.startTimeSeconds || timeSeconds > clip.endTimeSeconds) {
        geometry.strapLine.visible = false;
        return;
    }
    const positions = geometry.strap.getAttribute("position");
    if (!(positions instanceof BufferAttribute)) {
        geometry.strapLine.visible = false;
        return;
    }
    if (!resolver.resolveFrame(follow, timeSeconds, geometry.frame)) {
        geometry.strapLine.visible = false;
        return;
    }
    clip.trajectory.samplePosition(clip.trajectoryProgressAt(timeSeconds), geometry.sample);
    geometry.frame.toWorld(geometry.sample.x, geometry.sample.y, geometry.sample.z, geometry.sample);
    positions.setXYZ(0, geometry.sample.x, geometry.sample.y, geometry.sample.z);
    positions.setXYZ(1, geometry.frame.originX, geometry.frame.originY, geometry.frame.originZ);
    positions.needsUpdate = true;
    geometry.strapLine.visible = true;
}

function createHandleGeometry(x: number, y: number, z: number): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, x, y, z]), 3));
    return geometry;
}

function updateHandleGeometry(geometry: BufferGeometry, handle: Group): void {
    const attribute = geometry.getAttribute("position");
    if (!(attribute instanceof BufferAttribute)) return;
    attribute.setXYZ(1, handle.position.x, handle.position.y, handle.position.z);
    attribute.needsUpdate = true;
}

function dragPosition(target: Group): Vec3 {
    return [target.position.x, target.position.y, target.position.z];
}

function keyPayload(key: CameraKey, position: Vec3) {
    return { ...key.toJSON(), position };
}

function updateRenderedHandle(
    frame: SubjectFrameSample,
    x: number,
    y: number,
    z: number,
    handle: Group | null,
    geometry: BufferGeometry | null,
    sample: MotionPositionSample,
): void {
    if (!handle || !geometry) return;
    frame.rotateToWorld(x, y, z, sample);
    handle.position.set(sample.x, sample.y, sample.z);
    updateHandleGeometry(geometry, handle);
}

function updateFollowKeyHelper(
    resolver: SubjectFrameResolver,
    follow: CameraFollowTrack,
    clip: CameraMotionClip,
    key: CameraKey,
    root: Group,
    timeSeconds: number,
    frame: SubjectFrameSample,
    sample: MotionPositionSample,
    inX: number,
    inY: number,
    inZ: number,
    inHandle: Group | null,
    inGeometry: BufferGeometry | null,
    outX: number,
    outY: number,
    outZ: number,
    outHandle: Group | null,
    outGeometry: BufferGeometry | null,
): boolean {
    if (!resolver.resolveFrame(follow, timeSeconds, frame)) return false;
    frame.toWorld(key.position[0], key.position[1], key.position[2], sample);
    root.visible = true;
    root.position.set(sample.x, sample.y, sample.z);
    updateRenderedHandle(frame, inX, inY, inZ, inHandle, inGeometry, sample);
    updateRenderedHandle(frame, outX, outY, outZ, outHandle, outGeometry, sample);
    return true;
}

/** 单段轨迹的可编辑场景辅助物;所有拖动只改 Three ref,松手才经命令层持久化。 */
export const MotionClipPathPreview = observer(function MotionClipPathPreview({
    clipId,
    onKeyContextMenu,
}: MotionClipPathPreviewProps) {
    const stores = useDirectorDeskStores();
    const { clock, scene, timeline } = stores;
    const clip = stores.motion.clip(clipId);
    const follow = clip?.follow ?? null;
    const isSelected = stores.timelineSelection.current.motionClipId === clipId;
    const subjectTrack = follow
        ? (timeline.document.trackForTarget(follow.objectId, TIMELINE_TRACK_KIND.TRANSFORM) ?? null)
        : null;
    const resolver = useMemo(() => new SubjectFrameResolver(timeline, scene.manager), [scene.manager, timeline]);
    const invalidate = useThree((state) => state.invalidate);
    // 主体轨引用是世界扫掠路径的重建键:它经 resolver 间接读取,故不出现在 memo 体内。
    // 跟拍态仅在对应层会挂载时生成几何;关闭扫掠时不采样、不保留世界路径。
    const showWorldPath = follow === null || stores.motionAuthoring.sweepPathVisible;
    const pathGeometry = useMemo(
        () => {
            if (!clip || !showWorldPath) return null;
            return follow ? createFollowSweepGeometry(clip, resolver, scene.manager) : createPathGeometry(clip);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [clip, follow, resolver, scene.manager, showWorldPath, subjectTrack],
    );
    const followGeometry = useMemo(
        () => (clip?.follow && isSelected ? createFollowGeometry(clip, clip.follow, scene.manager) : null),
        [clip, isSelected, scene.manager],
    );

    useEffect(
        () => () => {
            pathGeometry?.dispose();
        },
        [pathGeometry],
    );

    useEffect(
        () => () => {
            followGeometry?.relativePath.dispose();
            followGeometry?.relativeMaterial.dispose();
            followGeometry?.strap.dispose();
            followGeometry?.strapMaterial.dispose();
        },
        [followGeometry],
    );

    /**
     * 相对路径与绑带都锚当前播放头:跟拍的视觉证据就是「拖时间轴时轨迹跟着人走」,
     * 钉在片段起点会让作者以为跟拍没生效。
     *
     * 拖关键帧球的反解必须用同一个时刻(见 finishDrag),否则松手瞬间球会跳。
     * 播放期本就不该编辑,所以「边播边拖球」不是需要迁就的场景。
     */
    useEffect(() => {
        if (!clip || !follow || !followGeometry) return undefined;
        return reaction(
            () => clock.time,
            (timeSeconds) => {
                updateRelativePath(followGeometry, clip, resolver, timeSeconds);
                updateFollowStrap(followGeometry, clip, resolver, timeSeconds);
                invalidate();
            },
            { fireImmediately: true },
        );
    }, [clip, clock, follow, followGeometry, invalidate, resolver, subjectTrack]);

    if (!clip) return null;
    return (
        <group userData={{ helper: true, motionClipId: clip.id }}>
            {/* userData 只挂在外层 group:截图隐藏辅助物按子树生效,line 上再加属性会被 TS 解析成 SVG 元素 */}
            {pathGeometry ? (
                <line>
                    <primitive object={pathGeometry} attach="geometry" />
                    <lineBasicMaterial
                        color={KEY_COLOR}
                        opacity={follow ? SWEEP_OPACITY : 1}
                        toneMapped={false}
                        transparent={follow !== null}
                    />
                </line>
            ) : null}
            {isSelected && followGeometry ? (
                <>
                    <primitive object={followGeometry.relativeLine} />
                    <primitive object={followGeometry.strapLine} />
                </>
            ) : null}
            {clip.keys.map((key) => (
                <MotionKeyHelper key={key.id} clipId={clip.id} keyId={key.id} onContextMenu={onKeyContextMenu} />
            ))}
        </group>
    );
});

interface MotionKeyHelperProps {
    readonly clipId: string;
    readonly keyId: string;
    readonly onContextMenu: (request: MotionKeyContextRequest) => void;
}

/** 一枚镜头 key 的球体与（选中后）手柄杆;拖拽平面始终面向当前编辑相机。 */
const MotionKeyHelper = observer(function MotionKeyHelper({ clipId, keyId, onContextMenu }: MotionKeyHelperProps) {
    const stores = useDirectorDeskStores();
    const { clock, scene, timeline } = stores;
    const camera = useThree((state) => state.camera);
    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);
    const clip = stores.motion.clip(clipId);
    const key = clip?.key(keyId);
    const follow = clip?.follow ?? null;
    const subjectTrack = follow
        ? (timeline.document.trackForTarget(follow.objectId, TIMELINE_TRACK_KIND.TRANSFORM) ?? null)
        : null;
    const selected =
        stores.timelineSelection.current.motionKeyId === keyId &&
        stores.timelineSelection.current.motionClipId === clipId;
    const rootRef = useRef<Group | null>(null);
    const inHandleRef = useRef<Group | null>(null);
    const outHandleRef = useRef<Group | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const orbitSuspension = useOrbitSuspension();
    const [dragging, setDragging] = useState(false);
    const followResolver = useMemo(() => new SubjectFrameResolver(timeline, scene.manager), [scene.manager, timeline]);
    const followFrame = useMemo(() => new SubjectFrameSample(), []);
    const followSample = useMemo(() => createPositionSample(), []);
    const handleOffsets = useMemo(() => {
        const offsets = createHandlePair();
        const keyIndex = clip?.trajectory.indexOf(keyId) ?? -1;
        if (clip && keyIndex >= 0) HANDLE_SOLVER.solve(clip.keys, keyIndex, offsets);
        return offsets;
    }, [clip, keyId]);
    const inGeometry = useMemo(
        () => (key ? createHandleGeometry(handleOffsets.inX, handleOffsets.inY, handleOffsets.inZ) : null),
        [handleOffsets, key],
    );
    const outGeometry = useMemo(
        () => (key ? createHandleGeometry(handleOffsets.outX, handleOffsets.outY, handleOffsets.outZ) : null),
        [handleOffsets, key],
    );
    useEffect(
        () => () => {
            inGeometry?.dispose();
            outGeometry?.dispose();
        },
        [inGeometry, outGeometry],
    );

    // 球与相对路径必须同参考系(当前播放头),否则球不落在线上。
    useEffect(() => {
        if (!clip || !follow || !key) return undefined;
        return reaction(
            () => clock.time,
            (timeSeconds) => {
                const root = rootRef.current;
                if (!root) return;
                root.visible = updateFollowKeyHelper(
                    followResolver,
                    follow,
                    clip,
                    key,
                    root,
                    timeSeconds,
                    followFrame,
                    followSample,
                    handleOffsets.inX,
                    handleOffsets.inY,
                    handleOffsets.inZ,
                    inHandleRef.current,
                    inGeometry,
                    handleOffsets.outX,
                    handleOffsets.outY,
                    handleOffsets.outZ,
                    outHandleRef.current,
                    outGeometry,
                );
                invalidate();
            },
            { fireImmediately: true },
        );
    }, [
        clip,
        clock,
        follow,
        followFrame,
        followResolver,
        followSample,
        handleOffsets,
        inGeometry,
        invalidate,
        key,
        outGeometry,
        selected,
        subjectTrack,
    ]);

    // 拖拽期把指针跟踪挂到 window:射线一旦脱离小球,R3F 的对象级 pointermove 就不再触发,
    // 手感会「跟不上手」;同时向所有权裁决申请轨道让位,否则同一串指针事件既转轨道又拖点。
    const runDrag = useCallback(
        (clientX: number, clientY: number): void => {
            const drag = dragRef.current;
            const root = rootRef.current;
            if (!drag || !root) return;
            const bounds = canvas.getBoundingClientRect();
            TMP_POINTER.set(
                ((clientX - bounds.left) / bounds.width) * NDC_SPAN - 1,
                -((clientY - bounds.top) / bounds.height) * NDC_SPAN + 1,
            );
            TMP_RAYCASTER.setFromCamera(TMP_POINTER, camera);
            if (!TMP_RAYCASTER.ray.intersectPlane(TMP_DRAG_PLANE, TMP_INTERSECTION)) return;
            const isKey = drag.kind === "key";
            drag.target.position.set(
                TMP_INTERSECTION.x - (isKey ? 0 : root.position.x),
                TMP_INTERSECTION.y - (isKey ? 0 : root.position.y),
                TMP_INTERSECTION.z - (isKey ? 0 : root.position.z),
            );
            if (drag.geometry) updateHandleGeometry(drag.geometry, drag.target);
            invalidate();
        },
        [camera, canvas, invalidate],
    );

    const finishDrag = useCallback((): void => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || !key) return;
        const worldVector = dragPosition(drag.target);
        const vector = drag.follow
            ? drag.kind === "key"
                ? (drag.codec?.convertPoint(drag.follow, drag.timeSeconds, FOLLOW_SPACE.LOCAL, worldVector) ?? null)
                : (drag.codec?.convertOffset(drag.follow, drag.timeSeconds, FOLLOW_SPACE.LOCAL, worldVector) ?? null)
            : worldVector;
        if (!vector) {
            stores.ui.setApplicationNotice(FOLLOW_FRAME_UNAVAILABLE_NOTICE);
            return;
        }
        const result =
            drag.kind === "key"
                ? stores.dispatcher.dispatch(
                      { type: "motion.set-key", payload: { clipId, key: keyPayload(key, vector) } },
                      stores,
                  )
                : stores.dispatcher.dispatch(
                      {
                          type: "motion.set-key-handle",
                          payload: { clipId, keyId, kind: drag.kind, value: vector },
                      },
                      stores,
                  );
        reportCommandFailure(stores, result);
    }, [clipId, key, keyId, stores]);

    // 监听器与轨道让位只在拖拽进行中存在:成对挂载/卸载,组件中途卸载也不会把轨道锁死
    useEffect(() => {
        if (!dragging) return undefined;
        orbitSuspension.suspend();
        const onMove = (event: PointerEvent) => runDrag(event.clientX, event.clientY);
        const onUp = () => {
            finishDrag();
            setDragging(false);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            orbitSuspension.release();
        };
    }, [dragging, finishDrag, orbitSuspension, runDrag]);

    const startDrag = useCallback(
        (
            kind: DragState["kind"],
            target: Group | null,
            geometry: BufferGeometry | null,
            event: ThreeEvent<PointerEvent>,
        ): void => {
            if (!target || !rootRef.current || !clip || !key) return;
            event.stopPropagation();
            event.nativeEvent.stopPropagation();
            selectMotionKey(stores, clipId, keyId);
            camera.getWorldDirection(TMP_CAMERA_FORWARD);
            TMP_DRAG_PLANE.setFromNormalAndCoplanarPoint(TMP_CAMERA_FORWARD, rootRef.current.position);
            dragRef.current = {
                kind,
                target,
                geometry,
                codec: clip.follow ? followSpaceCodecFor(stores) : null,
                follow: clip.follow,
                // 渲染与反解必须同参考系,否则松手即跳;球画在当前播放头的跟随系里,故此处也取它。
                timeSeconds: clock.time,
            };
            setDragging(true);
        },
        [camera, clip, clipId, clock, key, keyId, stores],
    );

    if (!key) return null;
    const handleColor = key.handleMode === MOTION_HANDLE_MODE.AUTO ? AUTO_HANDLE_COLOR : MANUAL_HANDLE_COLOR;
    const handleWireframe = key.handleMode === MOTION_HANDLE_MODE.AUTO;
    return (
        <group ref={rootRef} position={key.position} userData={{ helper: true }}>
            <mesh
                onClick={(event) => {
                    event.stopPropagation();
                    selectMotionKey(stores, clipId, keyId);
                }}
                onContextMenu={(event) => {
                    event.stopPropagation();
                    event.nativeEvent.preventDefault();
                    selectMotionKey(stores, clipId, keyId);
                    onContextMenu({ clientX: event.nativeEvent.clientX, clientY: event.nativeEvent.clientY });
                }}
                onPointerDown={(event) => startDrag("key", rootRef.current, null, event)}
                userData={{ helper: true }}
            >
                <sphereGeometry args={[KEY_RADIUS_METERS, 16, 12]} />
                <meshStandardMaterial
                    color={selected ? SELECTED_KEY_COLOR : KEY_COLOR}
                    emissive={selected ? KEY_COLOR : "#000000"}
                />
            </mesh>
            {selected && inGeometry && outGeometry ? (
                <>
                    <line>
                        <primitive object={inGeometry} attach="geometry" />
                        <lineBasicMaterial color={handleColor} toneMapped={false} />
                    </line>
                    <line>
                        <primitive object={outGeometry} attach="geometry" />
                        <lineBasicMaterial color={handleColor} toneMapped={false} />
                    </line>
                    <group
                        ref={inHandleRef}
                        position={[handleOffsets.inX, handleOffsets.inY, handleOffsets.inZ]}
                        userData={{ helper: true }}
                    >
                        <mesh
                            userData={{ helper: true }}
                            onPointerDown={(event) => startDrag("in", inHandleRef.current, inGeometry, event)}
                        >
                            <sphereGeometry args={[HANDLE_RADIUS_METERS, 12, 10]} />
                            <meshStandardMaterial color={handleColor} wireframe={handleWireframe} />
                        </mesh>
                    </group>
                    <group
                        ref={outHandleRef}
                        position={[handleOffsets.outX, handleOffsets.outY, handleOffsets.outZ]}
                        userData={{ helper: true }}
                    >
                        <mesh
                            userData={{ helper: true }}
                            onPointerDown={(event) => startDrag("out", outHandleRef.current, outGeometry, event)}
                        >
                            <sphereGeometry args={[HANDLE_RADIUS_METERS, 12, 10]} />
                            <meshStandardMaterial color={handleColor} wireframe={handleWireframe} />
                        </mesh>
                    </group>
                </>
            ) : null}
        </group>
    );
});
