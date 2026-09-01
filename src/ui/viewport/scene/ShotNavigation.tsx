import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef } from "react";
import { PerspectiveCamera, Spherical, Vector3 } from "three";

import { FOV_MAX, FOV_MIN } from "../../../command/commands";
import { useDirectorDeskStores } from "../../shell/DirectorDeskContext";
import { useOrbitControls } from "../../../navigation/orbit";
import { useFlyNavigation } from "./useFlyNavigation";

/** 与正常导演视角 OrbitControls 一致:一次完整转向对应画布高度 */
const ORBIT_TURN_RADIANS_PER_CANVAS_HEIGHT = Math.PI * 2;
/** 俯仰角钳制(防万向锁翻转) */
const PITCH_LIMIT_RAD = (85 * Math.PI) / 180;
/** 滚轮变焦:每 deltaY 单位的 FOV 度数 */
const FOV_WHEEL_STEP = 0.05;
/** 松手/停滚后落命令的防抖窗(可撤销的持久化纪律) */
const COMMIT_DEBOUNCE_MS = 400;

const TMP_OFFSET = new Vector3();
const TMP_SPHERICAL = new Spherical();

/**
 * 掌镜导航(仅机位视角):WASD+Space/Shift 位移 + 按住拖拽转向 + 滚轮变焦。
 * - 位移:复用 useFlyNavigation(与导演视角 FlyDrive 同一实现),松开 settle 时落命令;
 * - 转向:按住左键拖拽才转,方向与正常导演视角 OrbitControls 完全一致;
 *   俯仰钳制 ±85°,yaw 绕世界 Y——相机原位旋转,位置不变;
 * - 变焦:滚轮实时改 fov(仅视锥,不动机位数据);
 * - 持久化纪律:位移/转向/变焦都是 transient,停止 COMMIT_DEBOUNCE_MS 后落一次
 *   camera.set-shot 命令——可撤销、与 06 的 FOV 滑杆同源;
 * - 退出:Esc 走 ShortcutRegistry shot 域(无 Pointer Lock,一击即退)。
 */
export const ShotNavigation = observer(function ShotNavigation() {
    const stores = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);

    const activeShotId = stores.camera.activeShotId;
    const dragging = useRef(false);
    const commitTimer = useRef<number | undefined>(undefined);

    /** 把当前视口 pose 落成一次可撤销的 camera.set-shot(防抖合并连续手势) */
    const commitShot = useCallback(() => {
        if (!activeShotId || !controls || !(camera instanceof PerspectiveCamera)) return;
        stores.dispatcher.dispatch(
            {
                type: "camera.set-shot",
                payload: {
                    id: activeShotId,
                    shot: {
                        position: [camera.position.x, camera.position.y, camera.position.z],
                        target: [controls.target.x, controls.target.y, controls.target.z],
                        fov: camera.fov,
                    },
                },
            },
            stores,
        );
    }, [activeShotId, camera, controls, stores]);
    const scheduleCommit = useCallback(() => {
        clearTimeout(commitTimer.current);
        commitTimer.current = window.setTimeout(commitShot, COMMIT_DEBOUNCE_MS);
    }, [commitShot]);

    // 位移:掌镜激活时接管 WASD+Space/Shift,全松开(或失焦)时防抖落命令
    useFlyNavigation({ active: activeShotId !== null, onSettled: scheduleCommit });

    useEffect(() => {
        if (!activeShotId || !controls || !(camera instanceof PerspectiveCamera)) return;

        /** 原地转向:沿用 OrbitControls 的方向与按画布高度归一化的灵敏度 */
        const turn = (deltaX: number, deltaY: number) => {
            const turnRadiansPerPixel = ORBIT_TURN_RADIANS_PER_CANVAS_HEIGHT / canvas.clientHeight;
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

        const onMouseMove = (event: MouseEvent) => {
            if (!dragging.current) return;
            turn(event.movementX, event.movementY);
        };
        const onMouseDown = (event: MouseEvent) => {
            if (event.target === canvas) dragging.current = true;
        };
        const onMouseUp = () => {
            dragging.current = false;
        };
        const onWheel = (event: WheelEvent) => {
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
            clearTimeout(commitTimer.current);
        };
    }, [activeShotId, camera, controls, canvas, invalidate, scheduleCommit]);

    return null;
});
