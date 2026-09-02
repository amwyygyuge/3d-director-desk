import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Group } from "three";

import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraKey } from "@/camera/CameraKey";
import { AutoHandleSolver, createHandlePair } from "@/motion/AutoHandleSolver";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import type { Vec3 } from "@/core/SceneObject";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useOrbitSuspension } from "@/ui/viewport/scene/useOrbitSuspension";

const PATH_SAMPLES_PER_SEGMENT = 24;
const KEY_RADIUS_METERS = 0.11;
const HANDLE_RADIUS_METERS = 0.075;
const KEY_COLOR = "#6366f1";
const SELECTED_KEY_COLOR = "#a5b4fc";
const AUTO_HANDLE_COLOR = "#818cf8";
const MANUAL_HANDLE_COLOR = "#f5f3ff";

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
    stores.motionAuthoring.selectKey(clipId, keyId);
}

interface PreviewGeometry {
    readonly path: BufferGeometry;
}

interface DragState {
    readonly kind: "key" | "in" | "out";
    readonly target: Group;
    readonly geometry: BufferGeometry | null;
}

export interface MotionKeyContextRequest {
    readonly clientX: number;
    readonly clientY: number;
}

export interface MotionClipPathPreviewProps {
    readonly clipId: string;
    readonly onKeyContextMenu: (request: MotionKeyContextRequest) => void;
}

function createPreviewGeometry(clip: CameraMotionClip): PreviewGeometry {
    const sampleCount = clip.trajectory.segmentCount * PATH_SAMPLES_PER_SEGMENT;
    const positions = new Float32Array((sampleCount + 1) * 3);
    const sample = { x: 0, y: 0, z: 0 };
    for (let step = 0; step <= sampleCount; step += 1) {
        clip.trajectory.samplePosition(step / sampleCount, sample);
        const offset = step * 3;
        positions[offset] = sample.x;
        positions[offset + 1] = sample.y;
        positions[offset + 2] = sample.z;
    }
    const path = new BufferGeometry();
    path.setAttribute("position", new BufferAttribute(positions, 3));
    return { path };
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

function poseKeyPayload(key: CameraKey, position: Group) {
    return { ...key.toJSON(), position: [position.position.x, position.position.y, position.position.z] as Vec3 };
}

function handlePayload(handle: Group): Vec3 {
    return [handle.position.x, handle.position.y, handle.position.z];
}

/** 单段轨迹的可编辑场景辅助物;所有拖动只改 Three ref,松手才经命令层持久化。 */
export const MotionClipPathPreview = observer(function MotionClipPathPreview({
    clipId,
    onKeyContextMenu,
}: MotionClipPathPreviewProps) {
    const stores = useDirectorDeskStores();
    const clip = stores.motion.clip(clipId);
    const geometry = useMemo(() => (clip ? createPreviewGeometry(clip) : null), [clip]);

    useEffect(
        () => () => {
            geometry?.path.dispose();
        },
        [geometry],
    );

    if (!clip || !geometry) return null;
    return (
        <group userData={{ helper: true, motionClipId: clip.id }}>
            {/* userData 只挂在外层 group:截图隐藏辅助物按子树生效,line 上再加属性会被 TS 解析成 SVG 元素 */}
            <line>
                <primitive object={geometry.path} attach="geometry" />
                <lineBasicMaterial color={KEY_COLOR} toneMapped={false} />
            </line>
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
    const camera = useThree((state) => state.camera);
    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);
    const clip = stores.motion.clip(clipId);
    const key = clip?.key(keyId);
    const selected = stores.motionAuthoring.selectedClipId === clipId && stores.motionAuthoring.selectedKeyId === keyId;
    const rootRef = useRef<Group | null>(null);
    const inHandleRef = useRef<Group | null>(null);
    const outHandleRef = useRef<Group | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const orbitSuspension = useOrbitSuspension();
    const [dragging, setDragging] = useState(false);
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
        const result =
            drag.kind === "key"
                ? stores.dispatcher.dispatch(
                      { type: "motion.set-key", payload: { clipId, key: poseKeyPayload(key, drag.target) } },
                      stores,
                  )
                : stores.dispatcher.dispatch(
                      {
                          type: "motion.set-key-handle",
                          payload: { clipId, keyId, kind: drag.kind, value: handlePayload(drag.target) },
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
            if (!target || !rootRef.current) return;
            event.stopPropagation();
            event.nativeEvent.stopPropagation();
            selectMotionKey(stores, clipId, keyId);
            camera.getWorldDirection(TMP_CAMERA_FORWARD);
            TMP_DRAG_PLANE.setFromNormalAndCoplanarPoint(TMP_CAMERA_FORWARD, rootRef.current.position);
            dragRef.current = { kind, target, geometry };
            setDragging(true);
        },
        [camera, clipId, keyId, stores],
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
