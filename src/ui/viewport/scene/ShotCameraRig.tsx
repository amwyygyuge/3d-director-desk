import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";
import { PerspectiveCamera } from "three";

import type { DirectorPose } from "@/store/CameraStore";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useOrbitControls } from "@/navigation/orbit";
import type { OrbitLike } from "@/navigation/orbit";

function currentPose(camera: PerspectiveCamera, controls: OrbitLike): DirectorPose {
    return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        fov: camera.fov,
    };
}

/** 姿态收敛判据:两帧位移小于此值视为惯性已停(米/度量级远小于可感知阈值) */
const POSE_SETTLE_EPSILON = 1e-5;

function isPoseSettled(a: DirectorPose, b: DirectorPose): boolean {
    const near = (x: number, y: number) => Math.abs(x - y) < POSE_SETTLE_EPSILON;
    return (
        near(a.position[0], b.position[0]) &&
        near(a.position[1], b.position[1]) &&
        near(a.position[2], b.position[2]) &&
        near(a.target[0], b.target[0]) &&
        near(a.target[1], b.target[1]) &&
        near(a.target[2], b.target[2])
    );
}

/**
 * 机位视角装备:
 * - 激活机位 → 暂存导演 pose(首次进入时),相机钉死机位参数;
 * - 回导演视角 → 精确还原暂存 pose;
 * - 轨道启停不在本组件:归 OrbitAuthorityRig 按 ViewportCameraAuthority 的所有权统一执行;
 * - 轨道交互结束(controls "end")记录导演 pose,供「当前视角存为机位」消费。
 * 激活后机位参数被改(FOV 滑杆等)会重跑 effect 重新钉参——activeShot computed 锚定 shots 表该 key,替换即触发。
 */
export const ShotCameraRig = observer(function ShotCameraRig() {
    const { camera: cameraStore, viewportCamera, viewportOrbit } = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const invalidate = useThree((state) => state.invalidate);
    const savedDirectorPose = useRef<DirectorPose | null>(null);
    const consumedDirectorPoseNonce = useRef<number | null>(null);

    const activeShotId = cameraStore.activeShotId;
    const directorPoseNonce = cameraStore.directorPoseNonce;
    const directorPoseTarget = cameraStore.directorPoseTarget;
    const shot = activeShotId ? cameraStore.activeShot : null;

    // 导演视角的 pose 记录:初始一次 + 每次轨道交互结束。
    // "end" 在 pointerup 即触发,但阻尼滑行还要持续约 1 秒——此刻定格的是惯性中的姿态,
    // 「存为机位」就会存到与最终画面差约 10° 的 pose。所以 end 先记一次(保证非空),
    // 再用 rAF 轮询到两帧姿态不再变化时补记一次「落定姿态」。rAF 不依赖 R3F 渲染循环:
    // demand 模式下滑行由 change→invalidate 自续,滑行停止后相机不再动,轮询即收敛。
    useEffect(() => {
        if (!controls || !(camera instanceof PerspectiveCamera)) return;
        const settle = { raf: 0, last: null as DirectorPose | null };
        const remember = () => {
            // 机位/成片接管期轨道已停手,残事件不得污染导演姿态暂存
            if (!viewportCamera.isDirectorFree) return;
            cameraStore.rememberDirectorPose(currentPose(camera, controls));
        };
        const settleStep = () => {
            if (!viewportCamera.isDirectorFree) return;
            const now = currentPose(camera, controls);
            if (settle.last && isPoseSettled(now, settle.last)) {
                cameraStore.rememberDirectorPose(now);
                return;
            }
            settle.last = now;
            settle.raf = requestAnimationFrame(settleStep);
        };
        const onEnd = () => {
            remember();
            cancelAnimationFrame(settle.raf);
            settle.last = null;
            settle.raf = requestAnimationFrame(settleStep);
        };
        controls.addEventListener("end", onEnd);
        remember();
        return () => {
            cancelAnimationFrame(settle.raf);
            controls.removeEventListener("end", onEnd);
        };
    }, [camera, controls, cameraStore, viewportCamera]);

    // 机位钉参 / 导演视角还原
    useEffect(() => {
        if (!controls || !(camera instanceof PerspectiveCamera)) return;
        if (shot) {
            // 顺序铁律:先 drain 再暂存/钉参。残量属于进入机位前的导演姿态,
            // 先施加并归零,暂存到的才是作者真正看到的画面;反过来则残量会污染钉参后的机位画面。
            viewportOrbit.drainDampingResidual();
            savedDirectorPose.current ??= currentPose(camera, controls);
            camera.position.set(shot.position[0], shot.position[1], shot.position[2]);
            camera.fov = shot.fov;
            camera.updateProjectionMatrix();
            camera.lookAt(shot.target[0], shot.target[1], shot.target[2]);
            controls.target.set(shot.target[0], shot.target[1], shot.target[2]);
            invalidate();
            return;
        }
        const saved = savedDirectorPose.current;
        if (!saved) return;
        viewportOrbit.drainDampingResidual();
        camera.position.set(saved.position[0], saved.position[1], saved.position[2]);
        camera.fov = saved.fov;
        camera.updateProjectionMatrix();
        camera.lookAt(saved.target[0], saved.target[1], saved.target[2]);
        controls.target.set(saved.target[0], saved.target[1], saved.target[2]);
        savedDirectorPose.current = null;
        invalidate();
    }, [shot, camera, controls, invalidate, cameraStore, viewportOrbit]);

    // 取景请求只作用于导演相机；机位激活时消费并丢弃，避免退出机位后回放陈旧请求。
    useEffect(() => {
        if (consumedDirectorPoseNonce.current === directorPoseNonce) return;
        consumedDirectorPoseNonce.current = directorPoseNonce;
        if (!directorPoseTarget || activeShotId !== null || !controls || !(camera instanceof PerspectiveCamera)) return;
        viewportOrbit.drainDampingResidual();
        camera.position.set(
            directorPoseTarget.position[0],
            directorPoseTarget.position[1],
            directorPoseTarget.position[2],
        );
        camera.fov = directorPoseTarget.fov;
        camera.updateProjectionMatrix();
        controls.target.set(directorPoseTarget.target[0], directorPoseTarget.target[1], directorPoseTarget.target[2]);
        // 旧写法靠 drain 内部的 update() 顺带完成 lookAt;drain 已前移,这里必须显式取向。
        camera.lookAt(directorPoseTarget.target[0], directorPoseTarget.target[1], directorPoseTarget.target[2]);
        cameraStore.rememberDirectorPose(directorPoseTarget);
        invalidate();
    }, [activeShotId, camera, cameraStore, controls, directorPoseNonce, directorPoseTarget, invalidate, viewportOrbit]);

    return null;
});
