import type { Meta, StoryObj } from "@storybook/react-vite";

import type { AssetEntry } from "@/assets/catalog/AssetEntry";
import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import { TimelineViewport } from "@/authoring/TimelineViewport";
import { TIMELINE_BAR_KIND } from "@/authoring/TimelineLayout";
import { waitMs } from "@/core/waitMs";
import type { DeskDocument } from "@/document/DeskDocument";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { AcceptancePanel } from "@/stories/AcceptancePanel";
import { assertAcceptance, dispatchOk, required, waitActionMounted, waitRuntime } from "@/stories/harness";

const HUMANOID_ASSET_ID = "builtin.humanoid-generic";
const ACTOR_ID = "catalog-action-actor";
const WAVE_ASSET_ID = "builtin.action.wave";
const THUMBS_UP_ASSET_ID = "builtin.action.thumbs-up";
const NOD_ASSET_ID = "builtin.action.nod-yes";
const CELEBRATE_ALT_ASSET_ID = "builtin.action.celebrate-alt";
const EXPECTED_ACTION_COUNT = 21;
const ONCE_ACTION_START_SECONDS = 1.2;
const ONCE_ACTION_DURATION_SECONDS = 2;
const RETIMED_ACTION_START_SECONDS = 2.4;
const RETIMED_ACTION_DURATION_SECONDS = 1.5;
const ONCE_ACTION_ACTIVE_SECONDS = 0.2;
const ONCE_ACTION_HOLD_SAMPLE_SECONDS = 0.5;
const BASE_POSE_PRESET_ID = "upper-stand-arms-down";
const BASE_POSE_BONE = "mixamorigRightArm";
const TIME_EPSILON_SECONDS = 1e-6;
const WAIT_ATTEMPT_LIMIT = 40;
const WAIT_INTERVAL_MS = 250;
const MAX_HIPS_FIRST_FRAME_DELTA_DEGREES = 10;
const POSE_HOLD_EPSILON = 1e-6;
/** humanoid-generic.glb 的 bind Hips 局部旋转;用于防止外部动作把根骨骼翻回源坐标系。 */
const TARGET_HIPS_REST_QUATERNION = [-0.70710678, 0, 0, 0.70710678] as const;

const CHECKLIST = [
    "资源目录含 21 个内置动作资产(点头/摇头已回归);人偶检查器「动作资产」区按骨架族列出",
    "先选常驻姿势「垂臂」,再依次挂「挥手/赞许/点头/庆祝·二」:动作与常驻姿势分层共存",
    "一次性动作带明确时间轴排期;结束后经回收段自动回垂臂,不会停在动作末帧",
    "播种已断言:目录发现、四次挂载、排期段条、常驻姿势恢复、预览播放/暂停、文档导出动作定位符",
] as const;

async function waitMountedActionName(
    stores: DirectorDeskStores,
    objectId: string,
    name: string,
    remainingAttempts = WAIT_ATTEMPT_LIMIT,
): Promise<void> {
    const actionId = stores.scene.manager.getEntity(objectId)?.actionId;
    const mounted = stores.animations.actions.find((action) => action.id === actionId);
    if (mounted?.name === name) return;
    if (remainingAttempts === 0) throw new Error(`验收断言失败: 动作 ${name} 超时未挂载`);
    await waitMs(WAIT_INTERVAL_MS);
    await waitMountedActionName(stores, objectId, name, remainingAttempts - 1);
}

async function waitCatalogEntry(
    stores: DirectorDeskStores,
    assetId: string,
    remainingAttempts = WAIT_ATTEMPT_LIMIT,
): Promise<void> {
    if (stores.catalog.get(assetId)) return;
    if (remainingAttempts === 0) throw new Error(`验收断言失败: 内置资源 ${assetId} 超时未加载`);
    await waitMs(WAIT_INTERVAL_MS);
    await waitCatalogEntry(stores, assetId, remainingAttempts - 1);
}

