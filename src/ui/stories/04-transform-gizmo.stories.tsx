import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "../DirectorDesk";
import { AcceptancePanel } from "./AcceptancePanel";
import { placeModels } from "./seeds";

const meta: Meta = { title: "验收/04 摆位操作" };
export default meta;

const CHECKLIST = [
    "点选模型 → 黄色包围盒 + gizmo;点空白取消",
    "工具条三态按钮切移动/旋转/缩放(W/E/R 已让位给 WASD 飞行,模式切换走工具条)",
    "拖拽中 Inspector 数值不刷新(零 store 写入),松手一次性提交且位置不回弹",
    "选中后 X/Y/Z 锁定单轴,再按同轴恢复三轴",
    "cmd/ctrl 点选多选(双高亮、gizmo 挂主选);Delete 一次删净;Esc 取消选中",
] as const;

/** 预置 3 个模型供 gizmo 走查 */
export const GizmoOps: StoryObj = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => placeModels(stores, 3)} />
            <AcceptancePanel task="04 · 摆位操作(gizmo + 快捷键)" items={CHECKLIST} />
        </div>
    ),
};
