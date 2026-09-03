import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Group, Mesh, Object3D } from "three";

import { TimelineSelection } from "@/authoring/TimelineSelection";
import { AutoHandleSolver, createHandlePair } from "@/motion/AutoHandleSolver";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { SetTimelineKeyCommand } from "@/command/timelineCommands";
import type { Vec3 } from "@/core/SceneObject";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import type { TransformKeyframe } from "@/timeline/TransformKeyframe";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { useOrbitSuspension } from "@/ui/viewport/scene/useOrbitSuspension";

const KEY_RADIUS_METERS = 0.13;
/** 手柄比关键帧略小以示主次,但不能小到点不中——它是要被反复微调的目标。 */
const HANDLE_RADIUS_METERS = 0.11;
const SPHERE_SEGMENTS = 14;
const KEY_COLOR = "#10b981";
const SELECTED_KEY_COLOR = "#6ee7b7";
const AUTO_HANDLE_COLOR = "#34d399";
const MANUAL_HANDLE_COLOR = "#ecfdf5";
const NDC_SPAN = 2;

const TMP_POINTER = new Vector2();
const TMP_RAYCASTER = new Raycaster();
const TMP_INTERSECTION = new Vector3();
/** 走位编辑恒在水平面进行:高度归贴地策略管,拖点不该顺手把角色抬起来。 */
const TMP_DRAG_PLANE = new Plane(new Vector3(0, 1, 0), 0);
const HANDLE_SOLVER = new AutoHandleSolver();

type DragKind = "key" | "in" | "out";

interface DragState {
    readonly kind: DragKind;
    readonly target: Object3D;
}

function createHandleLine(x: number, y: number, z: number): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, x, y, z]), 3));
    return geometry;
}

function updateHandleLine(geometry: BufferGeometry, handle: Object3D): void {
    const attribute = geometry.getAttribute("position");
    if (!(attribute instanceof BufferAttribute)) return;
    attribute.setXYZ(1, handle.position.x, handle.position.y, handle.position.z);
    attribute.needsUpdate = true;
}

/** 拖 key = 换位置;拖手柄 = 换切线并接管(auto → manual)。两者都落成同一条整帧命令。 */
function keyframePayload(keyframe: TransformKeyframe, kind: DragKind, target: Object3D) {
    const moved: Vec3 = [target.position.x, target.position.y, target.position.z];
    if (kind === "key") {
        return { ...keyframe.toJSON(), value: { ...keyframe.value, position: moved } };
    }
    const handles = kind === "in" ? { inHandle: moved } : { outHandle: moved };
    return { ...keyframe.toJSON(), ...handles, handleMode: MOTION_HANDLE_MODE.MANUAL };
}

function submitKeyframe(
    stores: DirectorDeskStores,
    trackId: string,
    keyframe: ReturnType<typeof keyframePayload>,
): void {
    reportCommandFailure(
        stores,
        stores.dispatcher.dispatch({ type: SetTimelineKeyCommand.TYPE, payload: { trackId, keyframe } }, stores),
    );
}

export interface WalkKeyHelperProps {
    readonly trackId: string;
    readonly keyframeId: string;
}

/**
 * 一枚走位关键帧的把手:小球改位置,选中后长出的两根杆改切线。
 *
 * 拖拽期只改 Three ref(不写 store、不进历史),松手才发一条整帧命令——
 * 中途每一帧都入库会把撤销栈塞满,也会让 MobX 在拖动过程中反复重算轨迹。
 */
