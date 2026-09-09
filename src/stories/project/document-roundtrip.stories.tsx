import type { Meta, StoryObj } from "@storybook/react-vite";

import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import { COMMAND_ERROR } from "@/command/CommandDispatcher";
import { provisionAction } from "@/command/actionProvisioning";
import { ProgramReviewQuery } from "@/command/reviewCommands";
import type { DeskDocument } from "@/document/DeskDocument";
import { DESK_DOCUMENT_VERSION } from "@/document/DeskDocument";
import { DOCUMENT_COMPATIBILITY_ISSUE_CODE } from "@/document/compatibility/DeskDocumentMigration";
import { PROGRAM_REVIEW_ISSUE_KIND } from "@/review/ProgramReviewService";
import type { ProgramReviewReport } from "@/review/ProgramReviewService";
import { LIGHTING_MODE } from "@/store/SceneStore";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { TimelineViewport } from "@/authoring/TimelineViewport";
import { assertAcceptance, dispatchOk, required, waitActionMounted, waitRuntime } from "@/stories/harness";
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
/** 第二段排期与首段的间隔:留一帧以上,避开首尾相接的边界语义。 */
const SECOND_SEGMENT_GAP_SECONDS = 0.5;
const SECOND_SEGMENT_DURATION_SECONDS = 1.5;
const SEGMENT_RETIME_DELTA_SECONDS = 0.5;
/** FOX 两段(走→停→走)+ PARTNER 一段。 */
const EXPECTED_MOUNT_COUNT = 3;
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
    "手工把 JSON 的 version 改成未知值 → 导入被结构化拒绝(未发布,迁移注册表为空:旧格式一律判不支持)",
    "拒绝路径不清空、不改动当前场景;失败只回结构化 issue",
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
    // 同一实体的第二段排期:多段序列必须逐段落账、逐段成条、逐段持久化
    const firstSegment = required(stores.scene.manager.getEntity(FOX_ID)?.actionPerformances[0], "首段动作排期未落账");
    dispatchOk(stores, "action.mount", {
        objectId: FOX_ID,
        actionId: action.id,
        startTimeSeconds: firstSegment.releaseEndTimeSeconds + SECOND_SEGMENT_GAP_SECONDS,
        durationSeconds: SECOND_SEGMENT_DURATION_SECONDS,
    });
    assertMultiSegmentProjection(stores);
}

/**
 * 多段动作的时间轴可见性与段级编辑(本轮交付的核心回归)。
 *
 * 此前时间轴只投影首段、段条按实体寻址,于是:第二段起在 UI 上不可见,
 * 拖任一条都改首段,Delete 会把该实体全部动作一起卸掉。
 */
