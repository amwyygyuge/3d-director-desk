import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { VIEWPORT_TOAST_SLOT, VIEWPORT_TOAST_TONE, ViewportToast } from "@/ui/workspace/ViewportToast";

const APPLICATION_NOTICE_AUTO_HIDE_MS = 3000;

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