export const WalkKeyHelper = observer(function WalkKeyHelper({ trackId, keyframeId }: WalkKeyHelperProps) {
    const stores = useDirectorDeskStores();
    const { timelineSelection, timeline, ui } = stores;
    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);
    const camera = useThree((state) => state.camera);
    const track: TimelineTrack | undefined = timeline.document.track(trackId);
    const keyframe = track?.keyframe(keyframeId);
    const selected =
        timelineSelection.current.walkTrackId === trackId && timelineSelection.current.walkKeyframeId === keyframeId;
    const rootRef = useRef<Group | null>(null);
    const inRef = useRef<Mesh | null>(null);
    const outRef = useRef<Mesh | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const [dragging, setDragging] = useState(false);
    const orbitSuspension = useOrbitSuspension();

    // auto 手柄的显示长度由相邻帧决定(与采样端同一个求解器),manual 则照搬作者给的向量
    const handleOffsets = useMemo(() => {
        const offsets = createHandlePair();
        const index = track?.trajectory?.indexOf(keyframeId) ?? -1;
        if (track?.trajectory && index >= 0) HANDLE_SOLVER.solve(track.trajectory.keys, index, offsets);
        return offsets;
    }, [track, keyframeId]);
    const inGeometry = useMemo(
        () => (selected ? createHandleLine(handleOffsets.inX, handleOffsets.inY, handleOffsets.inZ) : null),
        [handleOffsets, selected],
    );
    const outGeometry = useMemo(
        () => (selected ? createHandleLine(handleOffsets.outX, handleOffsets.outY, handleOffsets.outZ) : null),
        [handleOffsets, selected],
    );

    useEffect(
        () => () => {
            inGeometry?.dispose();
            outGeometry?.dispose();
        },
        [inGeometry, outGeometry],
    );

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
            const geometry = drag.kind === "in" ? inGeometry : drag.kind === "out" ? outGeometry : null;
            if (geometry) updateHandleLine(geometry, drag.target);
            invalidate();
        },
        [camera, canvas, inGeometry, invalidate, outGeometry],
    );

    const finishDrag = useCallback((): void => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || !keyframe) return;
        submitKeyframe(stores, trackId, keyframePayload(keyframe, drag.kind, drag.target));
    }, [keyframe, stores, trackId]);

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
        (kind: DragKind, target: Object3D | null, event: ThreeEvent<PointerEvent>): void => {
            if (!target || !rootRef.current) return;
            event.stopPropagation();
            event.nativeEvent.stopPropagation();
            timelineSelection.select(TimelineSelection.walkKey(trackId, keyframeId));
            TMP_DRAG_PLANE.set(new Vector3(0, 1, 0), -rootRef.current.position.y);
            dragRef.current = { kind, target };
            setDragging(true);
        },
        [keyframeId, timelineSelection, trackId],
    );

    /** 右键 = 交还自动切线:重新变回系统平滑,不必逐轴把数值调回去。 */
    const resetHandles = useCallback(
        (event: ThreeEvent<MouseEvent>): void => {
            if (!keyframe) return;
            event.stopPropagation();
            event.nativeEvent.preventDefault();
            submitKeyframe(stores, trackId, {
                ...keyframe.toJSON(),
                inHandle: [0, 0, 0],
                outHandle: [0, 0, 0],
                handleMode: MOTION_HANDLE_MODE.AUTO,
            });
        },
        [keyframe, stores, trackId],
    );

    if (!keyframe) return null;
    const isManual = keyframe.handleMode === MOTION_HANDLE_MODE.MANUAL;
    const handleColor = isManual ? MANUAL_HANDLE_COLOR : AUTO_HANDLE_COLOR;
    // 变换模式下指针归 gizmo:把手与坐标轴在空间上重叠,抢走这次按下会当场解除变换、
    // 而 gizmo 的 onMouseUp 再也不会到达,轨道让位就永久泄漏(视口卡死)
    const pointerDownFor = (kind: DragKind, readTarget: () => Object3D | null) => (event: ThreeEvent<PointerEvent>) => {
        if (ui.isGizmoEngaged) return;
        startDrag(kind, readTarget(), event);
    };
    return (
        <group ref={rootRef} position={keyframe.value.position as unknown as [number, number, number]}>
            <mesh
                onContextMenu={resetHandles}
                onPointerDown={pointerDownFor("key", () => rootRef.current)}
                userData={{ helper: true }}
            >
                <sphereGeometry args={[KEY_RADIUS_METERS, SPHERE_SEGMENTS, SPHERE_SEGMENTS]} />
                <meshBasicMaterial color={selected ? SELECTED_KEY_COLOR : KEY_COLOR} toneMapped={false} />
            </mesh>
            {selected && inGeometry && outGeometry && (
                <>
                    <line>
                        <primitive object={inGeometry} attach="geometry" />
                        <lineBasicMaterial color={handleColor} toneMapped={false} />
                    </line>
                    <line>
                        <primitive object={outGeometry} attach="geometry" />
                        <lineBasicMaterial color={handleColor} toneMapped={false} />
                    </line>
                    <mesh
                        onPointerDown={pointerDownFor("in", () => inRef.current)}
                        position={[handleOffsets.inX, handleOffsets.inY, handleOffsets.inZ]}
                        ref={inRef}
                        userData={{ helper: true }}
                    >
                        <sphereGeometry args={[HANDLE_RADIUS_METERS, SPHERE_SEGMENTS, SPHERE_SEGMENTS]} />
                        <meshBasicMaterial color={handleColor} toneMapped={false} wireframe={!isManual} />
                    </mesh>
                    <mesh
                        onPointerDown={pointerDownFor("out", () => outRef.current)}
                        position={[handleOffsets.outX, handleOffsets.outY, handleOffsets.outZ]}
                        ref={outRef}
                        userData={{ helper: true }}
                    >
                        <sphereGeometry args={[HANDLE_RADIUS_METERS, SPHERE_SEGMENTS, SPHERE_SEGMENTS]} />
                        <meshBasicMaterial color={handleColor} toneMapped={false} wireframe={!isManual} />
                    </mesh>
                </>
            )}
        </group>
    );
});
