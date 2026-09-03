import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import { PerspectiveCamera, Spherical, Vector3 } from "three";

import { FOV_MAX, FOV_MIN } from "@/camera/CameraShot";
import { useOrbitControls } from "@/navigation/orbit";
import { useFlyNavigation } from "@/ui/viewport/scene/useFlyNavigation";

/** 与正常导演视角 OrbitControls 一致:一次完整转向对应画布高度。 */
const ORBIT_TURN_RADIANS_PER_CANVAS_HEIGHT = Math.PI * 2;
/** 俯仰角钳制(防万向锁翻转)。 */
const PITCH_LIMIT_RAD = (85 * Math.PI) / 180;
/** 滚轮变焦:每 deltaY 单位的 FOV 度数。 */
const FOV_WHEEL_STEP = 0.05;
/** 松手/停滚后提交一次持久化命令。 */
const COMMIT_DEBOUNCE_MS = 400;
/** 只有主键拖拽转向:右键留给关键帧上下文菜单,中键留给宿主。 */
const PRIMARY_MOUSE_BUTTON = 0;

const TMP_OFFSET = new Vector3();
const TMP_SPHERICAL = new Spherical();

export interface ViewportPoseGestureOptions {
    readonly active: boolean;
    /** 稳定点的收敛策略;省略 = 纯试镜手势,画面只在 three 上变,不落任何命令 */
    readonly onCommit?: (() => void) | undefined;
}

function useDebouncedPoseCommit(onCommit: (() => void) | undefined, active: boolean): () => void {
    const commitTimer = useRef<number | undefined>(undefined);
    const commitRef = useRef(onCommit);
    const activeRef = useRef(active);
    useEffect(() => {
        commitRef.current = onCommit;
        activeRef.current = active;
    });
    useEffect(() => () => clearTimeout(commitTimer.current), []);
    return useCallback(() => {
        if (!commitRef.current) return;
        clearTimeout(commitTimer.current);
        commitTimer.current = window.setTimeout(() => {
            if (activeRef.current) commitRef.current?.();
        }, COMMIT_DEBOUNCE_MS);
    }, []);
}

function isPrimaryDrag(event: PointerEvent): boolean {
    return event.isPrimary && event.button === PRIMARY_MOUSE_BUTTON;
}

function releasePointerCapture(canvas: HTMLCanvasElement, pointerId: number): void {
    if (!canvas.hasPointerCapture(pointerId)) return;
    canvas.releasePointerCapture(pointerId);
}

function useViewportPointerPoseGesture(active: boolean, scheduleCommit: () => void): void {
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);
    const activePointerId = useRef<number | null>(null);

    useEffect(() => {
        if (!active || !controls || !(camera instanceof PerspectiveCamera)) return;
        const turn = (deltaX: number, deltaY: number): void => {
            const canvasHeight = Math.max(canvas.clientHeight, 1);
            const turnRadiansPerPixel = ORBIT_TURN_RADIANS_PER_CANVAS_HEIGHT / canvasHeight;
            TMP_OFFSET.set(
                controls.target.x - camera.position.x,
                controls.target.y - camera.position.y,
                controls.target.z - camera.position.z,
            );
            TMP_SPHERICAL.setFromVector3(TMP_OFFSET);
            TMP_SPHERICAL.theta -= deltaX * turnRadiansPerPixel;
            TMP_SPHERICAL.phi = Math.min(
                Math.PI - (Math.PI / 2 - PITCH_LIMIT_RAD),
                Math.max(Math.PI / 2 - PITCH_LIMIT_RAD, TMP_SPHERICAL.phi - deltaY * turnRadiansPerPixel),
            );
            TMP_OFFSET.setFromSpherical(TMP_SPHERICAL);
            controls.target.set(
                camera.position.x + TMP_OFFSET.x,
                camera.position.y + TMP_OFFSET.y,
                camera.position.z + TMP_OFFSET.z,
            );
            camera.lookAt(controls.target.x, controls.target.y, controls.target.z);
            invalidate();
            scheduleCommit();
        };
        const onPointerDown = (event: PointerEvent): void => {
            if (!isPrimaryDrag(event)) return;
            canvas.setPointerCapture(event.pointerId);
            activePointerId.current = event.pointerId;
            event.preventDefault();
        };
        const onPointerMove = (event: PointerEvent): void => {
            if (activePointerId.current !== event.pointerId) return;
            turn(event.movementX, event.movementY);
            event.preventDefault();
        };
        const onPointerEnd = (event: PointerEvent): void => {
            if (activePointerId.current !== event.pointerId) return;
            releasePointerCapture(canvas, event.pointerId);
            activePointerId.current = null;
        };
        const onWheel = (event: WheelEvent): void => {
            event.preventDefault();
            camera.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, camera.fov + event.deltaY * FOV_WHEEL_STEP));
            camera.updateProjectionMatrix();
            invalidate();
            scheduleCommit();
        };
        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerEnd);
        canvas.addEventListener("pointercancel", onPointerEnd);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerEnd);
            canvas.removeEventListener("pointercancel", onPointerEnd);
            canvas.removeEventListener("wheel", onWheel);
            activePointerId.current = null;
        };
    }, [active, camera, canvas, controls, invalidate, scheduleCommit]);
}

/**
 * 视口摆位手势内核:掌镜与镜头视角共用同一份 transient Three 操作。
 * 拖拽与飞行期均不写 MobX;是否在稳定点落命令由调用方的 onCommit 决定
 * (掌镜落 camera.set-shot;镜头视角不落——那里只有 K 才写关键帧)。
 */
export function useViewportPoseGesture({ active, onCommit }: ViewportPoseGestureOptions): void {
    const scheduleCommit = useDebouncedPoseCommit(onCommit, active);
    useFlyNavigation({ active, onSettled: scheduleCommit });
    useViewportPointerPoseGesture(active, scheduleCommit);
}
