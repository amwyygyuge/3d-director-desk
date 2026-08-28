import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "../DirectorDesk";
import { AcceptancePanel } from "./AcceptancePanel";
import { placeModel, seedShots, TEST_ASSETS } from "./seeds";

const meta: Meta = { title: "验收/07 预演画面输出" };
export default meta;

const CHECKLIST = [
    "点「截图」→ 右下角缩略图;点击新窗口打开 PNG",
    "选中狐狸(带 gizmo/高亮框)再截:产物无网格/gizmo/高亮框",
    "激活机位再截:产物与机位视角像素一致(画幅框是 DOM 层本就不入镜)",
    "静置场景(demand)截图成功;连截 20 张内存无增长",
    "控制台监听 message → 见 director-desk:capture-produced 带 blobUrl+宽高",
] as const;

/** 预置狐狸 + 两个机位;选中态/机位切入在走查中手动完成 */
export const CaptureOutput: StoryObj = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                onReady={(stores) => {
                    placeModel(stores, TEST_ASSETS.fox);
                    seedShots(stores);
                }}
            />
            <AcceptancePanel task="07 · 预演画面输出" items={CHECKLIST} />
        </div>
    ),
};
