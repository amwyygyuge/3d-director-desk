import type { Meta, StoryObj } from "@storybook/react-vite";

import { HostBridgeConfiguration, HostBridgeSession } from "@/bridge/HostBridge";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk, waitRuntime } from "@/stories/harness";
import { placeModel, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta = { title: "场景/模型导入" };
export default meta;

const STORY_SESSION_ID = "model-import-story";
const HELMET_ID = "import-helmet";
const OBJ_ID = "import-obj";
const CHECKLIST = [
    "预置 GLB/FBX/OBJ 各一:加载完成正常显示(归一化到约 2 单位高)",
    "工具条「导入模型」选本地文件;同一文件再导一次 → 底部提示去重",
    "选中模型按 Delete 删除;加载中显示线框占位",
    `控制台模拟可信宿主:window.postMessage({type:'director-desk:import-model',sessionId:'${STORY_SESSION_ID}',payload:{url:'/test-assets/fox.glb',name:'fox'}},window.location.origin)`,
    "Chrome 内存面板:删除后回落(dispose 纪律)",
    "相对摆位(AI 语义入口):播种已把 OBJ 挪到头盔左侧并断言生效;自身摆位被拒绝",
] as const;

async function seedModelImport(stores: DirectorDeskStores): Promise<void> {
    placeModel(stores, TEST_ASSETS.helmet, { id: HELMET_ID });
    placeModel(stores, TEST_ASSETS.sambaFbx);
    placeModel(stores, TEST_ASSETS.maleObj, { id: OBJ_ID });
    await waitRuntime(stores, HELMET_ID);
    await waitRuntime(stores, OBJ_ID);

    // 相对摆位(object.place-relative):以头盔为锚点把 OBJ 放到其左侧;位置必须变化
    const before = stores.scene.manager.getEntity(OBJ_ID)?.transform.position;
    dispatchOk(stores, "object.place-relative", { id: OBJ_ID, anchorId: HELMET_ID, relation: "left-of" });
    const after = stores.scene.manager.getEntity(OBJ_ID)?.transform.position;
    assertAcceptance(before?.join(",") !== after?.join(","), "相对摆位未改变对象位置");

    // 负例:对象不能相对自身摆位 → 结构化拒绝
    const selfRelative = stores.dispatcher.dispatch(
        { type: "object.place-relative", payload: { id: OBJ_ID, anchorId: OBJ_ID, relation: "left-of" } },
        stores,
    );
    assertAcceptance(!selfRelative.ok, "相对自身摆位未被拒绝");
}

/** 预置三种格式模型各一 + 相对摆位断言 */
export const ThreeFormats: StoryObj = {
    name: "三种格式与相对摆位",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                hostBridge={
                    new HostBridgeConfiguration(window, window.location.origin, new HostBridgeSession(STORY_SESSION_ID))
                }
                onReady={(stores) => void seedModelImport(stores)}
            />
            <AcceptancePanel task="场景 · 模型导入(GLB/FBX/OBJ + 相对摆位)" items={CHECKLIST} />
        </div>
    ),
};
