import type { Meta, StoryObj } from "@storybook/react-vite";

import { HostBridgeConfiguration, HostBridgeSession } from "../../bridge/HostBridge";
import { DirectorDesk } from "../DirectorDesk";
import { AcceptancePanel } from "./AcceptancePanel";
import { placeModel, TEST_ASSETS } from "./seeds";

const meta: Meta = { title: "验收/03 模型导入" };
export default meta;

const STORY_SESSION_ID = "model-import-story";
const CHECKLIST = [
    "预置 GLB/FBX/OBJ 各一:加载完成正常显示(归一化到约 2 单位高)",
    "工具条「导入模型」选本地文件;同一文件再导一次 → 底部提示去重",
    "选中模型按 Delete 删除;加载中显示线框占位",
    `控制台模拟可信宿主:window.postMessage({type:'director-desk:import-model',sessionId:'${STORY_SESSION_ID}',payload:{url:'/test-assets/fox.glb',name:'fox'}},window.location.origin)`,
    "Chrome 内存面板:删除后回落(dispose 纪律)",
] as const;

/** 预置三种格式模型各一 */
export const ThreeFormats: StoryObj = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                hostBridge={
                    new HostBridgeConfiguration(window, window.location.origin, new HostBridgeSession(STORY_SESSION_ID))
                }
                onReady={(stores) => {
                    placeModel(stores, TEST_ASSETS.helmet);
                    placeModel(stores, TEST_ASSETS.sambaFbx);
                    placeModel(stores, TEST_ASSETS.maleObj);
                }}
            />
            <AcceptancePanel task="03 · 模型导入(GLB/FBX/OBJ)" items={CHECKLIST} />
        </div>
    ),
};
