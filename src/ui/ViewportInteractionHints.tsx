import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";

import { SHORTCUT_ID, formatShortcutHint } from "../shortcuts/builtinShortcuts";
import type { ShortcutId } from "../shortcuts/builtinShortcuts";
import type { DirectorDeskStores } from "./DirectorDeskContext";
import { useDirectorDeskStores } from "./DirectorDeskContext";

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
    readonly id: "shot-selected" | "shot-navigation";
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
            { shortcutId: SHORTCUT_ID.SHOT_EXIT, label: "退出掌镜" },
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

function resolveViewportInteractionHint(stores: DirectorDeskStores): ViewportInteractionHint | null {
    if (stores.camera.activeShotId !== null) return VIEWPORT_INTERACTION_HINT.SHOT_NAVIGATION;
    const primaryId = stores.selection.primaryId;
    const isShotSelected = primaryId !== null && stores.camera.director.getShot(primaryId) !== undefined;
    return isShotSelected ? VIEWPORT_INTERACTION_HINT.SHOT_SELECTED : null;
}

/** 常驻的非阻塞操作提示:内容由领域状态解析器提供,渲染器不持有模式逻辑。 */
function renderInteractionHintToast(hint: ViewportInteractionHint | null) {
    return (
        <Snackbar
            open={hint !== null}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            sx={{ pointerEvents: "none" }}
            message={
                hint ? (
                    <Typography variant="body2" component="span">
                        {formatInteractionHint(hint)}
                    </Typography>
                ) : null
            }
        />
    );
}

/** 视口交互提示协调器:同一时刻只解析并显示最高优先级的一条提示。 */
export const ViewportInteractionHints = observer(function ViewportInteractionHints() {
    const stores = useDirectorDeskStores();
    const hint = resolveViewportInteractionHint(stores);
    return renderInteractionHintToast(hint);
});
