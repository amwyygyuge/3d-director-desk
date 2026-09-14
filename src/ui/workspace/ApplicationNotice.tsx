import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { VIEWPORT_TOAST_SLOT, VIEWPORT_TOAST_TONE, ViewportToast } from "@/ui/workspace/ViewportToast";

const APPLICATION_NOTICE_AUTO_HIDE_MS = 3000;
/** 成功提示比错误多留一会儿:它带「按 T 看时间轴」这类可执行下一步,读完要够时间 */
const SUCCESS_NOTICE_AUTO_HIDE_MS = 4000;

/**
 * 应用级命令失败提示。
 * 悬浮壳层拆成四区后它不再归属任何一区,单独成层:全屏预览下也要能报错
 * (预览是命令驱动的,失败原因必须可见),所以不受 authoringVisible 门控。
 */
export const ApplicationNotice = observer(function ApplicationNotice() {
    const { ui } = useDirectorDeskStores();

    return (
        <ViewportToast
            autoHideMs={APPLICATION_NOTICE_AUTO_HIDE_MS}
            key={ui.applicationNotice}
            tone={VIEWPORT_TOAST_TONE.ERROR}
            slot={VIEWPORT_TOAST_SLOT.APPLICATION}
            open={ui.applicationNotice !== null}
            onClose={() => ui.clearApplicationNotice()}
        >
            {ui.applicationNotice}
        </ViewportToast>
    );
});

/**
 * 应用级成功提示(常态语气)。
 *
 * 与 `ApplicationNotice` 同一 slot:两者在语义上互斥——同一次操作要么成了要么没成,
 * 不该同时占两行。挂 `key` 让相同文案的连续两次操作也能重新触发动画
 * (连挂两个动作时,提示不会看起来「卡住没变」)。
 */
export const SuccessNotice = observer(function SuccessNotice() {
    const { ui } = useDirectorDeskStores();

    return (
        <ViewportToast
            autoHideMs={SUCCESS_NOTICE_AUTO_HIDE_MS}
            key={ui.successNotice}
            slot={VIEWPORT_TOAST_SLOT.APPLICATION}
            open={ui.successNotice !== null}
            onClose={() => ui.clearSuccessNotice()}
        >
            {ui.successNotice}
        </ViewportToast>
    );
});
