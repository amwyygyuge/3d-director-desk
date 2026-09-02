import type { Meta, StoryObj } from "@storybook/react-vite";

import type { CameraKeyJSON } from "@/camera/CameraKey";
import type { FocusTargetJSON } from "@/camera/CameraFocusTrack";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { TEST_ASSETS } from "@/stories/seeds";
import { assertAcceptance, dispatchOk as dispatch, required } from "@/stories/harness";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";

const PRIMARY_CAMERA_ID = "主机位";
const SIDE_CAMERA_ID = "侧机位";
const PRIMARY_MOTION_ID = "motion-main-push";
const SIDE_MOTION_ID = "motion-side-arc";
const AUTHORED_MOTION_START_SECONDS = 6;
const TIMELINE_DURATION_SECONDS = 8;
const FOCUS_OBJECT_ID = "motion-focus-object";
const TAKE_DURATION_SECONDS = 3;
/** 断言用的可辨识焦距:与任何预设产物的缺省值都不相同 */
const EDITED_KEY_FOV = 33;
const ZERO_VECTOR: [number, number, number] = [0, 0, 0];

interface MotionGetValue {
    readonly clips: readonly {
        readonly id: string;
        readonly keys: readonly CameraKeyJSON[];
        readonly easing: string;
    }[];
    readonly program: { readonly clips: readonly unknown[] };
}

function cameraKey(
    id: string,
    progress: number,
    position: [number, number, number],
    target: [number, number, number],
): CameraKeyJSON {
    return {
        id,
        progress,
        position,
        target,
        fov: null,
        handleMode: "auto",
        inHandle: ZERO_VECTOR,
        outHandle: ZERO_VECTOR,
    };
}

function createTakePayload(
    id: string,
    cameraId: string,
    startTimeSeconds: number,
    focus: FocusTargetJSON | null = null,
) {
    const isPrimary = cameraId === PRIMARY_CAMERA_ID;
    const start: [number, number, number] = isPrimary ? [-6, 3, 6] : [6, 3, 6];
    const midpoint: [number, number, number] = isPrimary ? [-2, 2.5, 3] : [3, 2, 1];
    const end: [number, number, number] = isPrimary ? [0, 2, 2] : [0, 2.5, 3];
    return {
        id,
        cameraId,
        startTimeSeconds,
        durationSeconds: TAKE_DURATION_SECONDS,
        keys: [
            cameraKey(`${id}-start`, 0, start, [0, 1.5, 0]),
            cameraKey(`${id}-middle`, 0.5, midpoint, [0, 1.5, 0]),
            cameraKey(`${id}-end`, 1, end, [0, 1.5, 0]),
        ],
        focus,
    };
}

function motionState(stores: DirectorDeskStores): MotionGetValue {
    const result = stores.dispatcher.query({ type: "motion.get", payload: {} }, stores);
    assertAcceptance(result.ok, "motion.get 查询失败");
    return result.value as MotionGetValue;
}

function verifyCapabilities(stores: DirectorDeskStores): void {
    const capabilities = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    const expectedCapabilities = [
        "motion.create-take",
        "motion.set-key",
        "motion.move-key",
        "motion.remove-key",
        "motion.set-key-handle",
        "motion.author",
        "view.set-mode",
        "motion.get",
    ];
    for (const type of expectedCapabilities) {
        assertAcceptance(capabilities.includes(type), `${type} capability 未注册`);
    }
}

function verifyTakeAndProgram(stores: DirectorDeskStores): void {
    const motion = motionState(stores);
    assertAcceptance(motion.clips.length === 2, "双机位运镜片段未建立");
    assertAcceptance(motion.program.clips.length === 2, "motion.create-take 未自动建立 Program 输出片段");
}

function verifyOverlapRejected(stores: DirectorDeskStores): void {
    const conflict = stores.dispatcher.dispatch(
        {
            type: "motion.create-take",
            payload: createTakePayload("motion-overlap", PRIMARY_CAMERA_ID, 1),
        },
        stores,
    );
    const issue = conflict.ok ? undefined : conflict.issueDetails?.[0];
    assertAcceptance(issue?.code === "motion-overlapping-clip", "同机位片段重叠未被拒绝");
}

function verifyKeyUndoRedo(stores: DirectorDeskStores): void {
    const before = required(
        required(
            motionState(stores).clips.find((clip) => clip.id === PRIMARY_MOTION_ID),
            "主机位片段缺失",
        ).keys.find((key) => key.id === `${PRIMARY_MOTION_ID}-middle`),
        "主机位中间关键帧缺失",
    );
    const updated: CameraKeyJSON = { ...before, position: [-1, 2.25, 2.5] };
    dispatch(stores, "motion.set-key", { clipId: PRIMARY_MOTION_ID, key: updated });
    assertAcceptance(stores.history.undo(stores).ok, "motion.set-key 撤销失败");
    const undone = required(
        required(
            motionState(stores).clips.find((clip) => clip.id === PRIMARY_MOTION_ID),
            "撤销后主机位片段缺失",
        ).keys.find((key) => key.id === before.id),
        "撤销后关键帧缺失",
    );
    assertAcceptance(undone.position.join(",") === before.position.join(","), "撤销未恢复关键帧前值");
    assertAcceptance(stores.history.redo(stores).ok, "motion.set-key 重做失败");
    const redone = required(
        required(
            motionState(stores).clips.find((clip) => clip.id === PRIMARY_MOTION_ID),
            "重做后主机位片段缺失",
        ).keys.find((key) => key.id === before.id),
        "重做后关键帧缺失",
    );
    assertAcceptance(redone.position.join(",") === updated.position.join(","), "重做未恢复更新后的关键帧");
}

