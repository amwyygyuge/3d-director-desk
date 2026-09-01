import { observer } from "mobx-react-lite";
import { useCallback } from "react";

import { isCommandIssue } from "@/authoring/KeyframeAuthoringService";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useViewportPoseGesture } from "@/ui/viewport/scene/useViewportPoseGesture";

/**
 * 镜头视角摆位:手势期间只修改 R3F 相机;停手后经 KeyframeAuthoringService
 * 把当前视口画面解析为当前片段的一枚 motion.set-key。
 */
export const LensNavigation = observer(function LensNavigation() {
    const stores = useDirectorDeskStores();
    const active = stores.motionAuthoring.lensViewActive && !stores.clock.isPlaying;
    const commitLensPose = useCallback(() => {
        const resolved = stores.keyframeAuthoring.resolveCameraKey(stores);
        if (isCommandIssue(resolved)) {
            stores.ui.setApplicationNotice(resolved.message);
            return;
        }
        const result = stores.dispatcher.dispatch(resolved, stores);
        if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    }, [stores]);

    useViewportPoseGesture({ active, onCommit: commitLensPose });
    return null;
});
