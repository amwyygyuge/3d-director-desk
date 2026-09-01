import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useViewportPoseGesture } from "@/ui/viewport/scene/useViewportPoseGesture";

/**
 * 镜头视角摆位:拖拽 / WASD 只改 R3F 相机,是纯试镜——**不落任何命令**。
 *
 * 写入唯一入口是 K(ShortcutRegistry → KeyframeAuthoringService.resolve → motion.set-key):
 * 运镜片段是成品数据,随手转一下画面就往里种关键帧会让编排面目全非。
 * 未按 K 的画面在下一次采样(seek / 落键 / 播放)时被成片姿态覆盖,这是有意的丢弃语义。
 */
export const LensNavigation = observer(function LensNavigation() {
    const stores = useDirectorDeskStores();
    const active = stores.viewportCamera.isLensAuthoring && !stores.clock.isPlaying;

    useViewportPoseGesture({ active });
    return null;
});