function verifyFocusIntegrity(stores: DirectorDeskStores): void {
    const removal = stores.dispatcher.dispatch({ type: "object.remove", payload: { id: FOCUS_OBJECT_ID } }, stores);
    const issue = removal.ok ? undefined : removal.issueDetails?.[0];
    assertAcceptance(issue?.code === "focus-target-in-use", "删除被跟拍对象未被结构化拒绝");
}

function verifyTransportClamp(stores: DirectorDeskStores): void {
    dispatch(stores, "transport.seek", { time: TIMELINE_DURATION_SECONDS + 1 });
    const clampedUpper = stores.clock.time;
    assertAcceptance(clampedUpper === TIMELINE_DURATION_SECONDS, "transport.seek 未 clamp 到时长上界");
    // 零下界由命令围栏接管:负值结构化拒绝(裸数值围栏),不再是静默钳制
    const rejected = stores.dispatcher.dispatch({ type: "transport.seek", payload: { time: -1 } }, stores);
    assertAcceptance(!rejected.ok, "负值 seek 未被围栏拒绝");
    assertAcceptance(stores.clock.time === TIMELINE_DURATION_SECONDS, "被拒 seek 不应改变 playhead");
}

function verifyAuthoringOutput(stores: DirectorDeskStores): void {
    dispatch(stores, "motion.author", {
        cameraId: PRIMARY_CAMERA_ID,
        startTimeSeconds: AUTHORED_MOTION_START_SECONDS,
        durationSeconds: TAKE_DURATION_SECONDS - 1,
        move: "dolly-in",
    });
    const authored = required(
        motionState(stores).clips.find((clip) => clip.id !== PRIMARY_MOTION_ID && clip.id !== SIDE_MOTION_ID),
        "motion.author 未产出可编辑片段",
    );
    const key = required(authored.keys[0], "motion.author 产物缺少关键帧");
    dispatch(stores, "motion.set-key", { clipId: authored.id, key: { ...key, fov: EDITED_KEY_FOV } });
    const edited = required(
        required(
            motionState(stores).clips.find((clip) => clip.id === authored.id),
            "编辑后预设片段缺失",
        ).keys.find((candidate) => candidate.id === key.id),
        "编辑后预设关键帧缺失",
    );
    assertAcceptance(edited.fov === EDITED_KEY_FOV, "motion.author 产物不可再编辑");
    dispatch(stores, "motion.set-clip-easing", { id: authored.id, easing: "linear" });
    const retimed = required(
        motionState(stores).clips.find((clip) => clip.id === authored.id),
        "缓动编辑后片段缺失",
    );
    assertAcceptance(retimed.easing === "linear", "整段时间曲线不可编辑");
}

function seedCameraMotionAcceptance(stores: DirectorDeskStores): void {
    dispatch(stores, "timeline.set-duration", { duration: TIMELINE_DURATION_SECONDS });
    dispatch(stores, "camera.set-shot", {
        id: PRIMARY_CAMERA_ID,
        shot: { position: [-6, 3, 6], target: [0, 1.5, 0], fov: 45 },
    });
    dispatch(stores, "camera.set-shot", {
        id: SIDE_CAMERA_ID,
        shot: { position: [6, 3, 6], target: [0, 1.5, 0], fov: 50 },
    });
    dispatch(stores, "object.place", {
        id: FOCUS_OBJECT_ID,
        kind: "model",
        sourceUrl: TEST_ASSETS.helmet,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "motion.create-take", createTakePayload(PRIMARY_MOTION_ID, PRIMARY_CAMERA_ID, 0));
    dispatch(
        stores,
        "motion.create-take",
        createTakePayload(SIDE_MOTION_ID, SIDE_CAMERA_ID, TAKE_DURATION_SECONDS, {
            kind: "scene-object",
            objectId: FOCUS_OBJECT_ID,
            worldOffset: [0, 1, 0],
        }),
    );

    verifyCapabilities(stores);
    verifyTakeAndProgram(stores);
    verifyOverlapRejected(stores);
    verifyKeyUndoRedo(stores);
    verifyFocusIntegrity(stores);
    verifyTransportClamp(stores);
    verifyAuthoringOutput(stores);
}

const meta: Meta<typeof DirectorDesk> = {
    title: "镜头/运镜编排",
    component: DirectorDesk,
};

export default meta;
type Story = StoryObj<typeof DirectorDesk>;

/** 双机位 take 自动接管 Program；验收 key 编辑、跟拍引用、传输封顶与语义预设。 */
export const ProgramMotion: Story = {
    name: "双机位 Program 运镜",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk initialMotionPathVisible onReady={seedCameraMotionAcceptance} />
        </div>
    ),
};
