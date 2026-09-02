import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { DirectorDesk } from "@/ui/shell/DirectorDesk";
import { TEST_ASSETS } from "@/stories/acceptance/seeds";

const ACTOR_ID = "timeline-actor";
const REMOVED_ACTOR_ID = "timeline-deleted";
const ACTOR_TRACK_ID = "transform-timeline-actor";
const REMOVED_TRACK_ID = "transform-timeline-deleted";

function dispatch(stores: DirectorDeskStores, type: string, payload: unknown): void {
    const result = stores.dispatcher.dispatch({ type, payload }, stores);
    if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
}

function seedTimelineAcceptance(stores: DirectorDeskStores): void {
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
}

const meta: Meta<typeof DirectorDesk> = {
    title: "DirectorDesk/Phase 2/Timeline Acceptance",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/**
 * 验收：时间轴控制可见；dispatcher 播种关键帧、play/seek/pause；对象删除会原子清理轨道，Undo/Redo 后可恢复。
 * 回放只影响 Three 运行时，停止按钮可恢复权威实体变换。
 */
export const TimelineAuthoringAndPlayback: Story = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedTimelineAcceptance} />
        </div>
    ),
};
