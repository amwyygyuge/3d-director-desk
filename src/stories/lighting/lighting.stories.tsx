import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import { TEST_ASSETS } from "@/stories/seeds";
import { assertAcceptance, dispatchOk as dispatch } from "@/stories/harness";

const SUBJECT_ID = "lighting-subject";
const DIRECTIONAL_ID = "lighting-directional";
const POINT_ID = "lighting-point";
const SPOT_ID = "lighting-spot";
const POINT_LIGHT_DISTANCE_METERS = 12;
const POINT_LIGHT_DECAY = 2;
const SPOT_LIGHT_DISTANCE_METERS = 9;
const SPOT_LIGHT_DECAY = 2;
const SPOT_LIGHT_ANGLE_DEGREES = 36;
const SPOT_LIGHT_PENUMBRA = 0.4;
const ADJUSTED_SPOT_DISTANCE_METERS = 7;
const ADJUSTED_SPOT_ANGLE_DEGREES = 24;
const ADJUSTED_SPOT_PENUMBRA = 0.6;

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
        light: {
            type: "point",
            color: "#8ec5ff",
            intensity: 20,
            distance: POINT_LIGHT_DISTANCE_METERS,
            decay: POINT_LIGHT_DECAY,
        },
        transform: { position: [-3, 3, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "object.place", {
        id: SPOT_ID,
        kind: "light",
        name: "验收聚光",
        light: {
            type: "spot",
            color: "#ffd7a1",
            intensity: 25,
            distance: SPOT_LIGHT_DISTANCE_METERS,
            decay: SPOT_LIGHT_DECAY,
            angleDegrees: SPOT_LIGHT_ANGLE_DEGREES,
            penumbra: SPOT_LIGHT_PENUMBRA,
        },
        transform: { position: [0, 4, 4], rotation: [-0.6, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "scene.set-lighting-mode", { mode: "custom" });
    assertAcceptance(stores.scene.lightingMode === "custom", "自定义灯光模式未启用");

    dispatch(stores, "object.move", {
        id: POINT_ID,
        transform: { position: [-2, 4, 1], rotation: [0, 0.4, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "light.adjust", {
        id: SPOT_ID,
        light: {
            type: "spot",
            color: "#f0a8ff",
            intensity: 35,
            distance: ADJUSTED_SPOT_DISTANCE_METERS,
            decay: SPOT_LIGHT_DECAY,
            angleDegrees: ADJUSTED_SPOT_ANGLE_DEGREES,
            penumbra: ADJUSTED_SPOT_PENUMBRA,
        },
    });
    const adjustedSpot = stores.scene.manager.getEntity(SPOT_ID)?.light;
    assertAcceptance(
        adjustedSpot?.type === "spot" && adjustedSpot.angleDegrees === ADJUSTED_SPOT_ANGLE_DEGREES,
        "light.adjust 未应用灯型专属参数",
    );
    assertAcceptance(stores.history.undo(stores).ok, "light.adjust undo 失败");
    const restoredSpot = stores.scene.manager.getEntity(SPOT_ID)?.light;
    assertAcceptance(
        restoredSpot?.type === "spot" && restoredSpot.angleDegrees === SPOT_LIGHT_ANGLE_DEGREES,
        "undo 未恢复完整 LightParams",
    );
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
    title: "灯光/灯光命令与截图纪律",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/**
 * 验收：三种灯光均由 dispatcher 播种。未选中时视口只留三个小型颜色标记；在 Outliner 选择任一灯光后，仅该灯光展示方向箭头、范围或锥体线框，切换选择时前一线框必须立即卸载。
 * Inspector 验证类型、颜色、强度都经 light.adjust；截图应保留受光体照明且不出现灯光标记、LightHelper 或方向箭头；撤销/重做与删除/恢复已在播种中断言。
 */
export const LightingCommands: Story = {
    name: "三种灯光与截图纪律",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedLightingAcceptance} />
        </div>
    ),
};
