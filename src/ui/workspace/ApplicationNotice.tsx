import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "../shell/DirectorDeskContext";
import { ViewportToast } from "./ViewportToast";

const NOTICE_DURATION_MS = 3000;

/**
 * 应用级命令失败提示。
 * 悬浮壳层拆成四区后它不再归属任何一区,单独成层:全屏预览下也要能报错
 * (预览是命令驱动的,失败原因必须可见),所以不受 authoringVisible 门控。
 */
export const ApplicationNotice = observer(function ApplicationNotice() {
    const { ui } = useDirectorDeskStores();

    return (
        <ViewportToast
            assertive
            open={ui.applicationNotice !== null}
            autoHideMs={NOTICE_DURATION_MS}
            onClose={() => ui.clearApplicationNotice()}
        >
            {ui.applicationNotice}
        </ViewportToast>
    );
});
