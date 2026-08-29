import type { Meta, StoryObj } from "@storybook/react-vite";

import { makeAutoObservable } from "mobx";
import { useState } from "react";

import type { HostAdapter } from "../host/HostAdapter";
import type { SkeletonDiscoveryDto } from "../pose/SkeletonRuntimeRegistry";
import type { DirectorDeskStores } from "./DirectorDeskContext";
import { DirectorDesk } from "./DirectorDesk";

const ACTOR_ID = "pose-fox";
const POSE_TRACK_ID = "pose-pose-fox";

interface CapturedFrame {
    readonly blobUrl: string;
    readonly width: number;
    readonly height: number;
}

/** Story-local observable host verifies the asynchronous capture delivery contract. */
class PoseCaptureSink implements HostAdapter {
    readonly captures: CapturedFrame[] = [];
    private waiting: ((capture: CapturedFrame) => void) | null = null;

    constructor() {
        makeAutoObservable<PoseCaptureSink, "waiting">(this, { waiting: false });
    }

    onImportModel(): () => void {
        return () => {};
    }

    reportCapture(capture: CapturedFrame): void {
        this.captures.push(capture);
        const resolve = this.waiting;
        this.waiting = null;
        resolve?.(capture);
    }

    waitForCapture(): Promise<CapturedFrame> {
        const capture = this.captures[this.captures.length - 1];
        if (capture) return Promise.resolve(capture);
        const pending = Promise.withResolvers<CapturedFrame>();
        this.waiting = pending.resolve;
        return pending.promise;
    }

    reportReady(): void {}
}

function dispatch(stores: DirectorDeskStores, type: string, payload: unknown): void {
    const result = stores.dispatcher.dispatch({ type, payload }, stores);
    if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`姿态验收: ${message}`);
}

