import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ContinuityIssue } from "../camera/ContinuityChecker";
import type { DirectorDeskStores } from "./DirectorDeskContext";
import { DirectorDesk } from "./DirectorDesk";

const SUBJECT_ID = "continuity-actor";
const LEFT_SHOT_ID = "continuity-left";
const RIGHT_SHOT_ID = "continuity-right";
const AMBIGUOUS_SHOT_ID = "continuity-ambiguous";
const TRACK_ID = "continuity-actor-transform";

function dispatch(stores: DirectorDeskStores, type: string, payload: unknown): void {
    const result = stores.dispatcher.dispatch({ type, payload }, stores);
    if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
}

function assertAcceptance(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`多机位一致性验收: ${message}`);
}

function check(stores: DirectorDeskStores): readonly ContinuityIssue[] {
    const result = stores.dispatcher.query(
        {
            type: "continuity.check",
            payload: {
                subjectId: SUBJECT_ID,
                shotIds: [LEFT_SHOT_ID, RIGHT_SHOT_ID],
                sampleTimes: [0, 2],
                teleportThreshold: 0.5,
            },
        },
        stores,
    );
    assertAcceptance(result.ok, "continuity.check 查询失败");
    const value = result.value as { readonly issues?: readonly ContinuityIssue[] };
    const issues = value.issues;
    if (!Array.isArray(issues)) throw new Error("多机位一致性验收: continuity.check 未返回 issues");
    return issues;
}

function verifyContinuityAcceptance(stores: DirectorDeskStores): void {
    const capabilities = stores.dispatcher.listCapabilities();
    for (const type of ["continuity.selection-options", "continuity.check"]) {
        const capability = capabilities.find((candidate) => candidate.type === type);
        assertAcceptance(
            capability?.kind === "query" && capability.permissions.includes("continuity:read"),
            `${type} 未注册为只读能力`,
        );
    }
    const options = stores.dispatcher.query({ type: "continuity.selection-options", payload: {} }, stores);
    assertAcceptance(options.ok, "continuity.selection-options 查询失败");
    const invalid = stores.dispatcher.query(
        {
            type: "continuity.check",
            payload: {
                subjectId: SUBJECT_ID,
                shotIds: [LEFT_SHOT_ID, LEFT_SHOT_ID],
                sampleTimes: [0, 2],
                teleportThreshold: 0.5,
            },
        },
        stores,
    );
    const invalidIssue = invalid.ok ? undefined : invalid.issueDetails?.[0];
    assertAcceptance(
        invalidIssue?.code === "continuity.duplicate-shot" && invalidIssue.path === "shotIds.1",
        "重复机位未返回稳定结构化错误",
    );

    const initialIssues = check(stores);
    stores.continuity.present(
        {
            subjectId: SUBJECT_ID,
            shotIds: [LEFT_SHOT_ID, RIGHT_SHOT_ID],
            sampleTimes: [0, 2],
            teleportThreshold: 0.5,
        },
        initialIssues,
    );
    assertAcceptance(
        initialIssues.some((issue) => issue.kind === "axis-crossing"),
        "越轴未被检出",
    );
    assertAcceptance(
        initialIssues.some((issue) => issue.kind === "teleport"),
        "无区间走位关键帧的突变未被检出",
    );
    assertAcceptance(stores.continuity.issues.length === initialIssues.length, "瞬时诊断未呈现查询结果");
    const ambiguous = stores.dispatcher.query(
        {
            type: "continuity.check",
            payload: {
                subjectId: SUBJECT_ID,
                shotIds: [LEFT_SHOT_ID, AMBIGUOUS_SHOT_ID],
                sampleTimes: [0, 0],
                teleportThreshold: 0.5,
            },
        },
        stores,
    );
    const ambiguousIssues = (ambiguous.ok ? ambiguous.value : undefined) as
        { readonly issues?: readonly ContinuityIssue[] } | undefined;
    assertAcceptance(
        ambiguousIssues?.issues?.some((issue) => issue.kind === "axis-ambiguous"),
        "轴线不明确未被检出",
    );

    dispatch(stores, "camera.set-shot", {
        id: RIGHT_SHOT_ID,
        shot: { position: [-6, 3, 2], target: [0, 0, 4], fov: 45 },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: TRACK_ID,
        targetId: SUBJECT_ID,
        keyframe: {
            id: "continuity-walk-key",
            time: 1,
            value: { position: [0.4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "linear",
        },
    });
    assertAcceptance(stores.continuity.issues.length === 0, "依赖变更后诊断未失效");
    const correctedIssues = check(stores);
    stores.continuity.present(
        {
            subjectId: SUBJECT_ID,
            shotIds: [LEFT_SHOT_ID, RIGHT_SHOT_ID],
            sampleTimes: [0, 2],
            teleportThreshold: 0.5,
        },
        correctedIssues,
    );
    assertAcceptance(correctedIssues.length === 0 && stores.continuity.issues.length === 0, "修正后诊断未收敛");
}

function seedContinuityAcceptance(stores: DirectorDeskStores): void {
    dispatch(stores, "object.place", {
        id: SUBJECT_ID,
        kind: "primitive",
        name: "演员",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: TRACK_ID,
        targetId: SUBJECT_ID,
        keyframe: {
            id: "continuity-key-start",
            time: 0,
            value: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "linear",
        },
    });
    dispatch(stores, "timeline.add-key", {
        trackId: TRACK_ID,
        targetId: SUBJECT_ID,
        keyframe: {
            id: "continuity-key-end",
            time: 10,
            value: { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            easing: "linear",
        },
    });
    dispatch(stores, "camera.set-shot", {
        id: LEFT_SHOT_ID,
        shot: { position: [-6, 3, 0], target: [0, 0, 4], fov: 45 },
    });
    dispatch(stores, "camera.set-shot", {
        id: RIGHT_SHOT_ID,
        shot: { position: [6, 3, 0], target: [0, 0, 4], fov: 45 },
    });
    dispatch(stores, "camera.set-shot", {
        id: AMBIGUOUS_SHOT_ID,
        shot: { position: [-3, 3, 0], target: [0, 0, 0], fov: 45 },
    });
    verifyContinuityAcceptance(stores);
}

const meta: Meta<typeof DirectorDesk> = {
    title: "验收/阶段二 多机位一致性",
    component: DirectorDesk,
};

export default meta;

type Story = StoryObj<typeof DirectorDesk>;

/**
 * 验收：仅经 dispatcher 播种主体、时间轴和机位；查询能力先报告越轴与无区间走位关键帧的位移突变，
 * 再经机位与关键帧命令修正并收敛。面板可手动选择主体、机位顺序、采样时间和阈值，问题点击仅高亮相关机位。
 */
export const 多机位一致性查询验收: Story = {
    render: () => (
        <div style={{ width: "100vw", height: "100vh" }}>
            <DirectorDesk onReady={seedContinuityAcceptance} />
        </div>
    ),
};