function assertUprightFirstFrame(stores: DirectorDeskStores, objectId: string): void {
    const actionId = stores.scene.manager.getEntity(objectId)?.actionId;
    const clip = actionId ? stores.animations.getClip(actionId) : undefined;
    const hipsTrack = clip?.tracks.find((track) => track.name === "mixamorigHips.quaternion");
    const baseline = TARGET_HIPS_REST_QUATERNION;
    assertAcceptance(clip !== undefined && hipsTrack !== undefined, "动作缺少 Hips 旋转轨道");
    assertAcceptance(
        clip.tracks.every((track) => !track.name.endsWith(".position") && !track.name.endsWith(".scale")),
        "动作资产仍包含位置/缩放轨道",
    );
    const firstDotBaseline = Math.abs(
        required(hipsTrack.values[0], "Hips 首帧缺少 x") * baseline[0] +
            required(hipsTrack.values[1], "Hips 首帧缺少 y") * baseline[1] +
            required(hipsTrack.values[2], "Hips 首帧缺少 z") * baseline[2] +
            required(hipsTrack.values[3], "Hips 首帧缺少 w") * baseline[3],
    );
    const deltaDegrees = (2 * Math.acos(Math.min(1, firstDotBaseline)) * 180) / Math.PI;
    assertAcceptance(deltaDegrees <= MAX_HIPS_FIRST_FRAME_DELTA_DEGREES, "动作首帧 Hips 朝向翻转");
}

function boneQuaternion(stores: DirectorDeskStores, objectId: string, boneName: string): readonly number[] {
    const runtime = required(stores.scene.manager.getRuntime(objectId), "动作验收缺少模型运行时");
    const bone = required(runtime.getObjectByName(boneName), `动作验收缺少骨骼 ${boneName}`);
    return bone.quaternion.toArray();
}

function headQuaternion(stores: DirectorDeskStores, objectId: string): readonly number[] {
    return boneQuaternion(stores, objectId, "mixamorigHead");
}

function quaternionEquals(left: readonly number[], right: readonly number[]): boolean {
    return left.every((value, index) => Math.abs(value - (right[index] ?? 0)) <= POSE_HOLD_EPSILON);
}

function sampleTimelinePose(stores: DirectorDeskStores, timeSeconds: number): readonly number[] {
    dispatchOk(stores, "transport.seek", { time: timeSeconds });
    stores.playback.sampleCurrent();
    return boneQuaternion(stores, ACTOR_ID, BASE_POSE_BONE);
}

function basePoseBone(stores: DirectorDeskStores): readonly number[] {
    const pose = required(stores.scene.manager.getEntity(ACTOR_ID)?.pose ?? undefined, "常驻姿势未写入实体");
    return required(pose.bones[BASE_POSE_BONE], "常驻姿势缺少右臂骨骼");
}

function assertLoopTimelinePlays(stores: DirectorDeskStores): void {
    assertAcceptance(stores.actionPreview.activeObjectId === null, "挂载动作后未播放的预览仍抢占时间轴");
    const before = sampleTimelinePose(stores, 0);
    const active = sampleTimelinePose(stores, 0.5);
    assertAcceptance(quaternionEquals(before, basePoseBone(stores)), "动作开始前未保持常驻姿势");
    assertAcceptance(!quaternionEquals(before, active), "循环动作未随时间轴播放");
}

function assertOnceTimelineSchedule(stores: DirectorDeskStores): void {
    assertAcceptance(stores.actionPreview.activeObjectId === null, "一次性动作挂载后预览仍抢占时间轴");
    const base = basePoseBone(stores);
    const before = sampleTimelinePose(stores, 0);
    const active = sampleTimelinePose(stores, ONCE_ACTION_START_SECONDS + ONCE_ACTION_ACTIVE_SECONDS);
    const ended = sampleTimelinePose(stores, ONCE_ACTION_START_SECONDS + ONCE_ACTION_DURATION_SECONDS);
    const released = sampleTimelinePose(
        stores,
        ONCE_ACTION_START_SECONDS + ONCE_ACTION_DURATION_SECONDS + ONCE_ACTION_HOLD_SAMPLE_SECONDS,
    );
    assertAcceptance(quaternionEquals(before, base), "动作开始前未保持常驻姿势");
    assertAcceptance(!quaternionEquals(before, active), "动作排期开始后未驱动骨骼");
    assertAcceptance(!quaternionEquals(ended, base), "一次性动作末帧与常驻姿势相同,验收无效");
    assertAcceptance(quaternionEquals(released, base), "一次性动作回收后未回到常驻姿势");
}

