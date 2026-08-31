import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { PerspectiveCamera, Spherical, Vector3 } from "three";

import { FOV_MAX, FOV_MIN } from "../../command/commands";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { useOrbitControls } from "../../navigation/orbit";

/** 转向灵敏度:每像素弧度 */
const TURN_SPEED_RAD_PER_PX = 0.003;
/** 俯仰角钳制(防万向锁翻转) */
const PITCH_LIMIT_RAD = (85 * Math.PI) / 180;
/** 滚轮变焦:每 deltaY 单位的 FOV 度数 */
const FOV_WHEEL_STEP = 0.05;
/** 松手/停滚后落命令的防抖窗(可撤销的持久化纪律) */
const COMMIT_DEBOUNCE_MS = 400;

const TMP_OFFSET = new Vector3();
const TMP_SPHERICAL = new Spherical();

/**
 * 掌镜导航(仅机位视角):三脚架转向 + 滚轮变焦 + Pointer Lock。
 * - 转向:Pointer Lock 成功则动鼠标即转(FPS 手感);被拒则退化为按住拖拽;
 *   俯仰钳制 ±85°,yaw 绕世界 Y——相机原位旋转,位置不变;
 * - 变焦:滚轮实时改 fov(仅视锥,不动机位数据);
 * - 持久化纪律:转向/变焦都是 transient,停止 COMMIT_DEBOUNCE_MS 后落一次
 *   camera.set-shot 命令——可撤销、与 06 的 FOV 滑杆同源;
 * - 掌镜下 WASD 禁用(规格决策):FlyDrive 只在导演视角激活。
 */
export const ShotNavigation = observer(function ShotNavigation() {
    const stores = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const invalidate = useThree((state) => state.invalidate);
    const canvas = useThree((state) => state.gl.domElement);

    const activeShotId = stores.camera.activeShotId;
    const locked = useRef(false);
    const dragging = useRef(false);
    const commitTimer = useRef<number | undefined>(undefined);

    // 进入掌镜 → 请求鼠标锁定;退出掌镜 → 解锁兜底(规格:退出锁定后重新进入再锁)
    useEffect(() => {
        if (!activeShotId) return;
        const request = canvas.requestPointerLock();
        request?.catch(() => {
            // 锁定被拒(无用户手势窗口等)→ 退化为按住拖拽,功能不缺失
        });
        return () => {
            if (document.pointerLockElement === canvas) document.exitPointerLock();
        };
    }, [activeShotId, canvas]);

    useEffect(() => {
        if (!activeShotId || !controls || !(camera instanceof PerspectiveCamera)) return;
        const shotId = activeShotId;

        const commitShot = () => {
            stores.dispatcher.dispatch(
                {
                    type: "camera.set-shot",
                    payload: {
                        id: shotId,
                        shot: {
                            position: [camera.position.x, camera.position.y, camera.position.z],
                            target: [controls.target.x, controls.target.y, controls.target.z],
                            fov: camera.fov,
                        },
                    },
                },
                stores,
            );
        };
        const scheduleCommit = () => {
            clearTimeout(commitTimer.current);
            commitTimer.current = window.setTimeout(commitShot, COMMIT_DEBOUNCE_MS);
        };

        /** 原地转向:绕相机位置旋转移轴到 controls.target */
        const turn = (deltaX: number, deltaY: number) => {
            TMP_OFFSET.set(
                controls.target.x - camera.position.x,
                controls.target.y - camera.position.y,
                controls.target.z - camera.position.z,
            );
            TMP_SPHERICAL.setFromVector3(TMP_OFFSET);
            TMP_SPHERICAL.theta -= deltaX * TURN_SPEED_RAD_PER_PX;
            TMP_SPHERICAL.phi = Math.min(
                Math.PI - (Math.PI / 2 - PITCH_LIMIT_RAD),
                Math.max(Math.PI / 2 - PITCH_LIMIT_RAD, TMP_SPHERICAL.phi - deltaY * TURN_SPEED_RAD_PER_PX),
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

        const onLockChange = () => {
            locked.current = document.pointerLockElement === canvas;
        };
        const onMouseMove = (event: MouseEvent) => {
            if (!locked.current && !dragging.current) return;
            turn(event.movementX, event.movementY);
        };
        const onMouseDown = (event: MouseEvent) => {
            if (event.target === canvas && !locked.current) dragging.current = true;
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

        document.addEventListener("pointerlockchange", onLockChange);
        window.addEventListener("mousemove", onMouseMove);
        canvas.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mouseup", onMouseUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            document.removeEventListener("pointerlockchange", onLockChange);
            window.removeEventListener("mousemove", onMouseMove);
            canvas.removeEventListener("mousedown", onMouseDown);
            window.removeEventListener("mouseup", onMouseUp);
            canvas.removeEventListener("wheel", onWheel);
            clearTimeout(commitTimer.current);
        };
    }, [activeShotId, camera, controls, canvas, invalidate, stores]);

    return null;
});
