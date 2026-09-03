import type { Meta, StoryObj } from "@storybook/react-vite";
import Button from "@mui/material/Button";
import { useState } from "react";

import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
const NOTICE_MESSAGE = "错误提示会在三秒后自动关闭，也可立即手动关闭";
const NOTICE_CONTROL_OFFSET_PX = 16;
const NOTICE_CONTROL_Z_INDEX = 2000;

const meta: Meta<typeof DirectorDesk> = { title: "壳层/错误提示", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const NoticeStorySurface = () => {
    const [stores, setStores] = useState<DirectorDeskStores | null>(null);
    const showNotice = (): void => stores?.ui.setApplicationNotice(NOTICE_MESSAGE);
    return (
        <div style={{ height: "100vh", position: "relative", width: "100vw" }}>
            <DirectorDesk
                onReady={(nextStores) => {
                    setStores(nextStores);
                    nextStores.ui.setApplicationNotice(NOTICE_MESSAGE);
                }}
            />
            <Button
                onClick={showNotice}
                sx={{
                    left: NOTICE_CONTROL_OFFSET_PX,
                    position: "absolute",
                    top: NOTICE_CONTROL_OFFSET_PX,
                    zIndex: NOTICE_CONTROL_Z_INDEX,
                }}
                variant="contained"
            >
                显示错误提示
            </Button>
        </div>
    );
};

/** 应用错误提示的人工验收入口：首次挂载即显示，验证自动消失和关闭按钮。 */
export const TimedAndDismissible: Story = {
    name: "三秒自动关闭",
    render: () => <NoticeStorySurface />,
};
