import type { Meta, StoryObj } from "@storybook/react-vite";

import { CameraFrameSolver } from "@/camera/CameraFrameSolver";
import { createCameraMotionSample } from "@/camera/CameraMotionClip";
import type { CameraMotionSample } from "@/camera/CameraMotionClip";
import type { CameraKeyJSON } from "@/camera/CameraKey";
import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import { FOLLOW_FRAME } from "@/motion/SubjectFrameResolver";
import { FOLLOW_APPROACH } from "@/camera/CameraFollowTrack";
import { MOTION_MOVE } from "@/authoring/MotionPresetCompiler";
import { SHOT_SIZE } from "@/camera/CameraShot";
import type { FollowFrame } from "@/motion/SubjectFrameResolver";
import { EASING } from "@/motion/EasingCurve";
import { ORIENTATION_MODE } from "@/timeline/TrackPolicies";
import type { Vec3 } from "@/core/SceneObject";
import type { TransformKeyframeInit } from "@/timeline/TransformKeyframe";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { TEST_ASSETS } from "@/stories/seeds";
import { assertAcceptance, dispatchOk as dispatch, required } from "@/stories/harness";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";

const SUBJECT_ID = "follow-subject";
const CLIP_ID = "motion-follow";
/** quickMotionIdFor 的派生规则:motion-{subjectId}-{move}-{start};Program 为空故起点为 0 */
const HOLD_CLIP_ID = `motion-follow-subject-${MOTION_MOVE.HOLD}-0`;
const TRACK_ID = `transform-${SUBJECT_ID}`;
const TIMELINE_DURATION_SECONDS = 8;
const CLIP_START_SECONDS = 1;
const CLIP_DURATION_SECONDS = 4;
const WALK_START_SECONDS = 0;
const WALK_END_SECONDS = 6;
/** 主体沿 +X 直线行走的两端;PATH 朝向下 yaw 恒定,便于逐项断言 */
const WALK_START_POSITION: Vec3 = [0, 0, 0];
const WALK_END_POSITION: Vec3 = [12, 0, 0];
const SUBJECT_SHIFT_METERS = 5;
const SUBJECT_TURN_RADIANS = Math.PI / 2;
const ANCHOR_OFFSET: Vec3 = [0, 1.2, 0];
const DEFAULT_KEY_FOV = 45;
const ZERO_VECTOR: Vec3 = [0, 0, 0];
const EPSILON = 1e-6;
/** 手感参数的断言取值:与任何缺省都不同,漏传即断言失败 */
const LAG_SECONDS = 0.5;
const SMOOTHING_SECONDS = 0.4;
const NO_LAG_SECONDS = 0;
const NO_SMOOTHING_SECONDS = 0;
const DETERMINISM_SAMPLE_COUNT = 12;
const CLIP_REFERENCE_IN_USE_CODE = "clip-reference-in-use";

interface FollowPayload {
    readonly id: string;
    readonly objectId: string;
    readonly anchorOffset: Vec3;
    readonly frame: FollowFrame;
    readonly lagSeconds: number;
    readonly smoothingSeconds: number;
}

function followPayload(overrides: Partial<FollowPayload> = {}): FollowPayload {
    return {
        id: CLIP_ID,
        objectId: SUBJECT_ID,
        anchorOffset: ANCHOR_OFFSET,
        frame: FOLLOW_FRAME.HEADING,
        lagSeconds: NO_LAG_SECONDS,
        smoothingSeconds: NO_SMOOTHING_SECONDS,
        ...overrides,
    };
}

function cameraKey(id: string, progress: number, position: Vec3, target: Vec3): CameraKeyJSON {
    return {
        id,
        progress,
        position,
        target,
        fov: DEFAULT_KEY_FOV,
        handleMode: "auto",
        inHandle: ZERO_VECTOR,
        outHandle: ZERO_VECTOR,
    };
}

function walkKeyframe(id: string, time: number, position: Vec3, rotationY: number): TransformKeyframeInit {
    return {
        id,
        time,
        value: { position, rotation: [0, rotationY, 0], scale: [1, 1, 1] },
        easing: EASING.LINEAR,
    };
}

