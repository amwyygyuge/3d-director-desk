import { toJS } from "mobx";

import type { CommandDispatcher } from "@/command/CommandDispatcher";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { PayloadContract } from "@/command/PayloadContract";
import {
    forwardFromDirectorPose,
    horizontalForward,
    MOVE_OBJECT_COMMAND_TYPE,
    rightFor,
    yawFacing,
} from "@/command/placementCommands";
import { entityReadinessIssue, subjectBoundsFor } from "@/command/subjectBounds";
import type { Transform, Vec3 } from "@/core/SceneObject";

/** 布景配方 id:AI 只输出配方名 + 槽位绑定,零坐标(幻觉围栏上移一层) */
export const STAGE_PRESET = {
    /** 对峙双人:右侧对峙,互朝 */
    FACE_OFF: "face-off",
    /** 并肩同行:并排同朝观众 */
    SIDE_BY_SIDE: "side-by-side",
    /** 三角群像:顶角靠前,两翼对称靠后 */
    TRIANGLE: "triangle",
    /** 前后纵深:沿视线拉开 */
    DEPTH_LINEUP: "depth-lineup",
} as const;

export type StagePresetId = (typeof STAGE_PRESET)[keyof typeof STAGE_PRESET];

const STAGE_FACING = {
    /** 面朝锚槽位 */
    ANCHOR: "anchor",
    /** 与锚槽位互朝(锚的朝向一并改写) */
    MUTUAL: "mutual",
    /** 面朝观众(相机方向) */
    FORWARD: "forward",
} as const;

type StageFacing = (typeof STAGE_FACING)[keyof typeof STAGE_FACING];

/**
 * 槽位规格(纯数据,可序列化纪律):偏移以「本槽与锚槽的包围球半径和」为单位,
 * 配方因此尺度自适应——2 米人偶与 20 米机甲用同一配方摆出同样呼吸感。
 * offsetForward 1.0 即两包围球相切;<1 是合法艺术选择(穿插),校验不拦。
 */
export interface StageSlotSpec {
    readonly slot: string;
    /** null = 原点槽:保持其当前位置,其余槽位向它收拢 */
    readonly anchorSlot: string | null;
    readonly offsetRight: number;
    readonly offsetForward: number;
    readonly facing: StageFacing;
}

/** 内置配方表(数值是调参面:改了直接看效果,与 SHOT_SIZE_PARAMS 同纪律) */
const STAGE_PRESET_SPECS: Record<StagePresetId, readonly StageSlotSpec[]> = {
    [STAGE_PRESET.FACE_OFF]: [
        { slot: "a", anchorSlot: null, offsetRight: 0, offsetForward: 0, facing: STAGE_FACING.FORWARD },
        { slot: "b", anchorSlot: "a", offsetRight: 1.5, offsetForward: 0, facing: STAGE_FACING.MUTUAL },
    ],
    [STAGE_PRESET.SIDE_BY_SIDE]: [
        { slot: "a", anchorSlot: null, offsetRight: 0, offsetForward: 0, facing: STAGE_FACING.FORWARD },
        { slot: "b", anchorSlot: "a", offsetRight: 0.6, offsetForward: 0, facing: STAGE_FACING.FORWARD },
    ],
    [STAGE_PRESET.TRIANGLE]: [
        { slot: "a", anchorSlot: null, offsetRight: 0, offsetForward: 0, facing: STAGE_FACING.FORWARD },
        { slot: "b", anchorSlot: "a", offsetRight: 1.1, offsetForward: -0.8, facing: STAGE_FACING.FORWARD },
        { slot: "c", anchorSlot: "a", offsetRight: -1.1, offsetForward: -0.8, facing: STAGE_FACING.FORWARD },
    ],
    [STAGE_PRESET.DEPTH_LINEUP]: [
        { slot: "a", anchorSlot: null, offsetRight: 0, offsetForward: 0, facing: STAGE_FACING.FORWARD },
        { slot: "b", anchorSlot: "a", offsetRight: 0, offsetForward: -3, facing: STAGE_FACING.MUTUAL },
    ],
};

/** 槽位绑定度量:命令层用 subjectBoundsFor 取好,编译器保持纯函数 */
export interface StageSlotBinding {
    readonly center: Vec3;
    readonly radius: number;
    readonly transform: Transform;
}

export interface StageRequest {
    readonly spec: readonly StageSlotSpec[];
    readonly bindings: ReadonlyMap<string, StageSlotBinding>;
    /** 导演视线前向(未水平化;编译器内部归一) */
    readonly forward: Vec3;
}

