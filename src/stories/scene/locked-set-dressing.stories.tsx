import type { Meta, StoryObj } from "@storybook/react-vite";

import { waitMs } from "@/core/waitMs";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk, required, waitRuntime } from "@/stories/harness";
import { TEST_ASSETS } from "@/stories/seeds";

const meta: Meta = { title: "场景/锁定布景" };
export default meta;

const SET_DRESSING_ID = "locked-set-dressing";
const ACTOR_ID = "unlocked-actor";
const HUMANOID_ASSET_ID = "builtin.humanoid-generic";
/** 人偶让开布景 2 米:两者不重叠,点选命中的是谁一眼可辨(锁围栏是逐实体的,不靠遮挡判断)。 */
const ACTOR_OFFSET_METERS = 2;
const ORIGIN_TRANSFORM = {
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
};
/** 内置目录是异步 fetch(catalog.loadProvider 是 void 调用),onReady 时未必已就绪 */
const CATALOG_ATTEMPT_LIMIT = 40;
const CATALOG_INTERVAL_MS = 250;

/**
 * 等内置资源目录就绪。
 *
 * `assets.place` 校验期就要求条目在目录里(不在则结构化拒绝),而内置 catalog.json
 * 是 fire-and-forget 的异步 fetch:onReady 里直接下发会随机撞空目录。
 */
async function waitCatalogEntry(
    stores: DirectorDeskStores,
    assetId: string,
    remainingAttempts = CATALOG_ATTEMPT_LIMIT,
): Promise<void> {
    if (stores.catalog.get(assetId)) return;
    if (remainingAttempts === 0) throw new Error(`验收断言失败: 内置资源 ${assetId} 超时未加载`);
    await waitMs(CATALOG_INTERVAL_MS);
    await waitCatalogEntry(stores, assetId, remainingAttempts - 1);
}

/**
 * 人工走查点(锁只围栏视口交互,不围栏大纲与命令层):
 * 1. 点画布里的布景(原点那台模型)→ 不出现黄色包围盒、右栏不切到它、gizmo 不挂载。
 * 2. 点 2 米外的人偶 → 正常选中(包围盒 + gizmo),证明围栏是逐实体的,不是整场景失效。
 * 3. Outliner「对象」组里布景行带「已锁定」副标题与实心锁图标,人偶行是开锁图标。
 * 4. 点大纲里的布景行 → **可以**选中(视口点选被锁挡掉后,大纲是锁定实体唯一的选择入口);
 *    但 gizmo 仍不挂载,右栏 Transform 整组字段置灰禁用,锁住的是编辑而非索引。
 * 5. 点布景行的锁按钮解锁 → 视口里再点即可正常选中并挂 gizmo;再点锁按钮锁回去
 *    → 选中态与 gizmo 当场被摘除。⌘Z 可撤销任一次锁切换。
 * 6. 布景虽锁,`object.move` 等命令层写入仍生效(锁只挡人手,不挡命令)。
 */
const CHECKLIST = [
    "点画布中央的布景模型:无黄色包围盒、无 gizmo、右栏不切到它",
    "点 2 米外的人偶:正常选中并挂 gizmo(围栏逐实体,不是整场景失效)",
    "Outliner 布景行:实心锁图标 + 「已锁定」副标题;人偶行为开锁图标",
    "点大纲布景行:可选中(大纲是锁定实体唯一入口),但 gizmo 不挂、Transform 字段置灰",
    "点大纲锁按钮解锁 → 视口可点选并挂 gizmo;锁回去 → 选中与 gizmo 当场摘除;⌘Z 可撤销",
    "已锁布景仍可被 object.move 写入(锁只挡人手,不挡命令层)",
] as const;

/**
 * 播种全经命令层(dispatcher),不直写 store:
 * - 布景走 `object.place` 并在 payload 里带 locked:true(契约含 locked,一步落锁,不用先放后锁);
 * - 人偶走 `assets.place`(目录条目自带 URL/骨架族/人偶画像,不手拼 sourceUrl)。
 */
async function seedLockedSetDressing(stores: DirectorDeskStores): Promise<void> {
    dispatchOk(stores, "object.place", {
        id: SET_DRESSING_ID,
        kind: "model",
        name: "锁定布景",
        sourceUrl: TEST_ASSETS.helmet,
        transform: ORIGIN_TRANSFORM,
        locked: true,
    });
    await waitCatalogEntry(stores, HUMANOID_ASSET_ID);
    dispatchOk(stores, "assets.place", {
        assetId: HUMANOID_ASSET_ID,
        id: ACTOR_ID,
        transform: { ...ORIGIN_TRANSFORM, position: [ACTOR_OFFSET_METERS, 0, 0] },
    });

    // 两者都要真正成像,走查才有得点:运行时就绪 = 画布上可见
    await waitRuntime(stores, SET_DRESSING_ID);
    await waitRuntime(stores, ACTOR_ID);

    const setDressing = required(stores.scene.manager.getEntity(SET_DRESSING_ID), "布景实体未落账");
    const actor = required(stores.scene.manager.getEntity(ACTOR_ID), "人偶实体未落账");
    assertAcceptance(setDressing.locked, "布景未随 object.place 落锁(locked:true 未生效)");
    assertAcceptance(!actor.locked, "人偶不应被锁定");
}

/** 锁定布景 + 未锁人偶:走查交互锁的围栏边界(视口/大纲点选被挡,命令层不受限) */
export const LockedSetDressing: StoryObj = {
    name: "锁定布景与未锁人偶",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => void seedLockedSetDressing(stores)} />
            <AcceptancePanel task="场景 · 锁定布景(交互锁围栏)" items={CHECKLIST} />
        </div>
    ),
};
