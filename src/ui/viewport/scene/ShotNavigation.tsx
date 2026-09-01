import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { PerspectiveCamera } from "three";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useOrbitControls } from "@/navigation/orbit";
import { useViewportPoseGesture } from "@/ui/viewport/scene/useViewportPoseGesture";

/**
 * 掌镜导航:共享视口摆位手势,稳定点只落一条 camera.set-shot。
 * 镜头视角的同类手势见 LensNavigation;两者的 Three transient 语义绝不分叉。
 */
export const ShotNavigation = observer(function ShotNavigation() {
    const stores = useDirectorDeskStores();
    const camera = useThree((state) => state.camera);
    const controls = useOrbitControls();
    const activeShotId = stores.camera.activeShotId;

    const commitShot = useCallback(() => {
        if (!activeShotId || !controls || !(camera instanceof PerspectiveCamera)) return;
        const result = stores.dispatcher.dispatch(
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
        if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    }, [activeShotId, camera, controls, stores]);

    useViewportPoseGesture({ active: activeShotId !== null, onCommit: commitShot });
    return null;
});