/**
 * 布景配方编译器(领域服务,纯函数):槽位偏移 × 半径和 → 各槽位目标 Transform。
 * 参考系与 place-relative 一致(导演相机水平视线);原点槽不动位置。
 */
export class StagePresetCompiler {
    resolve(request: StageRequest): ReadonlyMap<string, Transform> {
        const forward = horizontalForward(request.forward);
        const right = rightFor(forward);
        const positions = this.resolvePositions(request, forward, right);
        const yaws = this.resolveYaws(request, positions, forward);
        const plan = new Map<string, Transform>();
        for (const [slot, position] of positions) {
            const binding = request.bindings.get(slot);
            if (!binding) continue;
            const [rotationX, , rotationZ] = binding.transform.rotation;
            plan.set(slot, {
                position,
                rotation: [rotationX, yaws.get(slot) ?? binding.transform.rotation[1], rotationZ],
                scale: binding.transform.scale,
            });
        }
        return plan;
    }

    private resolvePositions(request: StageRequest, forward: Vec3, right: Vec3): ReadonlyMap<string, Vec3> {
        const positions = new Map<string, Vec3>();
        for (const slotSpec of request.spec) {
            const binding = request.bindings.get(slotSpec.slot);
            if (!binding) continue;
            if (slotSpec.anchorSlot === null) {
                positions.set(slotSpec.slot, binding.transform.position);
                continue;
            }
            const anchor = request.bindings.get(slotSpec.anchorSlot);
            const anchorPosition = positions.get(slotSpec.anchorSlot);
            // 配方表内部依赖序由数据保证(锚槽先声明);缺锚是配方登记错误,跳过而非甩给调用方
            if (!anchor || !anchorPosition) continue;
            const radiiSum = anchor.radius + binding.radius;
            const offsetRight = slotSpec.offsetRight * radiiSum;
            const offsetForward = slotSpec.offsetForward * radiiSum;
            positions.set(slotSpec.slot, [
                anchorPosition[0] + right[0] * offsetRight + forward[0] * offsetForward,
                binding.transform.position[1],
                anchorPosition[2] + right[2] * offsetRight + forward[2] * offsetForward,
            ]);
        }
        return positions;
    }

    private resolveYaws(
        request: StageRequest,
        positions: ReadonlyMap<string, Vec3>,
        forward: Vec3,
    ): ReadonlyMap<string, number> {
        const yaws = new Map<string, number>();
        for (const slotSpec of request.spec) {
            const position = positions.get(slotSpec.slot);
            if (!position) continue;
            const anchorPosition = slotSpec.anchorSlot === null ? undefined : positions.get(slotSpec.anchorSlot);
            if (slotSpec.facing === STAGE_FACING.FORWARD) {
                // 面朝观众:目标点取视线反方向上的一点(相机侧)
                yaws.set(
                    slotSpec.slot,
                    yawFacing(position, [position[0] - forward[0], position[1], position[2] - forward[2]]),
                );
            } else if (anchorPosition) {
                yaws.set(slotSpec.slot, yawFacing(position, anchorPosition));
            }
        }
        // 互朝第二遍:锚槽朝向改指向伙伴,覆盖其自身 forward 朝向(对峙的「面对面」由此成立)
        for (const slotSpec of request.spec) {
            if (slotSpec.facing !== STAGE_FACING.MUTUAL || slotSpec.anchorSlot === null) continue;
            const position = positions.get(slotSpec.slot);
            const anchorPosition = positions.get(slotSpec.anchorSlot);
            if (position && anchorPosition) yaws.set(slotSpec.anchorSlot, yawFacing(anchorPosition, position));
        }
        return yaws;
    }
}

const stagePresetCompiler = new StagePresetCompiler();

const SCENE_EDIT_PERMISSION = "scene:edit";
const SCENE_APPLIES_WHEN = "director-desk.scene-v1";

const STAGE_CONTRACT: PayloadContract = {
    properties: {
        presetId: { type: "string", enum: Object.values(STAGE_PRESET) },
        slots: {
            type: "array",
            items: {
                type: "object",
                properties: { slot: { type: "string" }, objectId: { type: "string" } },
                required: ["slot", "objectId"],
            },
            minItems: 1,
        },
    },
    required: ["presetId", "slots"],
};

interface StageSlotPayload {
    readonly slot: string;
    readonly objectId: string;
}