function assertMultiSegmentProjection(stores: DirectorDeskStores): void {
    const performances = stores.scene.manager.getEntity(FOX_ID)?.actionPerformances ?? [];
    assertAcceptance(performances.length === 2, `同实体应有两段排期,实际 ${performances.length}`);
    const rows = stores.timelineLayout.project(TimelineViewport.full(stores.timeline.document.duration));
    const actionRow = required(
        rows.find((row) => row.id === `action:${FOX_ID}`),
        "时间轴缺少该实体的动作行",
    );
    assertAcceptance(actionRow.bars.length === 2, `动作行应逐段成条(实际 ${actionRow.bars.length} 条)`);
    assertAcceptance(
        performances.every((performance) => actionRow.bars.some((bar) => bar.id === performance.id)),
        "段条 id 未对齐排期段 id",
    );
    assertAcceptance(
        actionRow.bars.every((bar) => bar.ownerId === FOX_ID),
        "段条未带出所属实体 id",
    );
    // action.mount 的段 id 是命令构造期生成的,不在原始 payload 里:
    // 撤销再重做这次挂载,重做必须复用同一个 id(replayPayload),否则段身份漂移
    const mountedIds = performances.map((entry) => entry.id);
    assertAcceptance(stores.history.undo(stores).ok, "撤销第二段挂载失败");
    assertAcceptance(stores.history.redo(stores).ok, "重做第二段挂载失败");
    const afterMountRedo = (stores.scene.manager.getEntity(FOX_ID)?.actionPerformances ?? []).map((e) => e.id);
    assertAcceptance(
        afterMountRedo.length === mountedIds.length && mountedIds.every((id) => afterMountRedo.includes(id)),
        `action.mount 重做后段 id 漂移(原 ${mountedIds.join(",")} → 现 ${afterMountRedo.join(",")})`,
    );
    // 段级重定时:只动被拖的那一段
    const target = required(performances[1], "缺少第二段排期");
    const untouched = required(performances[0], "缺少首段排期");
    const movedStart = target.startTimeSeconds + SEGMENT_RETIME_DELTA_SECONDS;
    dispatchOk(stores, "action.set-range", {
        objectId: FOX_ID,
        performanceId: target.id,
        startTimeSeconds: movedStart,
        durationSeconds: target.durationSeconds,
    });
    const afterRetime = stores.scene.manager.getEntity(FOX_ID)?.actionPerformances ?? [];
    assertAcceptance(
        afterRetime.find((entry) => entry.id === target.id)?.startTimeSeconds === movedStart,
        "段级重定时未作用于目标段",
    );
    assertAcceptance(
        afterRetime.find((entry) => entry.id === untouched.id)?.startTimeSeconds === untouched.startTimeSeconds,
        "段级重定时误改了邻段",
    );
    // 段级删除:其余段完好,且撤销按原段 id 复原
    dispatchOk(stores, "action.unmount-performance", { objectId: FOX_ID, performanceId: target.id });
    const afterDelete = stores.scene.manager.getEntity(FOX_ID)?.actionPerformances ?? [];
    assertAcceptance(afterDelete.length === 1 && afterDelete[0]?.id === untouched.id, "段级删除误伤了其余段");
    assertAcceptance(stores.history.undo(stores).ok, "段级删除撤销失败");
    const restored = stores.scene.manager.getEntity(FOX_ID)?.actionPerformances ?? [];
    assertAcceptance(
        restored.length === 2 && restored.some((entry) => entry.id === target.id),
        "段级删除撤销未按原段 id 复原",
    );
    // undo → redo 必须保住同一段 id:redo 回放的是原始 payload,若命令构造期重新生成 id,
    // 重做出来的段会换身份,选中态与 AI 手上的 performanceId 当场指空
    assertAcceptance(stores.history.redo(stores).ok, "段级删除重做失败");
    assertAcceptance(
        (stores.scene.manager.getEntity(FOX_ID)?.actionPerformances ?? []).every((entry) => entry.id !== target.id),
        "段级删除重做未再次删掉该段",
    );
    assertAcceptance(stores.history.undo(stores).ok, "段级删除二次撤销失败");
    const reRestored = stores.scene.manager.getEntity(FOX_ID)?.actionPerformances ?? [];
    assertAcceptance(
        reRestored.length === 2 && reRestored.some((entry) => entry.id === target.id),
        "undo→redo→undo 后段 id 漂移(重放未复用原 id)",
    );
    // 复位到重定时前,后续导出对账不受本段验收影响
    dispatchOk(stores, "action.set-range", {
        objectId: FOX_ID,
        performanceId: target.id,
        startTimeSeconds: target.startTimeSeconds,
        durationSeconds: target.durationSeconds,
    });
}