/** 走位轨:整条替换是一次写入,与视口速绘同一条命令路径。 */
function seedWalk(stores: DirectorDeskStores, start: Vec3, end: Vec3, rotationY = 0): void {
    dispatch(stores, "timeline.set-track", {
        trackId: TRACK_ID,
        targetId: SUBJECT_ID,
        keyframes: [
            walkKeyframe("walk-start", WALK_START_SECONDS, start, rotationY),
            walkKeyframe("walk-end", WALK_END_SECONDS, end, rotationY),
        ],
        policies: { orientation: ORIENTATION_MODE.KEYED },
    });
}

function clipOf(stores: DirectorDeskStores): CameraMotionClip {
    return required(stores.motion.clip(CLIP_ID), "跟拍验收片段缺失");
}

/** 成片画面的唯一解算口:验收读的就是回放采样器读的那一份。 */
function solvedAt(stores: DirectorDeskStores, timeSeconds: number, sample: CameraMotionSample): boolean {
    return new CameraFrameSolver(stores.timeline, stores.scene.manager).solve(clipOf(stores), timeSeconds, sample);
}

function poseAtKeyTimes(stores: DirectorDeskStores): readonly CameraMotionSample[] {
    const clip = clipOf(stores);
    return clip.keys.map((key) => {
        const sample = createCameraMotionSample();
        const timeSeconds = clip.timeAtProgress(key.progress);
        assertAcceptance(solvedAt(stores, timeSeconds, sample), `关键帧时刻 ${timeSeconds} 无法解算画面`);
        return { ...sample };
    });
}

function assertSamePoses(
    before: readonly CameraMotionSample[],
    after: readonly CameraMotionSample[],
    message: string,
): void {
    assertAcceptance(before.length === after.length, `${message}(关键帧数量变化)`);
    for (const [index, expected] of before.entries()) {
        const actual = required(after[index], `${message}(缺少第 ${index} 帧)`);
        const drift = Math.max(
            Math.abs(expected.positionX - actual.positionX),
            Math.abs(expected.positionY - actual.positionY),
            Math.abs(expected.positionZ - actual.positionZ),
            Math.abs(expected.targetX - actual.targetX),
            Math.abs(expected.targetY - actual.targetY),
            Math.abs(expected.targetZ - actual.targetZ),
        );
        assertAcceptance(drift <= EPSILON, `${message}(第 ${index} 帧偏移 ${drift})`);
    }
}

/** 绑定的核心不变式:关键帧时刻画面逐帧不变,否则作者点一下下拉框画面就跳。 */
function verifyBindKeepsFrame(stores: DirectorDeskStores): void {
    const before = poseAtKeyTimes(stores);
    dispatch(stores, "motion.bind-follow", followPayload());
    assertAcceptance(clipOf(stores).isFollowBound, "绑定后片段未进入跟拍态");
    assertSamePoses(before, poseAtKeyTimes(stores), "绑定跟拍改变了关键帧时刻的画面");
}

/** 正逆闭合:解绑把关键帧烘回世界坐标,画面同样不跳,坐标回到原值。 */
function verifyUnbindRoundTrip(stores: DirectorDeskStores): void {
    const worldKeys = clipOf(stores).keys.map((key) => key.toJSON());
    dispatch(stores, "motion.bind-follow", followPayload());
    dispatch(stores, "motion.unbind-follow", { id: CLIP_ID });
    const restored = clipOf(stores);
    assertAcceptance(!restored.isFollowBound, "解绑后片段仍处于跟拍态");
    for (const [index, expected] of worldKeys.entries()) {
        const actual = required(restored.keys[index], `解绑后缺少第 ${index} 枚关键帧`);
        const drift = Math.max(
            Math.abs(expected.position[0] - actual.position[0]),
            Math.abs(expected.position[1] - actual.position[1]),
            Math.abs(expected.position[2] - actual.position[2]),
        );
        assertAcceptance(drift <= EPSILON, `绑定/解绑往返后第 ${index} 枚关键帧漂移 ${drift}`);
    }
}

