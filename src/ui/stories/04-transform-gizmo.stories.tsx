import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "../DirectorDesk";
import { AcceptancePanel } from "./AcceptancePanel";
import { placePrimitives } from "./seeds";

const meta: Meta = { title: "验收/04 摆位操作" };
export default meta;

const CHECKLIST = [
    "点选几何体 → 黄色包围盒 + gizmo;点空白取消",
    "W/E/R 切移动/旋转/缩放;工具条按钮同步;tooltip 显示平台化快捷键",
    "拖拽中 MobX 面板看 revision 不变,松手一次性 +1 且位置不回弹",
    "选中后 X/Y/Z 锁定单轴,再按同轴恢复三轴",
    "cmd/ctrl 点选多选(双高亮、gizmo 挂主选);Delete 一次删净;Esc 取消选中",
] as const;

/** 预置 3 个几何体供 gizmo 走查 */
export const GizmoOps: StoryObj = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => placePrimitives(stores, 3)} />
            <AcceptancePanel task="04 · 摆位操作(gizmo + 快捷键)" items={CHECKLIST} />
        </div>
    ),
};
