import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "../../ui/shell/DirectorDesk";
import { AcceptancePanel } from "./AcceptancePanel";
import { placeModels } from "./seeds";

const meta: Meta = { title: "验收/02 场景画布" };
export default meta;

const CHECKLIST = [
    "从工具条导入模型并显示在场景内",
    "拖轨道相机浏览正常;松手静止",
    "「清空」一键删除,计数实时归零",
    "DevTools 性能面板:静置时无渲染帧(demand 闭环)",
] as const;

/** 空场景:从工具条导入/清空模型,验证 demand 渲染闭环 */
export const EmptyScene: StoryObj = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk />
            <AcceptancePanel task="02 · 场景画布(空场景)" items={CHECKLIST} />
        </div>
    ),
};

/** 预置 5 个模型:直接走查浏览与删除 */
export const WithModels: StoryObj = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => placeModels(stores, 5)} />
            <AcceptancePanel task="02 · 场景画布(预置 5 个模型)" items={CHECKLIST} />
        </div>
    ),
};