function assertPreviewPoseHoldsAfterGlobalSample(stores: DirectorDeskStores, objectId: string): void {
    const before = headQuaternion(stores, objectId);
    stores.playback.sampleCurrent();
    const after = headQuaternion(stores, objectId);
    assertAcceptance(
        before.every((value, index) => Math.abs(value - (after[index] ?? 0)) <= POSE_HOLD_EPSILON),
        "暂停后的动作预览被全局 playhead 重置",
    );
}

async function seedActionCatalog(stores: DirectorDeskStores): Promise<void> {
    await waitCatalogEntry(stores, HUMANOID_ASSET_ID);
    dispatchOk(stores, "assets.place", { assetId: HUMANOID_ASSET_ID, id: ACTOR_ID });
    await waitRuntime(stores, ACTOR_ID);
    dispatchOk(stores, "pose.apply-preset", { objectId: ACTOR_ID, presetId: BASE_POSE_PRESET_ID });
    assertAcceptance(stores.scene.manager.getEntity(ACTOR_ID)?.pose !== null, "常驻姿势未应用");

    const listed = stores.dispatcher.query({ type: "assets.list", payload: { kind: "action" } }, stores);
    assertAcceptance(listed.ok, "动作目录查询失败");
    const entries = listed.value as readonly AssetEntry[];
    assertAcceptance(entries.length === EXPECTED_ACTION_COUNT, "内置动作资产数量不符");
    assertAcceptance(
        entries.some((entry) => entry.id === WAVE_ASSET_ID) &&
            entries.some((entry) => entry.id === THUMBS_UP_ASSET_ID) &&
            entries.some((entry) => entry.id === NOD_ASSET_ID) &&
            entries.some((entry) => entry.id === CELEBRATE_ALT_ASSET_ID),
        "动作目录缺少验收资产",
    );

    dispatchOk(stores, "assets.mount", { assetId: WAVE_ASSET_ID, objectId: ACTOR_ID });
    await waitActionMounted(stores, ACTOR_ID);
    await waitMountedActionName(stores, ACTOR_ID, "挥手");
    assertUprightFirstFrame(stores, ACTOR_ID);
    assertLoopTimelinePlays(stores);

    dispatchOk(stores, "assets.mount", {
        assetId: THUMBS_UP_ASSET_ID,
        objectId: ACTOR_ID,
        startTimeSeconds: ONCE_ACTION_START_SECONDS,
        durationSeconds: ONCE_ACTION_DURATION_SECONDS,
    });
    await waitMountedActionName(stores, ACTOR_ID, "赞许");
    const onceActionId = stores.scene.manager.getEntity(ACTOR_ID)?.actionId;
    const onceAction = stores.animations.actions.find((action) => action.id === onceActionId);
    const performance = required(
        stores.scene.manager.getEntity(ACTOR_ID)?.actionPerformance ?? undefined,
        "一次性动作缺少时间轴排期",
    );
    assertAcceptance(onceAction?.loopMode === ACTION_LOOP_MODE.ONCE, "一次性动作未携带 once 策略");
    assertAcceptance(
        Math.abs(performance.startTimeSeconds - ONCE_ACTION_START_SECONDS) <= TIME_EPSILON_SECONDS &&
            Math.abs(performance.durationSeconds - ONCE_ACTION_DURATION_SECONDS) <= TIME_EPSILON_SECONDS,
        "一次性动作未按指定开始时间与时长排期",
    );
    const actionBar = required(
        stores.timelineLayout
            .project(TimelineViewport.full(stores.timeline.document.duration))
            .flatMap((row) => row.bars)
            .find((bar) => bar.kind === TIMELINE_BAR_KIND.ACTION && bar.id === ACTOR_ID),
        "时间轴缺少动作排期段条",
    );
    assertAcceptance(
        actionBar.startSeconds === performance.startTimeSeconds &&
            actionBar.durationSeconds === performance.durationSeconds,
        "动作排期段条与实体排期不一致",
    );
    dispatchOk(stores, "action.set-range", {
        objectId: ACTOR_ID,
        startTimeSeconds: RETIMED_ACTION_START_SECONDS,
        durationSeconds: RETIMED_ACTION_DURATION_SECONDS,
    });
    assertAcceptance(
        stores.scene.manager.getEntity(ACTOR_ID)?.actionPerformance?.startTimeSeconds === RETIMED_ACTION_START_SECONDS,
        "动作排期重定时未生效",
    );
    assertAcceptance(stores.history.undo(stores).ok, "动作排期撤销失败");
    assertAcceptance(
        stores.scene.manager.getEntity(ACTOR_ID)?.actionPerformance?.startTimeSeconds === ONCE_ACTION_START_SECONDS,
        "动作排期撤销未恢复原时段",
    );
    assertAcceptance(stores.history.redo(stores).ok, "动作排期重做失败");
    assertAcceptance(stores.history.undo(stores).ok, "动作排期验收恢复失败");
    assertOnceTimelineSchedule(stores);

    dispatchOk(stores, "action.preview.play", { objectId: ACTOR_ID });
    assertAcceptance(stores.actionPreview.isPlaying, "动作资产预览未播放");
    stores.actionPreview.tick((onceAction?.duration ?? 0) + 1);
    assertAcceptance(!stores.actionPreview.isPlaying, "一次性动作预览到尾未自动停住");
    assertAcceptance(
        Math.abs(stores.actionPreview.timeSeconds - (onceAction?.duration ?? 0)) <= TIME_EPSILON_SECONDS,
        "一次性动作预览到尾仍回卷首帧",
    );
    assertPreviewPoseHoldsAfterGlobalSample(stores, ACTOR_ID);

    dispatchOk(stores, "assets.mount", { assetId: NOD_ASSET_ID, objectId: ACTOR_ID });
    await waitMountedActionName(stores, ACTOR_ID, "点头");

    dispatchOk(stores, "assets.mount", { assetId: CELEBRATE_ALT_ASSET_ID, objectId: ACTOR_ID });
    await waitMountedActionName(stores, ACTOR_ID, "庆祝·二");

    dispatchOk(stores, "action.preview.play", { objectId: ACTOR_ID });
    assertAcceptance(stores.actionPreview.isPlaying, "动作资产预览未播放");
    dispatchOk(stores, "action.preview.pause", {});
    assertAcceptance(!stores.actionPreview.isPlaying, "动作资产预览未暂停");
    assertPreviewPoseHoldsAfterGlobalSample(stores, ACTOR_ID);

    const exported = stores.dispatcher.query({ type: "desk.export-document", payload: {} }, stores);
    const document = exported.ok ? (exported.value as DeskDocument) : null;
    const celebrate = document?.actions.find((action) => action.name === "庆祝·二");
    assertAcceptance(
        celebrate?.loopMode === ACTION_LOOP_MODE.ONCE &&
            celebrate.mountedOn.some((mount) => mount.objectId === ACTOR_ID && mount.durationSeconds > 0),
        "文档导出缺少动作排期",
    );

    stores.selection.select(ACTOR_ID);
}

const meta: Meta<typeof DirectorDesk> = { title: "演员/动作资产", component: DirectorDesk };
export default meta;

type Story = StoryObj<typeof DirectorDesk>;

export const CatalogActionAssets: Story = {
    name: "Mixamo 动作资产挂载",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                onReady={(stores) => {
                    void seedActionCatalog(stores).catch((error: unknown) => {
                        stores.ui.setApplicationNotice(error instanceof Error ? error.message : String(error));
                    });
                }}
            />
            <AcceptancePanel task="演员 · 动作资产" items={CHECKLIST} />
        </div>
    ),
};
