import Snackbar from "@mui/material/Snackbar";
import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "../DirectorDeskContext";

const NOTICE_DURATION_MS = 3000;

/**
 * 应用级命令失败提示。
 * 悬浮壳层拆成四区后它不再归属任何一区,单独成层:全屏预览下也要能报错
 * (预览是命令驱动的,失败原因必须可见),所以不受 authoringVisible 门控。
 */
export const ApplicationNotice = observer(function ApplicationNotice() {
    const { ui } = useDirectorDeskStores();

    return (
        <Snackbar
            open={ui.applicationNotice !== null}
            autoHideDuration={NOTICE_DURATION_MS}
            onClose={() => ui.clearApplicationNotice()}
            message={ui.applicationNotice}
            slotProps={{ content: { role: "alert", "aria-live": "assertive" } }}
            anchorOrigin={{ vertical: "top", horizontal: "center" }}
            sx={{ zIndex: 40 }}
        />
    );
});