function seedPoseAcceptance(stores: DirectorDeskStores, captureSink: PoseCaptureSink): void {
    dispatch(stores, "object.place", {
        id: ACTOR_ID,
        kind: "model",
        sourceUrl: "/test-assets/fox.glb",
        format: "gltf",
        name: "骨骼狐狸（姿态验收）",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    const notReady = stores.dispatcher.dispatch(
        {
            type: "pose.set-bone",
            payload: { objectId: ACTOR_ID, boneKey: "root/0", quaternion: [0, 0, 0, 1] },
        },
        stores,
    );
    assertAcceptance(
        !notReady.ok && notReady.issueDetails?.[0]?.code === "runtime-not-ready",
        "模型未就绪未给出等待模型结构化错误",
    );
    const poll = async (): Promise<void> => {
        const result = stores.dispatcher.query(
            { type: "pose.bones.discover", payload: { objectId: ACTOR_ID } },
            stores,
        );
        if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
        const discovery = result.value as SkeletonDiscoveryDto;
        if (!discovery.ready) {
            requestAnimationFrame(() => {
                void poll();
            });
            return;
        }
        const firstRawBoneKey = discovery.roots[0]?.key;
        const semantic = discovery.semanticCandidates[0];
        assertAcceptance(Boolean(firstRawBoneKey), "骨骼发现未返回原始树回退节点");
        const boneKey = semantic?.boneKey ?? firstRawBoneKey!;
        // Fixture loading is runtime-only setup; all scene mutations, including action mount, use Dispatcher.
        const actionHandle = await stores.models.acquire("/test-assets/fox.glb", "gltf");
        const clip = actionHandle.animations[0];
        if (!clip) {
            actionHandle.release();
            throw new Error("姿态验收: 狐狸夹具未提供动作 clip");
        }
        const action = stores.animations.register({
            name: "狐狸姿态验收动作",
            url: "/test-assets/fox.glb",
            clip,
        }).action;
        actionHandle.release();
        dispatch(stores, "action.mount", { objectId: ACTOR_ID, actionId: action.id });
        dispatch(stores, "pose.set-bone", {
            objectId: ACTOR_ID,
            boneKey,
            quaternion: [0, 0.2588190451, 0, 0.9659258263],
        });
        dispatch(stores, "pose.set-weight", { objectId: ACTOR_ID, weight: 0.65 });
        dispatch(stores, "pose.add-key", {
            trackId: POSE_TRACK_ID,
            targetId: ACTOR_ID,
            keyframe: {
                id: "pose-key-0",
                time: 0,
                value: stores.scene.manager.getEntity(ACTOR_ID)?.pose?.toJSON() ?? { bones: {} },
                easing: "linear",
            },
        });
        dispatch(stores, "pose.set-bone", {
            objectId: ACTOR_ID,
            boneKey,
            quaternion: [0, -0.2588190451, 0, 0.9659258263],
        });
        dispatch(stores, "pose.add-key", {
            trackId: POSE_TRACK_ID,
            targetId: ACTOR_ID,
            keyframe: {
                id: "pose-key-2",
                time: 2,
                value: stores.scene.manager.getEntity(ACTOR_ID)?.pose?.toJSON() ?? { bones: {} },
                easing: "smooth",
            },
        });
        assertAcceptance(stores.history.undo(stores).ok && stores.history.redo(stores).ok, "姿态关键帧撤销/重做失败");
        const missingBone = stores.dispatcher.dispatch(
            {
                type: "pose.set-bone",
                payload: { objectId: ACTOR_ID, boneKey: "root/missing", quaternion: [0, 0, 0, 1] },
            },
            stores,
        );
        assertAcceptance(
            !missingBone.ok && missingBone.issueDetails?.[0]?.code === "bone-not-found",
            "未知骨骼未给出 discover 恢复选项",
        );
        dispatch(stores, "transport.play", {});
        const playbackBlocked = stores.dispatcher.dispatch(
            { type: "pose.set-weight", payload: { objectId: ACTOR_ID, weight: 1 } },
            stores,
        );
        assertAcceptance(
            !playbackBlocked.ok && playbackBlocked.issueDetails?.[0]?.code === "pose-playback-active",
            "播放期间姿态编辑未禁用",
        );
        dispatch(stores, "transport.seek", { time: 1 });
        dispatch(stores, "transport.pause", {});
        stores.ui.setPosePicking(ACTOR_ID, boneKey);
        const nextFrame = Promise.withResolvers<void>();
        requestAnimationFrame(() => nextFrame.resolve());
        await nextFrame.promise;
        const captureResult = captureSink.waitForCapture();
        const timeout = Promise.withResolvers<never>();
        const timeoutId = setTimeout(() => timeout.reject(new Error("姿态验收: helper 排除截图未回传")), 3000);
        dispatch(stores, "capture.frame", { hideHelpers: true });
        const capture = await Promise.race([captureResult, timeout.promise]);
        clearTimeout(timeoutId);
        const helperLifecycle = stores.capture.lastHelperLifecycle;
        assertAcceptance(
            capture.width > 0 && capture.height > 0 && capture.blobUrl.startsWith("blob:"),
            "helper 排除截图未产生有效输出",
        );
        assertAcceptance(
            helperLifecycle?.hiddenPoseHelperCount !== undefined &&
                helperLifecycle.hiddenPoseHelperCount > 0 &&
                helperLifecycle.helpersRestored,
            "姿态 helper 未在截图中隐藏并恢复",
        );
        stores.ui.setPosePicking(null, null);
    };
    requestAnimationFrame(() => {
        void poll();
    });
}

const meta: Meta<typeof DirectorDesk> = {
    title: "DirectorDesk/Phase 2/Pose Refine Acceptance",
    component: DirectorDesk,
};

export default meta;
type Story = StoryObj<typeof DirectorDesk>;

function PoseRefineAcceptanceSurface() {
    const [captureSink] = useState(() => new PoseCaptureSink());
    return (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk host={captureSink} onReady={(stores) => seedPoseAcceptance(stores, captureSink)} />
        </div>
    );
}

/**
 * 验收：dispatcher-only 狐狸骨骼发现（唯一语义候选及原始树回退）、姿态权重、两帧四元数插值、撤销/重做、
 * runtime-not-ready 与 bone-not-found 结构化错误、播放期禁编，以及 helper 被 capture.frame 排除。
 */
export const 姿态精修命令验收: Story = {
    render: () => <PoseRefineAcceptanceSurface />,
};
