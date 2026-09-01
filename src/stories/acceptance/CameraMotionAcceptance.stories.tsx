import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DirectorDeskStores } from "../../ui/shell/DirectorDeskContext";
import { TEST_ASSETS } from "./seeds";
import { DirectorDesk } from "../../ui/shell/DirectorDesk";
import { EnterPresentationCommand } from "../../command/presentationCommands";

const PRIMARY_CAMERA_ID = "主机位";
const SIDE_CAMERA_ID = "侧机位";
const PRIMARY_MOTION_ID = "motion-main-push";
const SIDE_MOTION_ID = "motion-side-arc";
const PROGRAM_PRIMARY_ID = "program-main";
const PROGRAM_SIDE_ID = "program-side";
const TIMELINE_DURATION_SECONDS = 8;
const FOCUS_OBJECT_ID = "motion-focus-object";
const FIRST_CUT_DURATION_SECONDS = 4;

function dispatch(stores: DirectorDeskStores, type: string, payload: unknown): void {
    const result = stores.dispatcher.dispatch({ type, payload }, stores);
    if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`运镜验收: ${message}`);
}

function createMotionPayload(id: string, cameraId: string, startTimeSeconds: number, durationSeconds: number) {
    const isPrimary = cameraId === PRIMARY_CAMERA_ID;
    const start = isPrimary ? [-6, 3, 6] : [6, 3, 6];
    const midpoint = isPrimary ? [-2, 2.5, 3] : [3, 2, 1];
    const end = isPrimary ? [0, 2, 2] : [0, 2.5, 3];
    return {
        clip: {
            id,
            cameraId,
            startTimeSeconds,
            durationSeconds,
            focus: { target: { kind: "world-point", position: [0, 1.5, 0] } },
            easing: "smooth",
            path: {
                anchors: [
                    { id: `${id}-start`, position: start, outHandle: [1, 0, -2] },
                    { id: `${id}-middle`, position: midpoint, inHandle: [-1, 0, 1], outHandle: [1, 0, -1] },
                    { id: `${id}-end`, position: end, inHandle: [-1, 0, 1] },
                ],
            },
        },
    };
}

function verifyMotionAcceptance(stores: DirectorDeskStores): void {
    const capabilities = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    const expectedCapabilities = [
        "motion.create-clip",
        "motion.set-clip-range",
        "motion.set-clip-path",
        "motion.set-focus",
        "motion.remove-clip",
        "program.set-clip",
        "program.remove-clip",
        "motion.get",
    ];
    for (const type of expectedCapabilities) {
        assertAcceptance(capabilities.includes(type), `${type} capability 未注册`);
    }
    const motion = stores.dispatcher.query({ type: "motion.get", payload: {} }, stores);
    assertAcceptance(motion.ok, "motion.get 查询失败");
    const value = motion.ok
        ? (motion.value as { clips: { focus: { target: { kind: string; objectId?: string } } }[]; program: { clips: unknown[] } })
        : null;
    assertAcceptance(value?.clips.length === 2, "双机位运镜片段未建立");
    assertAcceptance(value?.program.clips.length === 2, "Program 输出片段未建立");
    const sideFocus = value?.clips.find((clip) => clip.focus.target.objectId === FOCUS_OBJECT_ID);
    assertAcceptance(sideFocus?.focus.target.kind === "scene-object", "对象注视绑定未保存");

    const conflict = stores.dispatcher.dispatch(
        {
            type: "motion.create-clip",
            payload: createMotionPayload("motion-overlap", PRIMARY_CAMERA_ID, 1, FIRST_CUT_DURATION_SECONDS),
        },
        stores,
    );
    const conflictIssue = conflict.ok ? undefined : conflict.issueDetails?.[0];
    assertAcceptance(conflictIssue?.code === "motion-overlapping-clip", "同机位片段重叠未被拒绝");
    dispatch(stores, "motion.set-clip-easing", { id: SIDE_MOTION_ID, easing: "linear" });
    assertAcceptance(stores.history.undo(stores).ok, "运镜缓动撤销失败");
    assertAcceptance(stores.history.redo(stores).ok, "运镜缓动重做失败");
    dispatch(stores, "transport.seek", { time: 5 });
    const cameraPose = stores.dispatcher.query({ type: "camera.get-pose", payload: {} }, stores);
    assertAcceptance(cameraPose.ok, "输出机位位姿查询失败");
    const poseValue = cameraPose.ok ? (cameraPose.value as { motionSampled?: { target: readonly number[] } }) : null;
    assertAcceptance(
        poseValue?.motionSampled?.target.join(",") === "0,2,0",
        "对象注视绑定未解析为对象位置加世界偏移",
    );
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
    dispatch(stores, "motion.create-clip", createMotionPayload(PRIMARY_MOTION_ID, PRIMARY_CAMERA_ID, 0, FIRST_CUT_DURATION_SECONDS));
    dispatch(stores, "motion.create-clip", createMotionPayload(SIDE_MOTION_ID, SIDE_CAMERA_ID, FIRST_CUT_DURATION_SECONDS, FIRST_CUT_DURATION_SECONDS));
    dispatch(stores, "object.place", {
        id: FOCUS_OBJECT_ID,
        kind: "model",
        sourceUrl: TEST_ASSETS.helmet,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "motion.set-focus", {
        id: SIDE_MOTION_ID,
        target: { kind: "scene-object", objectId: FOCUS_OBJECT_ID, worldOffset: [0, 1, 0] },
    });
    dispatch(stores, "program.set-clip", {
        clip: { id: PROGRAM_PRIMARY_ID, cameraId: PRIMARY_CAMERA_ID, startTimeSeconds: 0, durationSeconds: FIRST_CUT_DURATION_SECONDS },
    });
    dispatch(stores, "program.set-clip", {
        clip: { id: PROGRAM_SIDE_ID, cameraId: SIDE_CAMERA_ID, startTimeSeconds: FIRST_CUT_DURATION_SECONDS, durationSeconds: FIRST_CUT_DURATION_SECONDS },
    });
    const removeFocusedObject = stores.dispatcher.dispatch({ type: "object.remove", payload: { id: FOCUS_OBJECT_ID } }, stores);
    const removeIssue = removeFocusedObject.ok ? undefined : removeFocusedObject.issueDetails?.[0];
    assertAcceptance(removeIssue?.code === "focus-target-in-use", "删除被跟拍对象未被结构化拒绝");
    dispatch(stores, EnterPresentationCommand.TYPE, {});
    verifyMotionAcceptance(stores);
}

const meta: Meta<typeof DirectorDesk> = {
    title: "验收/阶段二 运镜轨迹",
    component: DirectorDesk,
};

export default meta;
type Story = StoryObj<typeof DirectorDesk>;

/**
 * 双机位独立 Bézier 运镜在单一 Program 输出轨硬切;
 * 播种末尾进入全屏预览(Program 接管视口相机),走查硬切时机与路径,Esc 退出回编辑态。
 */
export const 双机位Program运镜验收: Story = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk initialMotionPreviewVisible onReady={seedCameraMotionAcceptance} />
        </div>
    ),
};