interface StagePayload {
    readonly presetId: StagePresetId;
    readonly slots: readonly StageSlotPayload[];
}

function stageIssues(ctx: DirectorContext, payload: StagePayload): readonly CommandIssue[] {
    const spec = STAGE_PRESET_SPECS[payload.presetId];
    if (!spec)
        return [{ code: "stage-unknown-preset", path: "presetId", message: `未知布景配方 "${payload.presetId}"` }];
    const boundSlots = new Set(payload.slots.map((binding) => binding.slot));
    const hasDuplicateSlot = boundSlots.size !== payload.slots.length;
    const specSlots = new Set(spec.map((slotSpec) => slotSpec.slot));
    const missingSlots = spec.filter((slotSpec) => !boundSlots.has(slotSpec.slot)).map((slotSpec) => slotSpec.slot);
    const unknownSlots = payload.slots.filter((binding) => !specSlots.has(binding.slot)).map((binding) => binding.slot);
    const objectIds = payload.slots.map((binding) => binding.objectId);
    const hasDuplicateObject = new Set(objectIds).size !== objectIds.length;
    const boundEntities = payload.slots.flatMap((binding) => {
        const entity = ctx.scene.manager.getEntity(binding.objectId);
        return entity ? [{ binding, entity }] : [];
    });
    return [
        ...missingSlots.map((slot) => ({
            code: "stage-slot-missing",
            path: "slots",
            message: `配方缺少槽位 "${slot}" 的绑定`,
        })),
        ...unknownSlots.map((slot) => ({
            code: "stage-slot-unknown",
            path: "slots",
            message: `槽位 "${slot}" 不在配方中`,
        })),
        ...(hasDuplicateSlot ? [{ code: "stage-slot-duplicate", path: "slots", message: "同一槽位被重复绑定" }] : []),
        ...(hasDuplicateObject
            ? [{ code: "stage-duplicate-object", path: "slots", message: "同一对象绑定了多个槽位" }]
            : []),
        ...payload.slots.flatMap((binding) =>
            ctx.scene.manager.getEntity(binding.objectId)
                ? []
                : [{ code: "stage-object-not-found", path: "slots", message: `对象 "${binding.objectId}" 不存在` }],
        ),
        ...boundEntities.flatMap(({ binding, entity }) => {
            const issue = entityReadinessIssue(ctx, entity, "slots");
            return issue ? [{ ...issue, message: `槽位 "${binding.slot}":${issue.message}` }] : [];
        }),
    ];
}

/** 布景配方命令:一次把一组实体摆成预置关系构图;撤销一步全组回原 */
export class StageSceneCommand extends DirectorCommand<StagePayload> {
    static readonly TYPE = "scene.stage";
    readonly type = StageSceneCommand.TYPE;

    constructor(readonly payload: StagePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((issue) => issue.message);
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return stageIssues(ctx, this.payload);
    }

    execute(ctx: DirectorContext): void {
        const spec = STAGE_PRESET_SPECS[this.payload.presetId];
        if (!spec) return;
        const bindings = new Map(
            this.payload.slots.flatMap((binding) => {
                const bounds = subjectBoundsFor(ctx, binding.objectId);
                const entity = ctx.scene.manager.getEntity(binding.objectId);
                return bounds && entity ? [[binding.slot, { ...bounds, transform: entity.transform }]] : [];
            }),
        );
        const plan = stagePresetCompiler.resolve({ spec, bindings, forward: forwardFromDirectorPose(ctx) });
        for (const binding of this.payload.slots) {
            const transform = plan.get(binding.slot);
            if (transform) ctx.scene.updateTransform(binding.objectId, transform);
        }
    }

    /** 逐槽位回放旧 transform,撤销一步全组回原 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return this.payload.slots.flatMap((binding) => {
            const previous = ctx.scene.manager.getEntity(binding.objectId)?.transform;
            return previous
                ? [{ type: MOVE_OBJECT_COMMAND_TYPE, payload: { id: binding.objectId, transform: toJS(previous) } }]
                : [];
        });
    }
}

export function registerStageCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(StageSceneCommand.TYPE, (payload: StagePayload) => new StageSceneCommand(payload), {
        type: StageSceneCommand.TYPE,
        version: "1",
        kind: "command",
        permissions: [SCENE_EDIT_PERMISSION],
        appliesWhen: SCENE_APPLIES_WHEN,
        payload: STAGE_CONTRACT,
    });
}
