import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { observer } from "mobx-react-lite";
import { createContext, type MouseEvent, type ReactNode, useContext, useState } from "react";

import { subjectBoundsFor } from "@/command/subjectBounds";
import { FOLLOW_FRAME } from "@/motion/SubjectFrameResolver";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";

const DEFAULT_MARKER_LABEL = "标记";
const ADD_MARKER_LABEL = "在此打标记";
const DELETE_LABEL = "删除";
const RESET_HANDLES_LABEL = "恢复自动手柄";
const SEEK_LABEL = "定位到此";
const BIND_FOLLOW_LABEL = "跟拍选中模型";
const FOLLOW_ANCHOR_ORIGIN = [0, 0, 0] as const;
const SINGLE_SELECTION_COUNT = 1;

interface TimelineMenuPosition {
    readonly left: number;
    readonly top: number;
    readonly timeSeconds: number;
    readonly motionClipId: string | null;
}

interface TimelineContextMenuController {
    readonly open: (event: MouseEvent<HTMLElement>, timeSeconds: number, motionClipId?: string | null) => void;
}
const TimelineContextMenuContext = createContext<TimelineContextMenuController | null>(null);

/** 轨道内右键统一复用命令信封，避免组件各自绕过撤销栈写状态。 */
export function useTimelineContextMenu(): TimelineContextMenuController {
    const controller = useContext(TimelineContextMenuContext);
    if (!controller) throw new Error("TimelineContextMenu must wrap timeline interaction targets");
    return controller;
}

export const TimelineContextMenu = observer(function TimelineContextMenu({
    children,
}: {
    readonly children: ReactNode;
}) {
    const stores = useDirectorDeskStores();
    const [position, setPosition] = useState<TimelineMenuPosition | null>(null);
    const close = (): void => setPosition(null);
    const open = (event: MouseEvent<HTMLElement>, timeSeconds: number, motionClipId: string | null = null): void => {
        event.preventDefault();
        setPosition({ left: event.clientX, top: event.clientY, timeSeconds, motionClipId });
    };
    const dispatch = (command: { readonly type: string; readonly payload: unknown }): void => {
        reportCommandFailure(stores, stores.dispatcher.dispatch(command, stores));
        close();
    };
    const selection = stores.timelineSelection.current;
    const selectedObjectId =
        stores.selection.selectedIds.length === SINGLE_SELECTION_COUNT ? stores.selection.primaryId : null;
    const selectedEntity = selectedObjectId ? stores.scene.manager.getEntity(selectedObjectId) : null;
    const selectedModel = selectedEntity?.kind === "model" ? selectedEntity : null;
    const motionClipId = position?.motionClipId ?? null;
    const motionClip = motionClipId ? stores.motion.clip(motionClipId) : undefined;
    const canBindSelectedModel = selectedModel !== null && motionClip !== undefined && motionClip.follow === null;
    const deleteCommand = selection.deleteCommand();
    const resetHandlesCommand =
        selection.motionClipId && selection.motionKeyId
            ? {
                  type: "motion.reset-key-handles",
                  payload: { clipId: selection.motionClipId, keyId: selection.motionKeyId },
              }
            : null;
    return (
        <TimelineContextMenuContext.Provider value={{ open }}>
            {children}
            <Menu
                anchorReference="anchorPosition"
                anchorPosition={position ? { left: position.left, top: position.top } : undefined}
                onClose={close}
                open={position !== null}
            >
                <MenuItem
                    disabled={position === null}
                    onClick={() => {
                        if (!position) return;
                        dispatch({ type: "transport.seek", payload: { time: position.timeSeconds } });
                    }}
                >
                    {SEEK_LABEL}
                </MenuItem>
                <MenuItem
                    disabled={position === null}
                    onClick={() => {
                        if (!position) return;
                        dispatch({
                            type: "timeline.add-marker",
                            payload: {
                                id: crypto.randomUUID(),
                                timeSeconds: position.timeSeconds,
                                label: DEFAULT_MARKER_LABEL,
                            },
                        });
                    }}
                >
                    {ADD_MARKER_LABEL}
                </MenuItem>
                {canBindSelectedModel && (
                    <MenuItem
                        onClick={() => {
                            if (!motionClipId || !selectedModel) return;
                            dispatch({
                                type: "motion.bind-follow",
                                payload: {
                                    id: motionClipId,
                                    objectId: selectedModel.id,
                                    anchorOffset:
                                        subjectBoundsFor(stores, selectedModel.id)?.focusOffset ?? FOLLOW_ANCHOR_ORIGIN,
                                    frame: FOLLOW_FRAME.HEADING,
                                    lagSeconds: 0,
                                    smoothingSeconds: 0,
                                },
                            });
                        }}
                    >
                        {BIND_FOLLOW_LABEL}
                    </MenuItem>
                )}
                <MenuItem disabled={deleteCommand === null} onClick={() => deleteCommand && dispatch(deleteCommand)}>
                    {DELETE_LABEL}
                </MenuItem>
                {resetHandlesCommand && (
                    <MenuItem onClick={() => dispatch(resetHandlesCommand)}>{RESET_HANDLES_LABEL}</MenuItem>
                )}
            </Menu>
        </TimelineContextMenuContext.Provider>
    );
});
