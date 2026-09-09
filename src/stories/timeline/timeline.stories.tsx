import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import { TEST_ASSETS } from "@/stories/seeds";
import { assertAcceptance, dispatchOk as dispatch, required, waitRuntime } from "@/stories/harness";

const ACTOR_ID = "timeline-actor";
const REMOVED_ACTOR_ID = "timeline-deleted";
const ACTOR_TRACK_ID = "transform-timeline-actor";
const REMOVED_TRACK_ID = "transform-timeline-deleted";

/** 走位轨首帧 0s / 末帧 4s;跨度外取样点取轨道之前与之后。 */
const SPAN_START_SECONDS = 0;
const SPAN_END_SECONDS = 4;
const AFTER_SPAN_SECONDS = 6;
const POSITION_EPSILON = 1e-6;

function sampledPositionAt(stores: DirectorDeskStores, timeSeconds: number): readonly number[] {
    dispatch(stores, "transport.seek", { time: timeSeconds });
    stores.playback.sampleCurrent();
    const runtime = stores.scene.manager.getRuntime(ACTOR_ID);
    return runtime ? [runtime.position.x, runtime.position.y, runtime.position.z] : [];
}

function isSamePosition(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length && left.every((v, i) => Math.abs(v - (right[i] ?? 0)) <= POSITION_EPSILON);
}

/**
 * 跨度外取值策略(默认 hold)。
 *
 * 回归的是「走完弹回原位」:此前轨道跨度外求值返回 false,回放协调器据此把对象
 * 写回实体权威变换——角色走到终点后瞬间弹回起点,轨道开始前同样会瞬移。
 */
function assertExtrapolationHoldsSpanEnds(stores: DirectorDeskStores): void {
    const spanEnd = sampledPositionAt(stores, SPAN_END_SECONDS);
    const afterSpan = sampledPositionAt(stores, AFTER_SPAN_SECONDS);
    assertAcceptance(isSamePosition(afterSpan, spanEnd), "走完轨迹后未停在终点(弹回了实体变换)");
    const spanStart = sampledPositionAt(stores, SPAN_START_SECONDS);
    assertAcceptance(!isSamePosition(spanStart, spanEnd), "首末帧位置相同,本验收无法证伪");
    // rest 是显式退路:切过去后跨度外重新交还实体变换,对象可被坐标轴自由摆放
    dispatch(stores, "timeline.set-track-policies", {
        trackId: ACTOR_TRACK_ID,
        policies: { extrapolation: "rest" },
    });
    const restAfterSpan = sampledPositionAt(stores, AFTER_SPAN_SECONDS);
    const entityTransform = required(stores.scene.manager.getEntity(ACTOR_ID)?.transform, "主对象缺失");
    assertAcceptance(isSamePosition(restAfterSpan, entityTransform.position), "rest 策略未把跨度外交还实体变换");
    dispatch(stores, "timeline.set-track-policies", {
        trackId: ACTOR_TRACK_ID,
        policies: { extrapolation: "hold" },
    });
    dispatch(stores, "transport.seek", { time: SPAN_START_SECONDS });
}

async function seedTimelineAcceptance(stores: DirectorDeskStores): Promise<void> {
    dispatch(stores, "object.place", {
        id: ACTOR_ID,
        kind: "model",
        sourceUrl: TEST_ASSETS.helmet,
        name: "时间轴主对象",
        transform: { position: [-2, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "object.place", {
        id: REMOVED_ACTOR_ID,
        kind: "model",
        sourceUrl: TEST_ASSETS.helmet,
        name: "删除轨道验收对象",
        transform: { position: [2, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: ACTOR_TRACK_ID,
        targetId: ACTOR_ID,
        keyframe: {
            id: "actor-key-start",
            time: 0,
            value: { position: [-2, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "linear",
        },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: ACTOR_TRACK_ID,
        targetId: ACTOR_ID,
        keyframe: {
            id: "actor-key-middle",
            time: 2,
            value: { position: [0, 1.5, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
            easing: "smooth",
        },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: ACTOR_TRACK_ID,
        targetId: ACTOR_ID,
        keyframe: {
            id: "actor-key-end",
            time: 4,
            value: { position: [2, 0.5, 0], rotation: [0, Math.PI, 0], scale: [1, 1, 1] },
            easing: "smooth",
        },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: REMOVED_TRACK_ID,
        targetId: REMOVED_ACTOR_ID,
        keyframe: {
            id: "deleted-key-start",
            time: 0,
            value: { position: [2, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "linear",
        },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: REMOVED_TRACK_ID,
        targetId: REMOVED_ACTOR_ID,
        keyframe: {
            id: "deleted-key-middle",
            time: 2,
            value: { position: [3, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "smooth",
        },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: REMOVED_TRACK_ID,
        targetId: REMOVED_ACTOR_ID,
        keyframe: {
            id: "deleted-key-end",
            time: 4,
            value: { position: [4, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "linear",
        },
    });
    dispatch(stores, "transport.play", {});
    dispatch(stores, "transport.seek", { time: 2 });
    dispatch(stores, "transport.pause", {});
    dispatch(stores, "transport.stop", {});
    dispatch(stores, "object.remove", { id: REMOVED_ACTOR_ID });
    stores.history.undo(stores);
    stores.history.redo(stores);
    stores.history.undo(stores);
    // 采样断言要读 Three 运行时位置,必须等模型加载绑定后再跑
    await waitRuntime(stores, ACTOR_ID);
    assertExtrapolationHoldsSpanEnds(stores);
}

const meta: Meta<typeof DirectorDesk> = {
    title: "时间轴/编排与回放",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/**
 * 验收：时间轴控制可见；dispatcher 播种关键帧、play/seek/pause；对象删除会原子清理轨道，Undo/Redo 后可恢复。
 * 回放只影响 Three 运行时，停止按钮可恢复权威实体变换。
 */
export const TimelineAuthoringAndPlayback: Story = {
    name: "打点与回放",
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk
                onReady={(stores) => {
                    void seedTimelineAcceptance(stores).catch((error: unknown) => {
                        stores.ui.setApplicationNotice(error instanceof Error ? error.message : String(error));
                    });
                }}
            />
        </div>
    ),
};
