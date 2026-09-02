import type { Meta, StoryObj } from "@storybook/react-vite";

import { provisionAction } from "@/command/actionProvisioning";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk, waitRuntime } from "@/stories/harness";
import { placeModel, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta<typeof DirectorDesk> = { title: "演员/动作挂载", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const FOX_ID = "action-fox";
const HELMET_ID = "action-helmet";
const FOX_CLIP_NAME = "Survey";
const PREVIEW_SEEK_SECONDS = 0.5;

const CHECKLIST = [
    "播种完成时狐狸已挂 Survey:按 P 播放,骨骼动画驱动模型(非整体位移)",
    "选中狐狸 → 检查器动作区:预览播放/暂停/seek 走独立预览时钟,不动全局时间轴",
    "切换挂载 Walk/Run:旧动作停、新动作起;卸载后回静态绑定姿势",
    "负例已由播种断言:无骨骼头盔挂狐狸 clip 被结构化拒绝(bone-incompatible + 可用动作清单)",
] as const;

async function seedActionMounting(stores: DirectorDeskStores): Promise<void> {
    const capabilityTypes = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    assertAcceptance(capabilityTypes.includes("action.mount"), "action.mount capability 未注册");
    assertAcceptance(capabilityTypes.includes("action.unmount"), "action.unmount capability 未注册");

    placeModel(stores, TEST_ASSETS.fox, { id: FOX_ID });
    placeModel(stores, TEST_ASSETS.helmet, { id: HELMET_ID, position: [2, 0, 0] });
    await waitRuntime(stores, FOX_ID);
    await waitRuntime(stores, HELMET_ID);

    // 负例先行:狐狸骨骼 clip 挂无骨骼头盔 → 结构化诊断(匹配率/缺失轨道/可用动作清单)
    const action = await provisionAction(stores, {
        name: `狐狸#${FOX_CLIP_NAME}`,
        url: TEST_ASSETS.fox,
        clipName: FOX_CLIP_NAME,
    });
    const rejected = stores.dispatcher.dispatch(
        { type: "action.mount", payload: { objectId: HELMET_ID, actionId: action.id } },
        stores,
    );
    assertAcceptance(
        !rejected.ok && (rejected.issues?.[0]?.includes("bone-incompatible") ?? false),
        "骨骼不兼容挂载未被结构化拒绝",
    );

    // 挂载 → 实体登记 actionId;预览三件套走独立时钟;卸载清回
    dispatchOk(stores, "action.mount", { objectId: FOX_ID, actionId: action.id });
    assertAcceptance(stores.scene.manager.getEntity(FOX_ID)?.actionId === action.id, "挂载未登记 actionId");
    dispatchOk(stores, "action.preview.play", { objectId: FOX_ID });
    assertAcceptance(stores.actionPreview.isPlaying, "动作预览未进入播放");
    dispatchOk(stores, "action.preview.seek", { objectId: FOX_ID, timeSeconds: PREVIEW_SEEK_SECONDS });
    dispatchOk(stores, "action.preview.pause", {});
    assertAcceptance(!stores.actionPreview.isPlaying, "动作预览未暂停");
    dispatchOk(stores, "action.unmount", { objectId: FOX_ID });
    assertAcceptance(stores.scene.manager.getEntity(FOX_ID)?.actionId === undefined, "卸载未清除 actionId");

    // 终态保持已挂载:走查从「狐狸带动作」开始
    dispatchOk(stores, "action.mount", { objectId: FOX_ID, actionId: action.id });
    stores.selection.select(FOX_ID);
}

/** 狐狸挂内嵌 clip;骨骼不兼容拒绝与预览时钟已在播种断言 */
export const ActionMounting: Story = {
    name: "挂载/预览/卸载",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => void seedActionMounting(stores)} />
            <AcceptancePanel task="演员 · 动作挂载" items={CHECKLIST} />
        </div>
    ),
};
