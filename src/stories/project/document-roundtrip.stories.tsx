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
import { EXPOSURE, GRID_SIZE, RENDER_QUALITY } from "@/studio/StudioEnvironment";
import type { StudioEnvironmentJSON } from "@/studio/StudioEnvironment";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { TimelineViewport } from "@/authoring/TimelineViewport";
import {
    assertAcceptance,
    dispatchCatching,
    dispatchOk,
    required,
    waitActionMounted,
    waitRuntime,
} from "@/stories/harness";
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
const LENS_SHOT_ID = "shot-镜头参数";
/** 全部改离默认值:任一项漏出文档,往返断言即挂。 */
const LENS_SETTINGS = { focalLengthMm: 85, apertureFStop: 1.8, focusDistanceMeters: 3.5 } as const;
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
/** 播种把演播室档位全部改离默认值:任一档漏出文档,往返断言即挂。 */
const STUDIO_SETTINGS: StudioEnvironmentJSON = {
    gridSizeMeters: 36,
    renderQuality: RENDER_QUALITY.HIGH,
    frameRateVisible: true,
    outputGridVisible: false,
    exposure: 1.6,
    environmentLightingEnabled: true,
    shadowsEnabled: true,
    floorColor: "#3b2f2a",
    floorSurfaceEnabled: true,
};

const CHECKLIST = [
    "项目菜单「导出工程」下载 JSON;「导入工程…」选该文件 → 对象/机位/运镜/时长全还原",
    "同文档二次导入幂等,不产生重复对象",
    "手工把 JSON 的 version 改成未知值 → 导入被结构化拒绝(未发布,迁移注册表为空:旧格式一律判不支持)",
    "拒绝路径不清空、不改动当前场景;失败只回结构化 issue",
    "播种已断言:导出 → 清空 → 导入后场景快照逐字节一致,机位/Program/时长还原",
    "项目菜单「清空场景」一次清净:被运镜注视/跟拍引用的对象也一并清掉,不留清不掉的残留",
    "清空场景只占一步撤销:Ctrl+Z 一次装回全部实体、走位轨、运镜与 Program 排期",
    "同一动作挂在多个实体上,导入后全部恢复挂载且共享同一动作实例",
    "自定义灯光模式与灯光实体随文档还原,不回退演播室",
    "项目菜单改「地板尺寸」「渲染画质」「显示帧率」与画幅面板「显示九宫格」→ 导出的 JSON 带 studio 档位",
    "导入该 JSON 后四项档位全部还原(地板实时重建、画质档生效、帧率读数与九宫格按档显示)",
    "撤销可回退每一项档位改动(拖一次滑杆只产生一步)",
    "旧命令的校验失败也必须带稳定 issueDetails，供宿主与 AI 处理",
] as const;