/** 平移系:主体整体位移多少,镜头世界位置就跟着位移多少,相对站位不变。 */
function verifyWorldFrameTranslation(stores: DirectorDeskStores): void {
    dispatch(stores, "motion.bind-follow", followPayload({ frame: FOLLOW_FRAME.WORLD }));
    const sampleTimeSeconds = CLIP_START_SECONDS + CLIP_DURATION_SECONDS / 2;
    const before = createCameraMotionSample();
    assertAcceptance(solvedAt(stores, sampleTimeSeconds, before), "位移前无法解算跟拍画面");
    seedWalk(
        stores,
        [WALK_START_POSITION[0] + SUBJECT_SHIFT_METERS, WALK_START_POSITION[1], WALK_START_POSITION[2]],
        [WALK_END_POSITION[0] + SUBJECT_SHIFT_METERS, WALK_END_POSITION[1], WALK_END_POSITION[2]],
    );
    const after = createCameraMotionSample();
    assertAcceptance(solvedAt(stores, sampleTimeSeconds, after), "位移后无法解算跟拍画面");
    const deltaX = after.positionX - before.positionX;
    assertAcceptance(Math.abs(deltaX - SUBJECT_SHIFT_METERS) <= EPSILON, `平移跟随未同步位移(实际 ${deltaX})`);
    assertAcceptance(Math.abs(after.positionZ - before.positionZ) <= EPSILON, "平移跟随不应改变 Z");
    seedWalk(stores, WALK_START_POSITION, WALK_END_POSITION);
}

/** 朝向系:主体转身,镜头绕主体同角度旋转;距离不变、画面不继承俯仰。 */
function verifyHeadingFrameRotation(stores: DirectorDeskStores): void {
    dispatch(stores, "motion.bind-follow", followPayload({ frame: FOLLOW_FRAME.HEADING }));
    const sampleTimeSeconds = CLIP_START_SECONDS + CLIP_DURATION_SECONDS / 2;
    const before = createCameraMotionSample();
    assertAcceptance(solvedAt(stores, sampleTimeSeconds, before), "转身前无法解算跟拍画面");
    seedWalk(stores, WALK_START_POSITION, WALK_END_POSITION, SUBJECT_TURN_RADIANS);
    const after = createCameraMotionSample();
    assertAcceptance(solvedAt(stores, sampleTimeSeconds, after), "转身后无法解算跟拍画面");
    const subjectX = subjectPositionX(sampleTimeSeconds);
    const beforeRadius = Math.hypot(before.positionX - subjectX, before.positionZ);
    const afterRadius = Math.hypot(after.positionX - subjectX, after.positionZ);
    assertAcceptance(Math.abs(beforeRadius - afterRadius) <= EPSILON, "朝向跟随改变了与主体的距离");
    const turned = Math.abs(before.positionX - after.positionX) + Math.abs(before.positionZ - after.positionZ);
    assertAcceptance(turned > EPSILON, "朝向跟随未随主体转身环绕");
    assertAcceptance(Math.abs(before.positionY - after.positionY) <= EPSILON, "朝向跟随不得改变画面高度");
    seedWalk(stores, WALK_START_POSITION, WALK_END_POSITION);
}

/** 走位是匀速直线,主体某刻的 X 可闭式求出,断言不必依赖被测代码。 */
function subjectPositionX(timeSeconds: number): number {
    const ratio = (timeSeconds - WALK_START_SECONDS) / (WALK_END_SECONDS - WALK_START_SECONDS);
    return WALK_START_POSITION[0] + (WALK_END_POSITION[0] - WALK_START_POSITION[0]) * ratio;
}

/** 滞后是时间域的纯位移:t 处的站位等于无滞后时 t−lag 处的站位。 */
function verifyLagShiftsInTime(stores: DirectorDeskStores): void {
    const sampleTimeSeconds = CLIP_START_SECONDS + CLIP_DURATION_SECONDS / 2;
    dispatch(stores, "motion.bind-follow", followPayload({ frame: FOLLOW_FRAME.WORLD }));
    const laggedReference = createCameraMotionSample();
    assertAcceptance(solvedAt(stores, sampleTimeSeconds, laggedReference), "滞后基准无法解算");
    const subjectDelta = subjectPositionX(sampleTimeSeconds) - subjectPositionX(sampleTimeSeconds - LAG_SECONDS);
    dispatch(stores, "motion.set-follow-params", followPayload({ frame: FOLLOW_FRAME.WORLD, lagSeconds: LAG_SECONDS }));
    const lagged = createCameraMotionSample();
    assertAcceptance(solvedAt(stores, sampleTimeSeconds, lagged), "滞后生效后无法解算");
    const observed = laggedReference.positionX - lagged.positionX;
    assertAcceptance(Math.abs(observed - subjectDelta) <= EPSILON, `滞后未按时间平移站位(实际 ${observed})`);
}

