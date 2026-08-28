import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react";
import { useEffect, useRef } from "react";
import { PerspectiveCamera } from "three";

import type { DirectorPose } from "../../store/CameraStore";
import { useDirectorDeskStores } from "../DirectorDeskContext";
import { useOrbitControls } from "../../navigation/orbit";
import type { OrbitLike } from "../../navigation/orbit";

function currentPose(camera: PerspectiveCamera, controls: OrbitLike): DirectorPose {
    return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        fov: camera.fov,
    };
}

/**
 * 机位视角装备:
 * - 激活机位 → 暂存导演 pose(首次进入时),相机钉死机位参数,禁轨道;
 * - 回导演视角 → 精确还原暂存 pose,恢复轨道;
 * - 轨道交互结束(controls "end")记录导演 pose,供「当前视角存为机位」消费。
 * 激活后机位参数被改(FOV 滑杆等)会重跑 effect 重新钉参——锚 cameraStore.revision。
 */
export const ShotCameraRig = observer(function ShotCameraRig() {
    const { camera: cameraStore } = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const invalidate = useThree((state) => state.invalidate);
    const savedDirectorPose = useRef<DirectorPose | null>(null);
    const consumedDirectorPoseNonce = useRef<number | null>(null);

    void cameraStore.revision;
    const activeShotId = cameraStore.activeShotId;
    const directorPoseNonce = cameraStore.directorPoseNonce;
    const directorPoseTarget = cameraStore.directorPoseTarget;
    const shot = activeShotId ? cameraStore.activeShot : null;

    // 导演视角的 pose 记录:初始一次 + 每次轨道交互结束
    useEffect(() => {
        if (!controls || !(camera instanceof PerspectiveCamera)) return;
        const remember = () => {
            if (!controls.enabled) return; // 机位视角下轨道禁用,残事件不污染暂存
            cameraStore.rememberDirectorPose(currentPose(camera, controls));
        };
        controls.addEventListener("end", remember);
        remember();
        return () => controls.removeEventListener("end", remember);
    }, [camera, controls, cameraStore]);

    // 机位钉参 / 导演视角还原
    useEffect(() => {
        if (!controls || !(camera instanceof PerspectiveCamera)) return;
        if (shot) {
            savedDirectorPose.current ??= currentPose(camera, controls);
            // 进入机位时 DirectorDesk 已关阻尼(enableDamping=false),这次 update 把轨道残量一次清零
            controls.update();
            cameraStore.rememberDirectorPose(savedDirectorPose.current);
            camera.position.set(shot.position[0], shot.position[1], shot.position[2]);
            camera.fov = shot.fov;
            camera.updateProjectionMatrix();
            camera.lookAt(shot.target[0], shot.target[1], shot.target[2]);
            controls.target.set(shot.target[0], shot.target[1], shot.target[2]);
            controls.enabled = false;
            invalidate();
            return;
        }
        const saved = savedDirectorPose.current;
        if (!saved) return;
        camera.position.set(saved.position[0], saved.position[1], saved.position[2]);
        camera.fov = saved.fov;
        camera.updateProjectionMatrix();
        camera.lookAt(saved.target[0], saved.target[1], saved.target[2]);
        controls.target.set(saved.target[0], saved.target[1], saved.target[2]);
        controls.enabled = true;
        controls.update();
        savedDirectorPose.current = null;
        invalidate();
    }, [shot, camera, controls, invalidate, cameraStore]);

    // 取景请求只作用于导演相机；机位激活时消费并丢弃，避免退出机位后回放陈旧请求。
    useEffect(() => {
        if (consumedDirectorPoseNonce.current === directorPoseNonce) return;
        consumedDirectorPoseNonce.current = directorPoseNonce;
        if (!directorPoseTarget || activeShotId !== null || !controls || !(camera instanceof PerspectiveCamera)) return;
        camera.position.set(
            directorPoseTarget.position[0],
            directorPoseTarget.position[1],
            directorPoseTarget.position[2],
        );
        camera.fov = directorPoseTarget.fov;
        camera.updateProjectionMatrix();
        controls.target.set(directorPoseTarget.target[0], directorPoseTarget.target[1], directorPoseTarget.target[2]);
        controls.update();
        cameraStore.rememberDirectorPose(directorPoseTarget);
        invalidate();
    }, [activeShotId, camera, cameraStore, controls, directorPoseNonce, directorPoseTarget, invalidate]);

    return null;
});
