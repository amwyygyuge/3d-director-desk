import type { Meta, StoryObj } from "@storybook/react-vite";

import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import { COMMAND_ERROR } from "@/command/CommandDispatcher";
import { provisionAction } from "@/command/actionProvisioning";
import { ProgramReviewQuery } from "@/command/reviewCommands";
import type { DeskDocument } from "@/document/DeskDocument";
import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
import { DOCUMENT_IMPORT_ISSUE_CODE } from "@/document/DocumentImportService";
import { PROGRAM_REVIEW_ISSUE_KIND } from "@/review/ProgramReviewService";
import type { ProgramReviewReport } from "@/review/ProgramReviewService";
import { LIGHTING_MODE } from "@/store/SceneStore";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk, waitActionMounted, waitRuntime } from "@/stories/harness";
import { TEST_ASSETS, placeModel, seedShots } from "../seeds";

const meta: Meta<typeof DirectorDesk> = { title: "工程/文档导入导出", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

const FOX_ID = "doc-fox";
const FOX_PARTNER_ID = "doc-fox-2";
const LIGHT_ID = "doc-light";
const ACTION_NAME = "狐狸#Survey";
const FOX_CLIP_NAME = "Survey";
const DURATION_SECONDS = 12;
const SHOT_COUNT = 3;
const MISSING_SHOT_ID = "missing-shot";
const LIGHT_PARAMS = {
    type: "spot",
    color: "#ffd9a0",
    intensity: 60,
    distance: 30,
    decay: 1.6,
    angleDegrees: 42,
    penumbra: 0.45,
} as const;

const CHECKLIST = [
    "项目菜单「导出工程」下载 JSON;「导入工程…」选该文件 → 对象/机位/运镜/时长全还原",
    "同文档二次导入幂等,不产生重复对象",
    "手工把 JSON 的 version 改成未知值 → 导入被结构化拒绝(零兼容纪律:旧格式直接判不支持)",
    "播种已断言:导出 → 清空 → 导入后场景快照逐字节一致,机位/Program/时长还原",
    "同一动作挂在多个实体上,导入后全部恢复挂载且共享同一动作实例",
    "自定义灯光模式与灯光实体随文档还原,不回退演播室",
    "旧命令的校验失败也必须带稳定 issueDetails，供宿主与 AI 处理",
] as const;

/** 异构场景:同骨架双模型 + 无骨骼模型 + 两机位 + Program 运镜 + 自定义灯光 + 共享动作 */
async function seedScene(stores: DirectorDeskStores): Promise<void> {
    placeModel(stores, TEST_ASSETS.fox, { id: FOX_ID });
    placeModel(stores, TEST_ASSETS.fox, { id: FOX_PARTNER_ID, position: [-2, 0, 0] });
    placeModel(stores, TEST_ASSETS.helmet, { position: [2, 0, 0] });
    seedShots(stores);
    dispatchOk(stores, "timeline.set-duration", { duration: DURATION_SECONDS });
    dispatchOk(stores, "motion.quick-author", {
        subjectId: FOX_ID,
        shotSize: "medium",
        move: "orbit",
        durationSeconds: 3,
        orbit: { degrees: 360, direction: "ccw" },
    });
    dispatchOk(stores, "scene.set-lighting-mode", { mode: LIGHTING_MODE.CUSTOM });
    dispatchOk(stores, "object.place", {
        id: LIGHT_ID,
        kind: "light",
        transform: { position: [3, 5, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        light: LIGHT_PARAMS,
    });
    await waitRuntime(stores, FOX_ID);
    await waitRuntime(stores, FOX_PARTNER_ID);
    // 同一动作挂两个实体:回归「导出只记录首个挂载实体」的缺口
    const action = await provisionAction(stores, {
        name: ACTION_NAME,
        url: TEST_ASSETS.fox,
        clipName: FOX_CLIP_NAME,
        loopMode: ACTION_LOOP_MODE.LOOP,
    });
    dispatchOk(stores, "action.mount", { objectId: FOX_ID, actionId: action.id });
    dispatchOk(stores, "action.mount", { objectId: FOX_PARTNER_ID, actionId: action.id });
}

/** 导出即断言文档内容:多挂载与灯光模式必须在文档里 */
function exportDocument(stores: DirectorDeskStores): DeskDocument {
    const exported = stores.dispatcher.query({ type: "desk.export-document", payload: {} }, stores);
    assertAcceptance(exported.ok, "导出工程失败");
    // JSON 往返一次:可序列化纪律的直接验证(阶段四地基)
    const document = JSON.parse(JSON.stringify(exported.value)) as DeskDocument;
    const action = document.actions.find((entry) => entry.name === ACTION_NAME);
    const mountedObjectIds = action?.mountedOn.map((mount) => mount.objectId) ?? [];
    assertAcceptance(
        action?.loopMode === ACTION_LOOP_MODE.LOOP &&
            action.mountedOn.length === 2 &&
            mountedObjectIds.includes(FOX_ID) &&
            mountedObjectIds.includes(FOX_PARTNER_ID) &&
            action.mountedOn.every((mount) => mount.startTimeSeconds >= 0 && mount.durationSeconds > 0),
        "导出的动作挂载未覆盖全部实体或缺少排期",
    );
    assertAcceptance(document.lighting.mode === LIGHTING_MODE.CUSTOM, "导出的文档缺少灯光模式");
    return document;
}

/** 场景指纹:动作 id 是运行时注册产物,往返必然换发;挂载事实以布尔参与逐字节对账 */
function sceneFingerprint(stores: DirectorDeskStores): string {
    const describe = stores.dispatcher.query({ type: "scene.describe", payload: {} }, stores);
    assertAcceptance(describe.ok, "scene.describe 失败");
    const entities = describe.value as readonly { mountedActionId: string | null }[];
    return JSON.stringify(entities.map((entity) => ({ ...entity, mountedActionId: entity.mountedActionId !== null })));
}

async function reimportAndAssert(stores: DirectorDeskStores, document: DeskDocument): Promise<void> {
    const before = sceneFingerprint(stores);
    // 清空(与项目菜单同路径)→ 导入还原
    for (const entity of stores.scene.manager.list()) {
        dispatchOk(stores, "object.remove", { id: entity.id });
    }
    assertAcceptance(stores.scene.objectCount === 0, "清空场景失败");
    dispatchOk(stores, "desk.import-document", { document });
    // 动作恢复是异步的(重取资产 → 注册 → 运行时挂载);先等挂载落账再对账
    await waitActionMounted(stores, FOX_ID);
    await waitActionMounted(stores, FOX_PARTNER_ID);
    assertAcceptance(sceneFingerprint(stores) === before, "往返后场景快照不一致");
    const restoredActionId = stores.scene.manager.getEntity(FOX_ID)?.actionId;
    assertAcceptance(
        restoredActionId != null && restoredActionId === stores.scene.manager.getEntity(FOX_PARTNER_ID)?.actionId,
        "两实体未恢复为同一动作实例",
    );
    assertAcceptance(stores.scene.lightingMode === LIGHTING_MODE.CUSTOM, "灯光模式未随文档还原");
    assertAcceptance(stores.scene.manager.getEntity(LIGHT_ID)?.light?.type === "spot", "灯光实体未随文档还原");
    assertAcceptance(stores.camera.director.listShots().length === SHOT_COUNT, "机位未随文档还原");
    assertAcceptance(stores.timeline.document.duration === DURATION_SECONDS, "时间轴时长未还原");
    assertAcceptance(stores.motion.program.clips.length === 1, "Program 输出未还原");
}

function assertStructuredRejections(stores: DirectorDeskStores): void {
    const incompatibleVersion = stores.dispatcher.dispatch(
        { type: "desk.import-document", payload: { document: { version: DESK_DOCUMENT_VERSION + 1 } } },
        stores,
    );
    assertAcceptance(
        !incompatibleVersion.ok &&
            incompatibleVersion.issueDetails?.some(
                (issue) => issue.code === DOCUMENT_IMPORT_ISSUE_CODE.UNSUPPORTED_VERSION,
            ) === true,
        "未知文档版本未被结构化拒绝",
    );
    const missingShot = stores.dispatcher.dispatch(
        { type: "camera.activate", payload: { id: MISSING_SHOT_ID } },
        stores,
    );
    assertAcceptance(
        !missingShot.ok &&
            missingShot.issueDetails?.some((issue) => issue.code === COMMAND_ERROR.VALIDATION_FAILED) === true,
        "旧命令校验失败未收敛为结构化错误",
    );
    const review = stores.dispatcher.query({ type: ProgramReviewQuery.TYPE, payload: {} }, stores);
    assertAcceptance(review.ok, "成片巡检查询失败");
    const report = review.value as ProgramReviewReport;
    assertAcceptance(report.shots.length === 1, "镜头单缺少 Program 片段");
    assertAcceptance(
        report.issues.some((issue) => issue.kind === PROGRAM_REVIEW_ISSUE_KIND.GAP),
        "成片巡检未报告 Program 空档",
    );
}

async function seedDocumentRoundtrip(stores: DirectorDeskStores): Promise<void> {
    await seedScene(stores);
    const document = exportDocument(stores);
    await reimportAndAssert(stores, document);
    assertStructuredRejections(stores);
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