/** 异构场景:同骨架双模型 + 无骨骼模型 + 两机位 + Program 运镜 + 自定义灯光 + 共享动作 */
async function seedScene(stores: DirectorDeskStores): Promise<void> {
    placeModel(stores, TEST_ASSETS.fox, { id: FOX_ID });
    placeModel(stores, TEST_ASSETS.fox, { id: FOX_PARTNER_ID, position: [-2, 0, 0] });
    placeModel(stores, TEST_ASSETS.helmet, { position: [2, 0, 0] });
    seedShots(stores);
    // 第三个机位专用于镜头参数往返:经 camera.set-lens 落账,验证焦距换算与光学参数持久化
    dispatchOk(stores, "camera.set-shot", {
        id: LENS_SHOT_ID,
        shot: { position: [2, 1.5, 5], target: [0, 1, 0], fov: 45 },
    });
    dispatchOk(stores, "camera.set-lens", {
        id: LENS_SHOT_ID,
        focalLengthMm: LENS_SETTINGS.focalLengthMm,
        apertureFStop: LENS_SETTINGS.apertureFStop,
        focusDistanceMeters: LENS_SETTINGS.focusDistanceMeters,
    });
    // 焦距写入即换算成 fov:两者不可能同时是真相源
    const lensShotAfterSet = required(stores.camera.director.getShot(LENS_SHOT_ID), "镜头机位未落账");
    assertAcceptance(
        Math.abs(lensShotAfterSet.fov - 45) > 1,
        `set-lens 的焦距未换算进 fov(仍为 ${lensShotAfterSet.fov})`,
    );
    assertAcceptance(
        !dispatchCatching(stores, "camera.set-lens", { id: LENS_SHOT_ID, apertureFStop: 999 }).ok,
        "超界光圈未被命令层拒绝",
    );
    // 几何写入不得擦镜头:摆位手势/坐标输入都只带 position/target/fov,
    // 若 set-shot 按构造缺省兑现 lens,作者动一下机位就静默丢掉刚设好的光圈与对焦
    dispatchOk(stores, "camera.set-shot", {
        id: LENS_SHOT_ID,
        shot: { position: [2.5, 1.6, 5.2], target: [0, 1, 0], fov: lensShotAfterSet.fov },
    });
    const lensShotAfterMove = required(stores.camera.director.getShot(LENS_SHOT_ID), "机位在几何写入后丢失");
    assertAcceptance(
        lensShotAfterMove.lens.apertureFStop === LENS_SETTINGS.apertureFStop &&
            lensShotAfterMove.lens.focusDistanceMeters === LENS_SETTINGS.focusDistanceMeters,
        `不带 lens 的 camera.set-shot 擦掉了镜头参数(${JSON.stringify(lensShotAfterMove.lens.toJSON())})`,
    );
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
    seedStudioEnvironment(stores);
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
 * 演播室档位的命令路径与撤销:四档全部改离默认值,并逐条验证可求逆。
 * 它们决定成片质量与构图判断,因此必须像场景数据一样进撤销栈、进文档。
 */
function seedStudioEnvironment(stores: DirectorDeskStores): void {
    dispatchOk(stores, "studio.set-grid-size", { meters: STUDIO_SETTINGS.gridSizeMeters });
    assertAcceptance(stores.studio.gridSizeMeters === STUDIO_SETTINGS.gridSizeMeters, "地板尺寸命令未落账");
    assertAcceptance(stores.history.undo(stores).ok, "地板尺寸撤销失败");
    assertAcceptance(stores.studio.gridSizeMeters === GRID_SIZE.DEFAULT_METERS, "地板尺寸撤销未回默认值");
    assertAcceptance(stores.history.redo(stores).ok, "地板尺寸重做失败");
    assertAcceptance(stores.studio.gridSizeMeters === STUDIO_SETTINGS.gridSizeMeters, "地板尺寸重做未复原");
    // 越界值必须被命令层围栏拒绝,而不是静默钳位后写进文档
    const outOfRange = dispatchCatching(stores, "studio.set-grid-size", { meters: GRID_SIZE.MAX_METERS + 1 });
    assertAcceptance(!outOfRange.ok, "超界地板尺寸未被命令层拒绝");
    dispatchOk(stores, "studio.set-render-quality", { quality: STUDIO_SETTINGS.renderQuality });
    dispatchOk(stores, "studio.set-frame-rate-visible", { visible: STUDIO_SETTINGS.frameRateVisible });
    dispatchOk(stores, "studio.set-output-grid-visible", { visible: STUDIO_SETTINGS.outputGridVisible });
    // 成像三项:曝光进撤销栈并有围栏,两个开关随文档往返
    dispatchOk(stores, "studio.set-exposure", { exposure: STUDIO_SETTINGS.exposure });
    assertAcceptance(stores.studio.exposure === STUDIO_SETTINGS.exposure, "曝光命令未落账");
    assertAcceptance(stores.history.undo(stores).ok, "曝光撤销失败");
    assertAcceptance(stores.studio.exposure === EXPOSURE.DEFAULT, "曝光撤销未回默认值");
    assertAcceptance(stores.history.redo(stores).ok, "曝光重做失败");
    assertAcceptance(stores.studio.exposure === STUDIO_SETTINGS.exposure, "曝光重做未复原");
    const exposureOutOfRange = dispatchCatching(stores, "studio.set-exposure", { exposure: EXPOSURE.MAX + 1 });
    assertAcceptance(!exposureOutOfRange.ok, "超界曝光未被命令层拒绝");
    dispatchOk(stores, "studio.set-environment-lighting", { enabled: STUDIO_SETTINGS.environmentLightingEnabled });
    dispatchOk(stores, "studio.set-shadows", { enabled: STUDIO_SETTINGS.shadowsEnabled });
    dispatchOk(stores, "studio.set-floor-color", { color: STUDIO_SETTINGS.floorColor });
    dispatchOk(stores, "studio.set-floor-surface", { enabled: STUDIO_SETTINGS.floorSurfaceEnabled });
    // 非法颜色必须被围栏拒绝,而不是静默落一个无效值进文档
    assertAcceptance(
        !dispatchCatching(stores, "studio.set-floor-color", { color: "red" }).ok,
        "非法地板颜色未被命令层拒绝",
    );
    assertStudioEnvironment(stores, "命令写入后");
    const read = stores.dispatcher.query({ type: "studio.get", payload: {} }, stores);
    assertAcceptance(read.ok, "studio.get 查询失败");
    assertAcceptance(
        (read.value as { readonly gridSizeMeters: number }).gridSizeMeters === STUDIO_SETTINGS.gridSizeMeters,
        "studio.get 读数与聚合不一致",
    );
}

function assertStudioEnvironment(stores: DirectorDeskStores, stage: string): void {
    const studio = stores.studio;
    assertAcceptance(studio.gridSizeMeters === STUDIO_SETTINGS.gridSizeMeters, `${stage}地板尺寸不符`);
    assertAcceptance(studio.renderQuality === STUDIO_SETTINGS.renderQuality, `${stage}渲染画质档不符`);
    assertAcceptance(studio.frameRateVisible === STUDIO_SETTINGS.frameRateVisible, `${stage}帧率读数显隐不符`);
    assertAcceptance(studio.outputGridVisible === STUDIO_SETTINGS.outputGridVisible, `${stage}九宫格显隐不符`);
    assertAcceptance(studio.exposure === STUDIO_SETTINGS.exposure, `${stage}曝光不符`);
    assertAcceptance(
        studio.environmentLightingEnabled === STUDIO_SETTINGS.environmentLightingEnabled,
        `${stage}环境光照开关不符`,
    );
    assertAcceptance(studio.shadowsEnabled === STUDIO_SETTINGS.shadowsEnabled, `${stage}投影开关不符`);
    assertAcceptance(studio.floorColor === STUDIO_SETTINGS.floorColor, `${stage}地板颜色不符`);
    assertAcceptance(studio.floorSurfaceEnabled === STUDIO_SETTINGS.floorSurfaceEnabled, `${stage}实心地面开关不符`);
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
    assertAcceptance(
        document.studio.gridSizeMeters === STUDIO_SETTINGS.gridSizeMeters &&
            document.studio.renderQuality === STUDIO_SETTINGS.renderQuality &&
            document.studio.frameRateVisible === STUDIO_SETTINGS.frameRateVisible &&
            document.studio.outputGridVisible === STUDIO_SETTINGS.outputGridVisible,
        `导出的文档缺少或错记演播室档位(${JSON.stringify(document.studio)})`,
    );
    return document;
}

/** 场景指纹:动作 id 是运行时注册产物,往返必然换发;挂载事实以布尔参与逐字节对账 */
function sceneFingerprint(stores: DirectorDeskStores): string {
    const describe = stores.dispatcher.query({ type: "scene.describe", payload: {} }, stores);
    assertAcceptance(describe.ok, "scene.describe 失败");
    const entities = describe.value as readonly { mountedActionId: string | null }[];
    return JSON.stringify(entities.map((entity) => ({ ...entity, mountedActionId: entity.mountedActionId !== null })));
}

/** 撤销对账口径:实体身份集合,顺序无关(SceneManager 的迭代序不是契约)。 */
function sortedEntityIds(stores: DirectorDeskStores): string {
    return stores.scene.manager
        .list()
        .map((entity) => entity.id)
        .sort()
        .join(",");
}

async function reimportAndAssert(stores: DirectorDeskStores, document: DeskDocument): Promise<void> {
    const before = sceneFingerprint(stores);
    // 撤销对账用实体 id 集合而非 sceneFingerprint:动作挂载不在实体快照里(重取资产是异步的),
    // 撤销的承诺是「场景数据回来」,不含动作运行时重挂。
    const idsBefore = sortedEntityIds(stores);
    // 清空(与项目菜单同路径):一条聚合命令,被运镜引用的实体也必须一次清净
    dispatchOk(stores, "scene.clear", {});
    assertAcceptance(stores.scene.objectCount === 0, "清空场景失败");
    assertAcceptance(stores.motion.clips.length === 0, "清空场景残留了引用已删实体的运镜片段");
    // 一步撤销必须整场回来(实体 + 走位轨 + 运镜 + Program),再清一次继续往返验收
    assertAcceptance(stores.history.undo(stores).ok, "清空场景撤销失败");
    const idsAfterUndo = sortedEntityIds(stores);
    assertAcceptance(idsAfterUndo === idsBefore, `清空场景撤销未装回全部实体(${idsAfterUndo})`);
    assertAcceptance(stores.motion.clips.length > 0, "清空场景撤销未装回运镜片段");
    assertAcceptance(stores.motion.program.clips.length > 0, "清空场景撤销未装回 Program 排期");
    dispatchOk(stores, "scene.clear", {});
    // 空场景上再清即结构化拒绝,而不是静默成功
    assertAcceptance(!dispatchCatching(stores, "scene.clear", {}).ok, "空场景重复清空未被结构化拒绝");
    // 档位先全部改回默认:导入必须整档覆盖,不能靠「本来就是那个值」蒙对
    dispatchOk(stores, "studio.set-grid-size", { meters: GRID_SIZE.DEFAULT_METERS });
    dispatchOk(stores, "studio.set-render-quality", { quality: RENDER_QUALITY.PERFORMANCE });
    dispatchOk(stores, "studio.set-frame-rate-visible", { visible: false });
    dispatchOk(stores, "studio.set-output-grid-visible", { visible: true });
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
    // 镜头参数随机位往返:焦距不入档(是 fov 派生视图),光圈与对焦距离必须还原
    const lensShot = stores.camera.director.getShot(LENS_SHOT_ID);
    assertAcceptance(
        lensShot?.lens.apertureFStop === LENS_SETTINGS.apertureFStop &&
            lensShot?.lens.focusDistanceMeters === LENS_SETTINGS.focusDistanceMeters,
        `镜头参数未随文档还原(${JSON.stringify(lensShot?.lens.toJSON())})`,
    );
    assertAcceptance(stores.timeline.document.duration === DURATION_SECONDS, "时间轴时长未还原");
    assertAcceptance(stores.motion.program.clips.length === 1, "Program 输出未还原");
    assertStudioEnvironment(stores, "导入还原后");
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
