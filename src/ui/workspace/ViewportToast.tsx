import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineRounded";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { CHROME } from "@/ui/shell/theme";

const TOAST_MAX_WIDTH_PX = 560;
const TOAST_PADDING_X = 3;
const TOAST_STACK_GAP_PX = 8;

export const VIEWPORT_TOAST_SLOT = {
    CONTEXT: 0,
    APPLICATION: 1,
} as const;
export type ViewportToastSlot = (typeof VIEWPORT_TOAST_SLOT)[keyof typeof VIEWPORT_TOAST_SLOT];

export const VIEWPORT_TOAST_TONE = {
    NORMAL: "normal",
    ERROR: "error",
} as const;

interface ViewportToastBaseProps {
    readonly children: ReactNode;
    /** 同一 slot 的提示必须在状态上互斥;不同 slot 始终按固定高度堆叠。 */
    readonly slot: ViewportToastSlot;
}

interface NormalViewportToastProps extends ViewportToastBaseProps {
    readonly tone?: typeof VIEWPORT_TOAST_TONE.NORMAL;
    readonly open: boolean;
    readonly autoHideMs?: number;
    readonly onClose?: never;
}

interface ErrorViewportToastProps extends ViewportToastBaseProps {
    readonly tone: typeof VIEWPORT_TOAST_TONE.ERROR;
    readonly open: boolean;
    /** 错误必须显式确认，禁止自动隐藏或点击空白区域关闭。 */
    readonly autoHideMs?: never;
    readonly onClose: () => void;
}

type ViewportToastProps = NormalViewportToastProps | ErrorViewportToastProps;

/**
 * 视口提示条的唯一形态(Rule of Two:命令失败与操作提示共用)。
 *
 * 底部是时间线控制台的地盘，提示条固定在顶部。上下文提示和应用错误占用不同 slot，
 * 因此错误出现时不覆盖仍可操作的上下文提示。
 */
export const ViewportToast = observer(function ViewportToast({
    children,
    slot,
    tone = VIEWPORT_TOAST_TONE.NORMAL,
    open,
    autoHideMs,
    onClose,
}: ViewportToastProps) {
    const isError = tone === VIEWPORT_TOAST_TONE.ERROR;
    const topOffset = CHROME.edgeGapPx + slot * (CHROME.pillHeightPx + TOAST_STACK_GAP_PX);
    const autoHideDuration = isError || autoHideMs === undefined ? undefined : autoHideMs;
    const closeToast = isError ? onClose : undefined;
    return (
        <Snackbar
            open={open}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
            {...(autoHideDuration === undefined ? {} : { autoHideDuration })}
            sx={{
                top: { xs: topOffset, sm: topOffset },
                zIndex: CHROME.toastZIndex,
                pointerEvents: "none",
            }}
        >
            <Paper
                variant="pill"
                role={isError ? "alert" : "status"}
                aria-live={isError ? "assertive" : "polite"}
                sx={{
                    alignItems: "center",
                    backgroundColor: isError ? "error.dark" : undefined,
                    borderColor: isError ? "error.main" : undefined,
                    display: "flex",
                    height: CHROME.pillHeightPx,
                    justifyContent: "center",
                    maxWidth: TOAST_MAX_WIDTH_PX,
                    px: TOAST_PADDING_X,
                }}
            >
                {isError ? <ErrorOutlineIcon color="error" fontSize="small" sx={{ mr: 1 }} /> : null}
                <Typography component="div" variant="body1" sx={{ textAlign: "center" }}>
                    {children}
                </Typography>
                {closeToast ? (
                    <IconButton
                        aria-label="关闭错误提示"
                        onClick={closeToast}
                        size="small"
                        sx={{ ml: 1, pointerEvents: "auto" }}
                    >
                        <CloseIcon fontSize="small" />
                    </IconButton>
                ) : null}
            </Paper>
        </Snackbar>
    );
});
