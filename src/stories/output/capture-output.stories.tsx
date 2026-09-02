import type { Meta, StoryObj } from "@storybook/react-vite";

import { HostBridgeConfiguration, HostBridgeSession } from "@/bridge/HostBridge";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { placeModel, seedShots, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta = { title: "输出/截图与录制" };
export default meta;

const STORY_SESSION_ID = "capture-output-story";
const CHECKLIST = [
    "点成片工具条「截图」或掌镜时按 Enter「拍照」→ 右下角缩略图;点击新窗口打开 PNG",
    "选中狐狸(带 gizmo/高亮框)再截:产物无网格/gizmo/高亮框",
    "掌镜中按 Enter「拍照」:产物与机位视角像素一致(画幅框是 DOM 层本就不入镜)",
    "静置场景(demand)截图成功;连截 20 张内存无增长",
    `控制台监听 message → 见 sessionId 为 ${STORY_SESSION_ID} 的 director-desk:capture-produced 带 blobUrl+宽高`,
] as const;

/** 预置狐狸 + 两个机位;选中态/机位切入在走查中手动完成 */
export const CaptureOutput: StoryObj = {
    name: "截图与录制",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                hostBridge={
                    new HostBridgeConfiguration(window, window.location.origin, new HostBridgeSession(STORY_SESSION_ID))
                }
                onReady={(stores) => {
                    placeModel(stores, TEST_ASSETS.fox);
                    seedShots(stores);
                }}
            />
            <AcceptancePanel task="输出 · 截图与录制" items={CHECKLIST} />
        </div>
    ),
};
