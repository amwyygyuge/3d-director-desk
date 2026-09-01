import { observer } from "mobx-react-lite";

import type { MotionKeyContextRequest } from "@/ui/viewport/scene/MotionClipPathPreview";
import { MotionClipPathPreview } from "@/ui/viewport/scene/MotionClipPathPreview";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

export interface MotionPathPreviewProps {
    readonly onKeyContextMenu: (request: MotionKeyContextRequest) => void;
}

/** 运镜轨迹辅助物:全屏预览时直接卸载,其余编辑模式由编排态开关控制。 */
export const MotionPathPreview = observer(function MotionPathPreview({ onKeyContextMenu }: MotionPathPreviewProps) {
    const { motion, motionAuthoring } = useDirectorDeskStores();
    if (!motionAuthoring.pathHelpersVisible) return null;
    return (
        <group userData={{ helper: true }}>
            {motion.clips.map((clip) => (
                <MotionClipPathPreview key={clip.id} clipId={clip.id} onKeyContextMenu={onKeyContextMenu} />
            ))}
        </group>
    );
});
