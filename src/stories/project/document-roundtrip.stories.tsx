import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk } from "@/stories/harness";
import { placeModel, seedShots, TEST_ASSETS } from "@/stories/seeds";

const meta: Meta<typeof DirectorDesk> = { title: "工程/文档导入导出", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const FOX_ID = "doc-fox";
const DURATION_SECONDS = 12;
const SHOT_COUNT = 3;

const CHECKLIST = [
    "项目菜单「导出工程」下载 JSON;「导入工程…」选该文件 → 对象/机位/运镜/时长全还原",
    "同文档二次导入幂等,不产生重复对象",
    "手工把 JSON 的 version 改成未知值 → 导入被结构化拒绝(零兼容纪律:旧格式直接判不支持)",
    "播种已断言:导出 → 清空 → 导入后场景快照逐字节一致,机位/Program/时长还原",
] as const;

async function seedDocumentRoundtrip(stores: DirectorDeskStores): Promise<void> {
    // 异构状态:两模型 + 两机位 + 一段 Program 运镜 + 改时长
    placeModel(stores, TEST_ASSETS.fox, { id: FOX_ID });
    placeModel(stores, TEST_ASSETS.helmet, { position: [2, 0, 0] });
    seedShots(stores);
    dispatchOk(stores, "timeline.set-duration", { duration: DURATION_SECONDS });
    dispatchOk(stores, "motion.quick-author", {
        subjectId: FOX_ID,
        shotSize: "medium",
        move: "orbit",
        durationSeconds: 3,
        degrees: 360,
        direction: "ccw",
    });

    const exported = stores.dispatcher.query({ type: "desk.export-document", payload: {} }, stores);
    assertAcceptance(exported.ok, "导出工程失败");
    // JSON 往返一次:可序列化纪律的直接验证(阶段四地基)
    const snapshot: unknown = JSON.parse(JSON.stringify(exported.value));
    const describeBefore = stores.dispatcher.query({ type: "scene.describe", payload: {} }, stores);
    assertAcceptance(describeBefore.ok, "导出前 scene.describe 失败");

    // 清空(与项目菜单同路径)→ 导入还原
    for (const entity of stores.scene.manager.list()) {
        dispatchOk(stores, "object.remove", { id: entity.id });
    }
    assertAcceptance(stores.scene.objectCount === 0, "清空场景失败");
    dispatchOk(stores, "desk.import-document", { document: snapshot });

    const describeAfter = stores.dispatcher.query({ type: "scene.describe", payload: {} }, stores);
    assertAcceptance(describeAfter.ok, "导入后 scene.describe 失败");
    assertAcceptance(
        JSON.stringify(describeAfter.value) === JSON.stringify(describeBefore.value),
        "往返后场景快照不一致",
    );
    assertAcceptance(stores.camera.director.listShots().length === SHOT_COUNT, "机位未随文档还原");
    assertAcceptance(stores.timeline.document.duration === DURATION_SECONDS, "时间轴时长未还原");
    assertAcceptance(stores.motion.program.clips.length === 1, "Program 输出未还原");
}

/** 导出 → 清空 → 导入的逐字节还原断言;菜单路径留给人工走查 */
export const DocumentRoundtrip: Story = {
    name: "导出/导入往返",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={(stores) => void seedDocumentRoundtrip(stores)} />
            <AcceptancePanel task="工程 · 文档导入导出" items={CHECKLIST} />
        </div>
    ),
};
