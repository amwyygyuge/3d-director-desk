import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DirectorDeskStores } from "../../ui/shell/DirectorDeskContext";
import { DirectorDesk } from "../../ui/shell/DirectorDesk";
import { TEST_ASSETS } from "./seeds";

const SUBJECT_ID = "lighting-subject";
const DIRECTIONAL_ID = "lighting-directional";
const POINT_ID = "lighting-point";
const SPOT_ID = "lighting-spot";

function dispatch(stores: DirectorDeskStores, type: string, payload: unknown): void {
    const result = stores.dispatcher.dispatch({ type, payload }, stores);
    if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Lighting acceptance: ${message}`);
}

function seedLightingAcceptance(stores: DirectorDeskStores): void {
    const capabilityTypes = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    assertAcceptance(capabilityTypes.includes("light.adjust"), "light.adjust capability 未注册");
    assertAcceptance(capabilityTypes.includes("lighting.list"), "lighting.list capability 未注册");
    assertAcceptance(capabilityTypes.includes("lighting.get"), "lighting.get capability 未注册");

    dispatch(stores, "object.place", {
        id: SUBJECT_ID,
        kind: "model",
        sourceUrl: TEST_ASSETS.helmet,
        name: "受光体",
        transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [2, 2, 2] },
    });
    dispatch(stores, "object.place", {
        id: DIRECTIONAL_ID,
        kind: "light",
        name: "验收平行光",
        light: { type: "directional", color: "#fff4d6", intensity: 1.5 },
        transform: { position: [4, 5, 4], rotation: [-0.7, 0.7, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "object.place", {
        id: POINT_ID,
        kind: "light",
        name: "验收点光",
        light: { type: "point", color: "#8ec5ff", intensity: 20 },
        transform: { position: [-3, 3, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "object.place", {
        id: SPOT_ID,
        kind: "light",
        name: "验收聚光",
        light: { type: "spot", color: "#ffd7a1", intensity: 25 },
        transform: { position: [0, 4, 4], rotation: [-0.6, 0, 0], scale: [1, 1, 1] },
    });

    dispatch(stores, "object.move", {
        id: POINT_ID,
        transform: { position: [-2, 4, 1], rotation: [0, 0.4, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "light.adjust", {
        id: SPOT_ID,
        light: { type: "spot", color: "#f0a8ff", intensity: 35 },
    });
    assertAcceptance(stores.scene.manager.getEntity(SPOT_ID)?.light?.intensity === 35, "light.adjust 未应用");
    assertAcceptance(stores.history.undo(stores).ok, "light.adjust undo 失败");
    assertAcceptance(stores.scene.manager.getEntity(SPOT_ID)?.light?.intensity === 25, "undo 未恢复完整 LightParams");
    assertAcceptance(stores.history.redo(stores).ok, "light.adjust redo 失败");

    dispatch(stores, "object.remove", { id: SPOT_ID });
    assertAcceptance(stores.history.undo(stores).ok, "删除灯光后的恢复失败");
    assertAcceptance(stores.scene.manager.getEntity(SPOT_ID)?.light?.type === "spot", "恢复后灯光类型丢失");
    assertAcceptance(stores.history.redo(stores).ok, "删除灯光 redo 失败");
    assertAcceptance(stores.history.undo(stores).ok, "删除灯光最终恢复失败");
    // 选中态是瞬时 UI 状态，不属于持久场景写入；使 Inspector 直接呈现可验收的变换与灯光参数。
    stores.selection.select(SPOT_ID);

    const listed = stores.dispatcher.query({ type: "lighting.list", payload: {} }, stores);
    assertAcceptance(listed.ok && Array.isArray(listed.value) && listed.value.length === 3, "lighting.list 返回异常");
    const missing = stores.dispatcher.query({ type: "lighting.get", payload: { id: "missing-light" } }, stores);
    const missingIssue = missing.ok ? undefined : missing.issueDetails?.[0];
    assertAcceptance(
        missingIssue?.code === "lighting.target-not-found" && missingIssue.path === "id",
        "lighting.get 未返回稳定结构化错误",
    );

    // Canvas 完成 onCreated 后经同一命令路径取样；helper 根会临时隐藏，真实灯光保持启用。
    requestAnimationFrame(() => dispatch(stores, "capture.frame", { hideHelpers: true }));
}

const meta: Meta<typeof DirectorDesk> = {
    title: "DirectorDesk/阶段二/灯光验收",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/**
 * 验收：三种灯光均由 dispatcher 播种。依次点击 Outliner 灯光可验证选择与 gizmo 变换；Inspector 验证类型、颜色、强度都经 light.adjust。
 * 点击截图后，成图应保留受光体的照明且不出现灯光标记、LightHelper 或方向箭头；撤销/重做与删除/恢复已在播种中断言。
 */
export const 三种灯光命令与截图纪律: Story = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedLightingAcceptance} />
        </div>
    ),
};