/**
 * 确定性:顺序推进与随机 seek 必须给出同一序列。
 * 弹簧阻尼式跟拍会在这一条上必然失败——本断言是「滞后/平滑只能走时间域」的守门人。
 */
function verifyDeterministicSampling(stores: DirectorDeskStores): void {
    dispatch(
        stores,
        "motion.set-follow-params",
        followPayload({ lagSeconds: LAG_SECONDS, smoothingSeconds: SMOOTHING_SECONDS }),
    );
    const step = CLIP_DURATION_SECONDS / DETERMINISM_SAMPLE_COUNT;
    const forward: number[] = [];
    for (const index of Array.from({ length: DETERMINISM_SAMPLE_COUNT }, (_, position) => position)) {
        const sample = createCameraMotionSample();
        assertAcceptance(solvedAt(stores, CLIP_START_SECONDS + index * step, sample), "顺序采样失败");
        forward.push(sample.positionX);
    }
    const shuffled = [...forward.keys()].reverse();
    for (const index of shuffled) {
        const sample = createCameraMotionSample();
        assertAcceptance(solvedAt(stores, CLIP_START_SECONDS + index * step, sample), "跳转采样失败");
        const expected = required(forward[index], "顺序采样缺值");
        assertAcceptance(Math.abs(expected - sample.positionX) <= EPSILON, `第 ${index} 帧顺序播放与跳转结果不一致`);
    }
}

/** 主体没有走位轨时,跟拍退化为固定偏移机位而不是报错。 */
function verifyStaticSubjectDegradation(stores: DirectorDeskStores): void {
    dispatch(stores, "motion.unbind-follow", { id: CLIP_ID });
    const before = poseAtKeyTimes(stores);
    dispatch(stores, "timeline.set-track", { trackId: TRACK_ID, targetId: SUBJECT_ID, keyframes: [] });
    dispatch(stores, "motion.bind-follow", followPayload());
    assertSamePoses(before, poseAtKeyTimes(stores), "无走位轨时绑定跟拍改变了画面");
    dispatch(stores, "motion.unbind-follow", { id: CLIP_ID });
    seedWalk(stores, WALK_START_POSITION, WALK_END_POSITION);
}

/** 聚合命令的撤销必须整段回滚:关键帧与覆盖层一起回到前态。 */
function verifyBindUndo(stores: DirectorDeskStores): void {
    const worldKeys = clipOf(stores).keys.map((key) => key.toJSON());
    dispatch(stores, "motion.bind-follow", followPayload());
    stores.history.undo(stores);
    const restored = clipOf(stores);
    assertAcceptance(!restored.isFollowBound, "撤销绑定后覆盖层未清除");
    const first = required(restored.keys[0], "撤销后关键帧缺失");
    const expected = required(worldKeys[0], "前态关键帧缺失");
    assertAcceptance(Math.abs(first.position[0] - expected.position[0]) <= EPSILON, "撤销绑定未把关键帧还原为世界坐标");
}

/** 引用完整性:被跟拍的主体不能被静默删除。 */
function verifyFollowReferenceGuard(stores: DirectorDeskStores): void {
    dispatch(stores, "motion.bind-follow", followPayload());
    const removal = stores.dispatcher.dispatch({ type: "object.remove", payload: { id: SUBJECT_ID } }, stores);
    const issue = removal.ok ? undefined : removal.issueDetails?.[0];
    assertAcceptance(issue?.code === CLIP_REFERENCE_IN_USE_CODE, "删除被跟拍主体未被结构化拒绝");
    assertAcceptance(
        issue?.options?.some((option) => option.type === "unbind-dependent-follow") === true,
        "拒绝结果未给出解除跟拍的可选项",
    );
}

