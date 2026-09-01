import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { useOrbitControls } from "@/navigation/orbit";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/**
 * OrbitControls 启停的唯一执行器:所有权判据在 ViewportCameraAuthority,这里只把它写进 three。
 *
 * 必须集中执行的原因:drei 的 TransformControls 在 dragging-changed 时会把默认控制器
 * 无条件置回 enabled=true(见其源码),掌镜/镜头视角下这是越权唤醒;让 gizmo 与关键帧拖拽
 * 都经 suspendOrbit/resumeOrbit 走同一条 observable,结束时本 effect 重跑即把状态拨正。
 */
export const OrbitAuthorityRig = observer(function OrbitAuthorityRig() {
    const { viewportCamera } = useDirectorDeskStores();
    const controls = useOrbitControls();
    const invalidate = useThree((state) => state.invalidate);
    const isOrbitEnabled = viewportCamera.isOrbitEnabled;

    useEffect(() => {
        if (!controls) return;
        controls.enabled = isOrbitEnabled;
        invalidate();
    }, [controls, invalidate, isOrbitEnabled]);

    return null;
});
