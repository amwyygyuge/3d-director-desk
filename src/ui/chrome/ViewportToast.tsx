import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { CHROME } from "../theme";

const TOAST_MAX_WIDTH_PX = 560;
const TOAST_PADDING_X = 3;

interface ViewportToastProps {
    readonly open: boolean;
    readonly children: ReactNode;
    /** 命令失败提示需要 role=alert 播报;常驻操作提示不该抢屏幕阅读器 */
    readonly assertive?: boolean;
    readonly autoHideMs?: number;
    readonly onClose?: () => void;
}

/**
 * 视口提示条的唯一形态(Rule of Two:命令失败与操作提示共用)。
 *
 * 它占据顶部药丸条空出来的正中位置:同一条基线、同样的高度与药丸外形,
 * 读起来像工具栏的第三块而不是飘在画面上的浮层。
 * 底部是时间线控制台的地盘,MUI 默认的 bottom center 会压在上面;
 * 默认的 SnackbarContent 在暗色主题下是反色浅底,与整套壳层割裂,故自绘 Paper。
 */
export const ViewportToast = observer(function ViewportToast({
    open,
    children,
    assertive = false,
    autoHideMs,
    onClose,
}: ViewportToastProps) {
    return (
        <Snackbar
            open={open}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
            {...(autoHideMs === undefined ? {} : { autoHideDuration: autoHideMs })}
            {...(onClose === undefined ? {} : { onClose })}
            // MUI 在 sm 断点里另给 anchorOriginTopCenter 一个 top,单值 sx 会被它盖掉;
            // 用响应式对象在同样的断点里覆盖,才能与药丸条对齐到同一条基线
            sx={{
                top: { xs: CHROME.edgeGapPx, sm: CHROME.edgeGapPx },
                zIndex: CHROME.toastZIndex,
                pointerEvents: "none",
            }}
        >
            <Paper
                variant="pill"
                role={assertive ? "alert" : "status"}
                aria-live={assertive ? "assertive" : "polite"}
                sx={{
                    alignItems: "center",
                    display: "flex",
                    height: CHROME.pillHeightPx,
                    justifyContent: "center",
                    maxWidth: TOAST_MAX_WIDTH_PX,
                    px: TOAST_PADDING_X,
                }}
            >
                <Typography variant="body1" sx={{ textAlign: "center" }}>
                    {children}
                </Typography>
            </Paper>
        </Snackbar>
    );
});