function verifyFollowCapabilities(stores: DirectorDeskStores): void {
    const capabilities = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    for (const type of [
        "motion.bind-follow",
        "motion.unbind-follow",
        "motion.set-follow-params",
        "motion.replace-clip",
    ]) {
        assertAcceptance(capabilities.includes(type), `${type} capability 未注册`);
    }
}

/**
 * 第三人称固定跟随:一句「跟在他身后走个中景」的产物。
 * 语汇 hold + 跟拍 = 相对站位恒定,镜头与主体的距离全程不变——这是跟拍最常用的一档。
 */
function verifyThirdPersonHold(stores: DirectorDeskStores): void {
    dispatch(stores, "motion.quick-author", {
        subjectId: SUBJECT_ID,
        shotSize: SHOT_SIZE.MEDIUM,
        move: MOTION_MOVE.HOLD,
        durationSeconds: CLIP_DURATION_SECONDS,
        follow: { approach: FOLLOW_APPROACH.BACK },
    });
    const clip = required(stores.motion.clip(HOLD_CLIP_ID), "一步成片未产出跟拍片段");
    assertAcceptance(clip.isFollowBound, "一步成片的跟拍片段未绑定跟拍");
    const solver = new CameraFrameSolver(stores.timeline, stores.scene.manager);
    const sample = createCameraMotionSample();
    const distances = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const timeSeconds = clip.startTimeSeconds + clip.durationSeconds * ratio;
        assertAcceptance(solver.solve(clip, timeSeconds, sample), `第三人称跟随在 ${timeSeconds} 无法解算`);
        return Math.hypot(sample.positionX - sample.targetX, sample.positionZ - sample.targetZ);
    });
    const first = required(distances[0], "跟随距离采样缺值");
    for (const [index, distance] of distances.entries()) {
        assertAcceptance(Math.abs(distance - first) <= EPSILON, `第 ${index} 帧的跟随距离发生漂移`);
    }
}

function seedFollowAcceptance(stores: DirectorDeskStores): void {
    dispatch(stores, "timeline.set-duration", { duration: TIMELINE_DURATION_SECONDS });
    dispatch(stores, "object.place", {
        id: SUBJECT_ID,
        kind: "model",
        sourceUrl: TEST_ASSETS.helmet,
        transform: { position: WALK_START_POSITION, rotation: ZERO_VECTOR, scale: [1, 1, 1] },
    });
    seedWalk(stores, WALK_START_POSITION, WALK_END_POSITION);
    dispatch(stores, "motion.create-clip", {
        clip: {
            id: CLIP_ID,
            startTimeSeconds: CLIP_START_SECONDS,
            durationSeconds: CLIP_DURATION_SECONDS,
            keys: [
                cameraKey(`${CLIP_ID}-start`, 0, [-4, 2, 4], [0, 1.2, 0]),
                cameraKey(`${CLIP_ID}-end`, 1, [-2, 2, 6], [0, 1.2, 0]),
            ],
            focus: null,
            follow: null,
            easing: EASING.SMOOTH,
        },
    });

    verifyFollowCapabilities(stores);
    verifyBindKeepsFrame(stores);
    verifyUnbindRoundTrip(stores);
    verifyWorldFrameTranslation(stores);
    verifyHeadingFrameRotation(stores);
    verifyLagShiftsInTime(stores);
    verifyDeterministicSampling(stores);
    verifyStaticSubjectDegradation(stores);
    verifyBindUndo(stores);
    verifyThirdPersonHold(stores);
    verifyFollowReferenceGuard(stores);
}

const meta: Meta<typeof DirectorDesk> = {
    title: "镜头/跟拍运镜",
    component: DirectorDesk,
};

export default meta;
type Story = StoryObj<typeof DirectorDesk>;

/** 绑定保画面、正逆闭合、两种参考系、滞后与确定性、退化与引用拦截。 */
export const FollowShot: Story = {
    name: "模型运动轨迹跟拍",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk initialMotionPathVisible onReady={seedFollowAcceptance} />
        </div>
    ),
};