/** 导出即断言文档内容:多挂载与灯光模式必须在文档里 */
function exportDocument(stores: DirectorDeskStores): DeskDocument {
    const exported = stores.dispatcher.query({ type: "desk.export-document", payload: {} }, stores);
    assertAcceptance(exported.ok, "导出工程失败");
    // JSON 往返一次:可序列化纪律的直接验证(阶段四地基)
    const document = JSON.parse(JSON.stringify(exported.value)) as DeskDocument;
    const action = document.actions.find((entry) => entry.name === ACTION_NAME);
    const mountedObjectIds = action?.mountedOn.map((mount) => mount.objectId) ?? [];
    // 三条挂载:FOX 两段(走→停→走)+ PARTNER 一段;逐段导出而非按实体只导首段
    const foxMounts = action?.mountedOn.filter((mount) => mount.objectId === FOX_ID) ?? [];
    assertAcceptance(
        action?.loopMode === ACTION_LOOP_MODE.LOOP &&
            action.mountedOn.length === EXPECTED_MOUNT_COUNT &&
            mountedObjectIds.includes(FOX_ID) &&
            mountedObjectIds.includes(FOX_PARTNER_ID) &&
            action.mountedOn.every((mount) => mount.startTimeSeconds >= 0 && mount.durationSeconds > 0),
        `导出的动作挂载未覆盖全部实体或缺少排期(实际 ${action?.mountedOn.length ?? 0} 条)`,
    );
    assertAcceptance(foxMounts.length === 2, `同实体的两段排期未逐段导出(实际 ${foxMounts.length} 条)`);
    assertAcceptance(
        new Set(action?.mountedOn.map((mount) => mount.id)).size === (action?.mountedOn.length ?? 0),
        "导出的挂载缺少唯一段 id",
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

/** 兼容层拒绝路径:注册表为空(未发布),因此一切非当前版本都被结构化拒绝,且当前场景不受影响。 */
function assertStructuredRejections(stores: DirectorDeskStores): void {
    const sceneBefore = sceneFingerprint(stores);
    const futureVersion = stores.dispatcher.dispatch(
        { type: "desk.import-document", payload: { document: { version: DESK_DOCUMENT_VERSION + 1 } } },
        stores,
    );
    assertAcceptance(
        !futureVersion.ok &&
            futureVersion.issueDetails?.some(
                (issue) => issue.code === DOCUMENT_COMPATIBILITY_ISSUE_CODE.VERSION_TOO_NEW,
            ) === true,
        "更高版本文档未被结构化拒绝",
    );
    const legacyVersion = stores.dispatcher.dispatch(
        { type: "desk.import-document", payload: { document: { version: DESK_DOCUMENT_VERSION - 1 } } },
        stores,
    );
    assertAcceptance(
        !legacyVersion.ok &&
            legacyVersion.issueDetails?.some(
                (issue) => issue.code === DOCUMENT_COMPATIBILITY_ISSUE_CODE.VERSION_TOO_OLD,
            ) === true,
        "发布前的旧版本文档未被结构化拒绝(零兼容纪律)",
    );
    const brokenEnvelope = stores.dispatcher.dispatch(
        { type: "desk.import-document", payload: { document: { entities: [] } } },
        stores,
    );
    assertAcceptance(
        !brokenEnvelope.ok &&
            brokenEnvelope.issueDetails?.some(
                (issue) => issue.code === DOCUMENT_COMPATIBILITY_ISSUE_CODE.INVALID_ENVELOPE,
            ) === true,
        "缺少 version 的文档未被结构化拒绝",
    );
    assertAcceptance(sceneFingerprint(stores) === sceneBefore, "拒绝路径污染了当前场景");
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
    stores.ui.setApplicationNotice("SEED-OK 文档往返验收全部通过");
}

/** 导出 → 清空 → 导入的逐字节还原断言;菜单路径留给人工走查 */
export const DocumentRoundtrip: Story = {
    name: "导出/导入往返",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                onReady={(stores) => {
                    // 裸 void 会把断言失败的 rejection 丢掉:走查看到的是「一切正常」,
                    // 实际播种早已中断——失败必须落到通知上
                    void seedDocumentRoundtrip(stores).catch((error: unknown) => {
                        stores.ui.setApplicationNotice(error instanceof Error ? error.message : String(error));
                    });
                }}
            />
            <AcceptancePanel task="工程 · 文档导入导出" items={CHECKLIST} />
        </div>
    ),
};
