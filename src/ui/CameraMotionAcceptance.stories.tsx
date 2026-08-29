import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DirectorDeskStores } from "./DirectorDeskContext";
import { DirectorDesk } from "./DirectorDesk";

const VIEW_IDS = ["motion-push", "motion-pull", "motion-pan-left", "motion-pan-right"] as const;
const KEY_IDS = ["motion-key-0", "motion-key-2", "motion-key-4", "motion-key-6"] as const;

function dispatch(stores: DirectorDeskStores, type: string, payload: unknown): void {
    const result = stores.dispatcher.dispatch({ type, payload }, stores);
    if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`运镜验收: ${message}`);
}

function recordViewKeys(stores: DirectorDeskStores, index: number): void {
    const id = VIEW_IDS[index];
    const keyId = KEY_IDS[index];
    if (!id || !keyId) return;
    dispatch(stores, "view.frame", { ids: [id] });
    requestAnimationFrame(() => {
        dispatch(stores, "motion.add-key", {
            id: keyId,
            timeSeconds: index * 2,
            easing: index % 2 === 0 ? "smooth" : "linear",
        });
        if (index + 1 < VIEW_IDS.length) {
            recordViewKeys(stores, index + 1);
            return;
        }
        verifyMotionAcceptance(stores);
    });
}

function verifyMotionAcceptance(stores: DirectorDeskStores): void {
    const capabilityTypes = stores.dispatcher.listCapabilities().map((capability) => capability.type);
    for (const type of ["motion.add-key", "motion.move-key", "motion.remove-key", "motion.set-key-easing", "motion.get"]) {
        assertAcceptance(capabilityTypes.includes(type), `${type} capability 未注册`);
    }

    const motion = stores.dispatcher.query({ type: "motion.get", payload: {} }, stores);
    assertAcceptance(motion.ok, "motion.get 查询失败");
    const value = motion.ok ? motion.value as { path: { keys: unknown[] } | null } : null;
    assertAcceptance(value?.path?.keys.length === 4, "四个推拉摇移关键帧未建立");

    dispatch(stores, "motion.set-key-easing", { id: KEY_IDS[1], easing: "smooth" });
    assertAcceptance(stores.history.undo(stores).ok, "缓动撤销失败");
    assertAcceptance(stores.history.redo(stores).ok, "缓动重做失败");
    dispatch(stores, "motion.remove-key", { id: KEY_IDS[3] });
    assertAcceptance(stores.history.undo(stores).ok, "删除关键帧撤销失败");

    const timingFailure = stores.dispatcher.dispatch(
        { type: "motion.move-key", payload: { id: KEY_IDS[0], timeSeconds: 99 } },
        stores,
    );
    const timingIssue = timingFailure.ok ? undefined : timingFailure.issueDetails?.[0];
    assertAcceptance(
        timingIssue?.code === "motion-time-outside-duration" && timingIssue.path === "timeSeconds",
        "时间越界未返回结构化失败",
    );

    dispatch(stores, "camera.set-shot", {
        id: "motion-suppression-shot",
        shot: { position: [7, 5, 7], target: [0, 1, 0], fov: 45 },
    });
    dispatch(stores, "camera.activate", { id: "motion-suppression-shot" });
    const activeShotFailure = stores.dispatcher.dispatch(
        { type: "motion.add-key", payload: { id: "motion-blocked", timeSeconds: 8, easing: "linear" } },
        stores,
    );
    const activeShotIssue = activeShotFailure.ok ? undefined : activeShotFailure.issueDetails?.[0];
    assertAcceptance(
        activeShotIssue?.code === "motion-active-static-shot" && activeShotIssue.path === "",
        "掌镜抑制未返回结构化失败",
    );
    dispatch(stores, "camera.deactivate", {});

    dispatch(stores, "transport.play", {});
    dispatch(stores, "transport.seek", { time: 3 });
    dispatch(stores, "transport.pause", {});
    dispatch(stores, "transport.stop", {});
    requestAnimationFrame(() => dispatch(stores, "capture.frame", { hideHelpers: true }));
}

function seedCameraMotionAcceptance(stores: DirectorDeskStores): void {
    const transforms = [
        { position: [-5, 1, 0], rotation: [0, 0, 0], scale: [0.8, 0.8, 0.8] },
        { position: [-1, 1, -2], rotation: [0, 0, 0], scale: [1.6, 1.6, 1.6] },
        { position: [2, 1, -1], rotation: [0, 0, 0], scale: [1, 1, 1] },
        { position: [5, 1, 2], rotation: [0, 0, 0], scale: [0.65, 0.65, 0.65] },
    ] as const;
    VIEW_IDS.forEach((id, index) => {
        const transform = transforms[index];
        if (!transform) throw new Error(`运镜验收: ${id} 缺少摆位`);
        dispatch(stores, "object.place", { id, kind: "primitive", transform });
    });
    requestAnimationFrame(() => recordViewKeys(stores, 0));
}

const meta: Meta<typeof DirectorDesk> = {
    title: "验收/阶段二 运镜轨迹",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/**
 * 验收：仅经 dispatcher 播种四个关键帧（推拉摇移）、查询能力、CRUD/撤销/重做及结构化失败。
 * 轨迹预览默认可见；播放到 3 秒、暂停并停止后应还原自由导演视角；截图应排除轨迹 helper。
 */
export const 运镜轨迹命令验收: Story = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk initialMotionPreviewVisible onReady={seedCameraMotionAcceptance} />
        </div>
    ),
};
