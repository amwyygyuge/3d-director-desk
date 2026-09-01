import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { PerspectiveCamera } from "three";

import { useDirectorDeskStores } from "../../shell/DirectorDeskContext";
import { useOrbitControls } from "../../../navigation/orbit";
import { useFlyNavigation } from "./useFlyNavigation";

/**
 * 飞行导航(仅导演视角):WASD+Space/Shift 持续位移相机与轨道中心。
 * 按键状态机与逐帧位移收敛在 useFlyNavigation(掌镜复用同一实现,Rule of Two);
 * 本组件只声明激活条件与 settle 语义:全松开时落导演 pose,供存机位/取景复用。
 */
export const FlyDrive = observer(function FlyDrive() {
    const stores = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();

    useFlyNavigation({
        active: stores.camera.activeShotId === null,
        onSettled: () => {
            if (!controls || !(camera instanceof PerspectiveCamera)) return;
            stores.camera.rememberDirectorPose({
                position: [camera.position.x, camera.position.y, camera.position.z],
                target: [controls.target.x, controls.target.y, controls.target.z],
                fov: camera.fov,
            });
        },
    });

    return null;
});
