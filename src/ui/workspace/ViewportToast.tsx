import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineRounded";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { CHROME, SELECTABLE_ATTRIBUTE } from "@/ui/shell/theme";

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
    /**
     * 可选:提示源自 store 字段时必须给——自动收起只关 Snackbar,不清那个字段,
     * 不回写就再也触发不了同一条提示(第二次操作静默)。纯派生的提示(如交互提示)不需要。
     */
    readonly onClose?: () => void;
}

interface ErrorViewportToastProps extends ViewportToastBaseProps {
    readonly tone: typeof VIEWPORT_TOAST_TONE.ERROR;
    readonly open: boolean;
    /** 错误三秒后收起，关闭按钮始终可用于立即确认。 */
    readonly autoHideMs: number;
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
    const autoHideDuration = autoHideMs;
    // 两种语气都要回调:成功提示也源自 store 字段,自动收起后必须回写才能再次触发
    return (
        <Snackbar
            open={open}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
            {...(autoHideDuration === undefined ? {} : { autoHideDuration })}
            onClose={onClose}
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
                {/* 错误文案要能复制去排查:整体禁选后需显式还原,并把指针事件收回来
                    (提示条整体 pointerEvents: none 是为了不挡视口,选中文本是唯一的例外) */}
                <Typography
                    component="div"
                    variant="body1"
                    sx={{ textAlign: "center", ...(isError ? { pointerEvents: "auto" } : {}) }}
                    {...(isError ? { [SELECTABLE_ATTRIBUTE]: "" } : {})}
                >
                    {children}
                </Typography>
                {/* 关闭按钮只给错误:成功提示自动收起即可,多一颗叉是噪音 */}
                {isError && onClose ? (
                    <IconButton
                        aria-label="关闭错误提示"
                        onClick={onClose}
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
