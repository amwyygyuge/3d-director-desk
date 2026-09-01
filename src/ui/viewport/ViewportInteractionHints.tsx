import { observer } from "mobx-react-lite";

import { ViewportToast } from "@/ui/workspace/ViewportToast";
import { SHORTCUT_ID, formatShortcutHint } from "@/shortcuts/builtinShortcuts";
import type { ShortcutId } from "@/shortcuts/builtinShortcuts";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

interface KeyInteractionHintSegment {
    readonly keys: string;
    readonly label: string;
}

interface ShortcutInteractionHintSegment {
    readonly shortcutId: ShortcutId;
    readonly label: string;
}

type InteractionHintSegment = KeyInteractionHintSegment | ShortcutInteractionHintSegment;

interface ViewportInteractionHint {
    readonly id: "shot-selected" | "shot-navigation" | "lens-navigation";
    readonly segments: readonly InteractionHintSegment[];
}

/** 视口操作提示注册表:按领域交互状态声明内容,不在各模式组件中重复构造 Snackbar。 */
const VIEWPORT_INTERACTION_HINT = {
    SHOT_SELECTED: {
        id: "shot-selected",
        segments: [{ shortcutId: SHORTCUT_ID.SHOT_ENTER, label: "进入掌镜" }],
    },
    SHOT_NAVIGATION: {
        id: "shot-navigation",
        segments: [
            { keys: "WASD", label: "移动" },
            { keys: "Space/Shift", label: "升降" },
            { keys: "按住拖拽", label: "转向" },
            { keys: "滚轮", label: "变焦" },
            { shortcutId: SHORTCUT_ID.SHOT_PHOTO, label: "拍照" },
            { shortcutId: SHORTCUT_ID.SHOT_EXIT, label: "退出掌镜" },
        ],
    },
    LENS_NAVIGATION: {
        id: "lens-navigation",
        segments: [
            { keys: "WASD", label: "移动" },
            { keys: "按住拖拽", label: "试镜" },
            { keys: "滚轮", label: "变焦" },
            { shortcutId: SHORTCUT_ID.TIMELINE_ADD_KEY, label: "写入关键帧" },
            { shortcutId: SHORTCUT_ID.LENS_EXIT, label: "退出" },
        ],
    },
} as const satisfies Record<string, ViewportInteractionHint>;

function formatInteractionHintSegment(segment: InteractionHintSegment): string {
    const keys = "shortcutId" in segment ? formatShortcutHint(segment.shortcutId) : segment.keys;
    return `${keys} ${segment.label}`;
}

function formatInteractionHint(hint: ViewportInteractionHint): string {
    return hint.segments.map(formatInteractionHintSegment).join(" · ");
}

/** 生效片段的裁决与采样器/打点服务同源:提示条不得自成一套判据。 */
function hasLensClip(stores: DirectorDeskStores): boolean {
    return (
        stores.motion.resolveOutputClipAt(stores.playheadDisplay.value, stores.motionAuthoring.previewClipId) !== null
    );
}

function resolveViewportInteractionHint(stores: DirectorDeskStores): ViewportInteractionHint | null {
    // 无片段时的提示条与「在此创建 1 秒片段」由 ShotFrameOverlay 承担,此处不重复一套
    if (stores.motionAuthoring.lensViewActive) return hasLensClip(stores) ? VIEWPORT_INTERACTION_HINT.LENS_NAVIGATION : null;
    if (stores.camera.activeShotId !== null) return VIEWPORT_INTERACTION_HINT.SHOT_NAVIGATION;
    const primaryId = stores.selection.primaryId;
    const isShotSelected = primaryId !== null && stores.camera.director.getShot(primaryId) !== undefined;
    return isShotSelected ? VIEWPORT_INTERACTION_HINT.SHOT_SELECTED : null;
}

/** 视口交互提示协调器:同一时刻只解析并显示最高优先级的一条提示。 */
export const ViewportInteractionHints = observer(function ViewportInteractionHints() {
    const stores = useDirectorDeskStores();
    const hint = resolveViewportInteractionHint(stores);
    return <ViewportToast open={hint !== null}>{hint ? formatInteractionHint(hint) : null}</ViewportToast>;
});
