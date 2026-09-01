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

const TMP_OFFSET = new Vector3();
const TMP_SPHERICAL = new Spherical();

export interface ViewportPoseGestureOptions {
    readonly active: boolean;
    readonly onCommit: () => void;
}

function useDebouncedPoseCommit(onCommit: () => void, active: boolean): () => void {
    const commitTimer = useRef<number | undefined>(undefined);
    const commitRef = useRef(onCommit);
    const activeRef = useRef(active);
    useEffect(() => {
        commitRef.current = onCommit;
        activeRef.current = active;
    });
    useEffect(() => () => clearTimeout(commitTimer.current), []);
    return useCallback(() => {
        clearTimeout(commitTimer.current);
        commitTimer.current = window.setTimeout(() => {
            if (activeRef.current) commitRef.current();
        }, COMMIT_DEBOUNCE_MS);
    }, []);
}

function useViewportPointerPoseGesture(active: boolean, scheduleCommit: () => void): void {
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);
    const dragging = useRef(false);

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
        const onMouseMove = (event: MouseEvent): void => {
            if (dragging.current) turn(event.movementX, event.movementY);
        };
        const onMouseDown = (event: MouseEvent): void => {
            if (event.target === canvas) dragging.current = true;
        };
        const onMouseUp = (): void => {
            dragging.current = false;
        };
        const onWheel = (event: WheelEvent): void => {
            event.preventDefault();
            camera.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, camera.fov + event.deltaY * FOV_WHEEL_STEP));
            camera.updateProjectionMatrix();
            invalidate();
            scheduleCommit();
        };
        window.addEventListener("mousemove", onMouseMove);
        canvas.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mouseup", onMouseUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            canvas.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);
            canvas.removeEventListener("wheel", onWheel);
        };
    }, [active, camera, canvas, controls, invalidate, scheduleCommit]);
}

/**
 * 视口摆位手势内核:掌镜与镜头视角共用同一份 transient Three 操作。
 * 调用方在稳定点将当前画面收敛到自己的领域命令;拖拽与飞行期均不写 MobX。
 */
export function useViewportPoseGesture({ active, onCommit }: ViewportPoseGestureOptions): void {
    const scheduleCommit = useDebouncedPoseCommit(onCommit, active);
    useFlyNavigation({ active, onSettled: scheduleCommit });
    useViewportPointerPoseGesture(active, scheduleCommit);
}
