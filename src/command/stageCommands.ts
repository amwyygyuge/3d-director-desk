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
} from "@/command/placementCommands";
import { entityReadinessIssue, subjectBoundsFor } from "@/command/subjectBounds";
import type { Transform, Vec3 } from "@/core/SceneObject";
import { MountActionCommand } from "@/command/actionCommands";
import { ApplyPosePresetCommand, ReplacePoseCommand } from "@/command/poseCommands";
import { VEC3_SCHEMA } from "@/command/PayloadContract";
import { finiteVec3 } from "@/core/SceneObject";

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
    /** 面朝指定世界点(gaze=point) */
    POINT: "point",
} as const;

type StageFacing = (typeof STAGE_FACING)[keyof typeof STAGE_FACING];

/** 视线朝向(AI 语汇):覆盖配方槽位默认 facing,让「谁看谁」成为可表达的表演信号 */
export const STAGE_GAZE = {
    ANCHOR: "anchor",
    MUTUAL: "mutual",
    CAMERA: "camera",
    POINT: "point",
} as const;
export type StageGaze = (typeof STAGE_GAZE)[keyof typeof STAGE_GAZE];

/** gaze → 编译器 facing 映射(禁并列 if;point 另需 lookAt) */
const GAZE_FACING: Record<StageGaze, StageFacing> = {
    [STAGE_GAZE.ANCHOR]: STAGE_FACING.ANCHOR,
    [STAGE_GAZE.MUTUAL]: STAGE_FACING.MUTUAL,
    [STAGE_GAZE.CAMERA]: STAGE_FACING.FORWARD,
    [STAGE_GAZE.POINT]: STAGE_FACING.POINT,
};

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
    /** facing=point 时的世界注视点 */
    readonly lookAt?: Vec3;
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

/** 配方槽位清单(UI 布景面板据此渲染槽位行;唯一真相源,禁 UI 侧硬编码) */
export function stagePresetSlots(presetId: StagePresetId): readonly string[] {
    return STAGE_PRESET_SPECS[presetId].map((slotSpec) => slotSpec.slot);
}

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
    /** 构图修饰;缺省 = 中性(等价不传),打破对称配方同质化 */
    readonly composition?: StageComposition;
}

/** +Z 朝向目标的偏航角(与 place-relative 的 facing 同一惯例,glTF 角色面朝 +Z) */
function yawToward(from: Vec3, to: Vec3): number {
    return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

/**
 * 构图修饰(值对象,可序列化纪律):在对称配方基础上叠加非对称/疏密/确定性抖动,
 * 打破「同一配方永远长一样」的模板感。全部以包围球半径和为单位,尺度自适应。
 */
export interface StageComposition {
    /** 侧向偏置 [-1,1]:整体向右(+)/左(-)偏,对应三分法构图权重 */
    readonly balance: number;
    /** 间距缩放 (0,3]:>1 更疏、<1 更密 */
    readonly spread: number;
    /** 抖动种子;0 = 不抖动。同种子产出可复现 */
    readonly seed: number;
}

/** 线上传入形态:字段可缺省,execute 前归一为完整 StageComposition */
export interface StageCompositionInput {
    readonly balance?: number;
    readonly spread?: number;
    readonly seed?: number;
}

/** 中性构图 = 与「不传 composition」等价:无偏置、原始间距、不抖动 */
export const DEFAULT_STAGE_COMPOSITION: StageComposition = { balance: 0, spread: 1, seed: 0 };

/** balance 的侧向偏置增益(半径和为单位) */
const BALANCE_GAIN = 0.6;
/** 位置抖动幅度(半径和为单位) */
const POSITION_JITTER = 0.12;
/** 偏航抖动幅度(弧度,约 2.9°) */
const YAW_JITTER = 0.05;
/** 抖动通道盐:同槽不同通道取不同噪声,避免右/前/偏航同相 */
const RIGHT_SALT_CHANNEL = 0;
const FORWARD_SALT_CHANNEL = 1;
const YAW_SALT_CHANNEL = 2;

/** 构图参数合法域(校验用;编译器不二次夹取,幻觉围栏在 validate) */
export const STAGE_COMPOSITION_RANGE = {
    balance: { min: -1, max: 1 },
    spread: { min: 0.25, max: 3 },
} as const;

/** 确定性单位噪声 [0,1):同一 (seed,salt) 恒等,构图抖动因此可复现(splitmix 变体) */
function hashUnit(seed: number, salt: number): number {
    const mixed = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
    const spread = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad) >>> 0;
    const folded = Math.imul(spread ^ (spread >>> 15), 0x735a2d97) >>> 0;
    return ((folded ^ (folded >>> 15)) >>> 0) / 0x1_0000_0000;
}

/** 居中到 [-0.5,0.5):有符号抖动 */
function signedNoise(seed: number, salt: number): number {
    return hashUnit(seed, salt) - 0.5;
}

/** 槽位名 × 通道 → 稳定 32 位盐 */
function saltFor(slot: string, channel: number): number {
    return [...slot].reduce((acc, ch) => (Math.imul(acc, 31) + ch.charCodeAt(0)) >>> 0, (channel + 1) * 0x1000) >>> 0;
}

/** 归一线上传入:缺省字段填中性值 */
export function normalizeComposition(input: StageCompositionInput | undefined): StageComposition {
    if (!input) return DEFAULT_STAGE_COMPOSITION;
    return {
        balance: input.balance ?? DEFAULT_STAGE_COMPOSITION.balance,
        spread: input.spread ?? DEFAULT_STAGE_COMPOSITION.spread,
        seed: input.seed ?? DEFAULT_STAGE_COMPOSITION.seed,
    };
}

/**
 * 构图修饰:spread 缩放间距、balance 侧向偏置、seed 确定性抖动;
 * 锚槽(anchorSlot=null,无偏移)保持不动,只修饰其余槽位。
 */
function modulateSpec(spec: readonly StageSlotSpec[], composition: StageComposition): readonly StageSlotSpec[] {
    if (composition.balance === 0 && composition.spread === 1 && composition.seed === 0) return spec;
    const jitter = composition.seed === 0 ? 0 : POSITION_JITTER;
    return spec.map((slotSpec) => {
        if (slotSpec.anchorSlot === null) return slotSpec;
        const rightJitter = signedNoise(composition.seed, saltFor(slotSpec.slot, RIGHT_SALT_CHANNEL)) * jitter;
        const forwardJitter = signedNoise(composition.seed, saltFor(slotSpec.slot, FORWARD_SALT_CHANNEL)) * jitter;
        return {
            ...slotSpec,
            offsetRight: slotSpec.offsetRight * composition.spread + composition.balance * BALANCE_GAIN + rightJitter,
            offsetForward: slotSpec.offsetForward * composition.spread + forwardJitter,
        };
    });
}

/** 偏航抖动:seed=0 原样返回;否则每槽叠加确定性微抖,消解「面朝观众」的机械同相 */
function jitterYaws(yaws: ReadonlyMap<string, number>, composition: StageComposition): ReadonlyMap<string, number> {
    if (composition.seed === 0) return yaws;
    return new Map(
        [...yaws].map(([slot, yaw]) => [
            slot,
            yaw + signedNoise(composition.seed, saltFor(slot, YAW_SALT_CHANNEL)) * YAW_JITTER,
        ]),
    );
}

/**
 * 布景配方编译器(领域服务,纯函数):槽位偏移 × 半径和 → 各槽位目标 Transform。
 * 参考系与 place-relative 一致(导演相机水平视线);原点槽不动位置。
 */
export class StagePresetCompiler {
    resolve(request: StageRequest): ReadonlyMap<string, Transform> {
        const composition = request.composition ?? DEFAULT_STAGE_COMPOSITION;
        const modulated = { ...request, spec: modulateSpec(request.spec, composition) };
        const forward = horizontalForward(request.forward);
        const right = rightFor(forward);
        const positions = this.resolvePositions(modulated, forward, right);
        const yaws = jitterYaws(this.resolveYaws(modulated, positions, forward), composition);
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

    private yawForSlot(
        slotSpec: StageSlotSpec,
        position: Vec3,
        anchorPosition: Vec3 | undefined,
        forward: Vec3,
    ): number | null {
        switch (slotSpec.facing) {
            case STAGE_FACING.FORWARD:
                return yawToward(position, [position[0] - forward[0], position[1], position[2] - forward[2]]);
            case STAGE_FACING.POINT:
                return slotSpec.lookAt ? yawToward(position, slotSpec.lookAt) : null;
            default:
                return anchorPosition ? yawToward(position, anchorPosition) : null;
        }
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
            const yaw = this.yawForSlot(slotSpec, position, anchorPosition, forward);
            if (yaw !== null) yaws.set(slotSpec.slot, yaw);
        }
        // 互朝第二遍:锚槽朝向改指向伙伴,覆盖其自身 forward 朝向(对峙的「面对面」由此成立)
        for (const slotSpec of request.spec) {
            if (slotSpec.facing !== STAGE_FACING.MUTUAL || slotSpec.anchorSlot === null) continue;
            const position = positions.get(slotSpec.slot);
            const anchorPosition = positions.get(slotSpec.anchorSlot);
            if (position && anchorPosition) yaws.set(slotSpec.anchorSlot, yawToward(anchorPosition, position));
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
                properties: {
                    slot: { type: "string" },
                    objectId: { type: "string" },
                    poseHint: { type: "string" },
                    gaze: { type: "string", enum: Object.values(STAGE_GAZE) },
                    gazePoint: VEC3_SCHEMA,
                },
                required: ["slot", "objectId"],
            },
            minItems: 1,
        },
        composition: {
            type: "object",
            properties: {
                balance: { type: "number" },
                spread: { type: "number" },
                seed: { type: "number" },
            },
        },
    },
    required: ["presetId", "slots"],
};

interface StageSlotPayload {
    readonly slot: string;
    readonly objectId: string;
    /** 姿势预设 id(引用 pose.presets 目录);缺省不改姿势 */
    readonly poseHint?: string;
    /** 视线朝向覆盖;缺省用配方默认 facing */
    readonly gaze?: StageGaze;
    /** gaze=point 时的世界注视点 */
    readonly gazePoint?: Vec3;
}

interface StagePayload {
    readonly presetId: StagePresetId;
    readonly slots: readonly StageSlotPayload[];
    readonly composition?: StageCompositionInput;
}

/** gaze 覆盖:按 payload 逐槽改写配方 facing/lookAt;缺 gaze 的槽保持配方默认 */
function gazedSpec(spec: readonly StageSlotSpec[], slots: readonly StageSlotPayload[]): readonly StageSlotSpec[] {
    return spec.map((slotSpec) => {
        const payload = slots.find((slot) => slot.slot === slotSpec.slot);
        if (!payload?.gaze) return slotSpec;
        const facing = GAZE_FACING[payload.gaze];
        return payload.gazePoint ? { ...slotSpec, facing, lookAt: payload.gazePoint } : { ...slotSpec, facing };
    });
}

function rangeIssue(
    field: string,
    value: number | undefined,
    range: { readonly min: number; readonly max: number },
): readonly CommandIssue[] {
    if (value === undefined) return [];
    const valid = Number.isFinite(value) && value >= range.min && value <= range.max;
    return valid
        ? []
        : [
              {
                  code: "stage-composition-range",
                  path: `composition.${field}`,
                  message: `${field} 需在 [${range.min}, ${range.max}] 内`,
              },
          ];
}

function seedIssue(seed: number | undefined): readonly CommandIssue[] {
    if (seed === undefined) return [];
    const valid = Number.isFinite(seed) && Number.isInteger(seed) && seed >= 0;
    return valid ? [] : [{ code: "stage-composition-seed", path: "composition.seed", message: "seed 需为非负整数" }];
}

/** 构图参数校验:缺省合法,越界/非有限/种子非整报结构化 issue */
function compositionIssues(input: StageCompositionInput | undefined): readonly CommandIssue[] {
    if (!input) return [];
    return [
        ...rangeIssue("balance", input.balance, STAGE_COMPOSITION_RANGE.balance),
        ...rangeIssue("spread", input.spread, STAGE_COMPOSITION_RANGE.spread),
        ...seedIssue(input.seed),
    ];
}

function gazeIssues(payload: StagePayload): readonly CommandIssue[] {
    return payload.slots.flatMap((slot) =>
        slot.gaze === STAGE_GAZE.POINT && !finiteVec3(slot.gazePoint)
            ? [
                  {
                      code: "stage-gaze-point-invalid",
                      path: "slots",
                      message: `槽位 "${slot.slot}":gaze=point 需要有限的 gazePoint`,
                  },
              ]
            : [],
    );
}

/** 姿势预设可用性:复用 ApplyPosePresetCommand 校验(地基优先,禁重写骨骼兼容判定) */
function poseHintIssues(ctx: DirectorContext, payload: StagePayload): readonly CommandIssue[] {
    return payload.slots.flatMap((slot) =>
        slot.poseHint
            ? new ApplyPosePresetCommand({ objectId: slot.objectId, presetId: slot.poseHint })
                  .validateIssues(ctx)
                  .map((issue) => ({ ...issue, message: `槽位 "${slot.slot}" 姿势:${issue.message}` }))
            : [],
    );
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
        ...compositionIssues(payload.composition),
        ...gazeIssues(payload),
        ...poseHintIssues(ctx, payload),
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
        this.applyPoses(ctx);
        const bindings = new Map(
            this.payload.slots.flatMap((binding) => {
                const bounds = subjectBoundsFor(ctx, binding.objectId);
                const entity = ctx.scene.manager.getEntity(binding.objectId);
                return bounds && entity ? [[binding.slot, { ...bounds, transform: entity.transform }]] : [];
            }),
        );
        const plan = stagePresetCompiler.resolve({
            spec: gazedSpec(spec, this.payload.slots),
            bindings,
            forward: forwardFromDirectorPose(ctx),
            composition: normalizeComposition(this.payload.composition),
        });
        for (const binding of this.payload.slots) {
            const transform = plan.get(binding.slot);
            if (transform) ctx.scene.updateTransform(binding.objectId, transform);
        }
    }

    /** 姿势先落(会重接地改变 Y),站位随后按已摆姿的包围球定位;撤销由本命令 invert 统一回滚 */
    private applyPoses(ctx: DirectorContext): void {
        for (const slot of this.payload.slots) {
            if (!slot.poseHint) continue;
            new ApplyPosePresetCommand({ objectId: slot.objectId, presetId: slot.poseHint }).execute(ctx);
        }
    }

    /** 撤销一步全组回原:摆姿槽位先回姿势再回精确 transform,曾挂动作一并复位 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return this.payload.slots.flatMap((binding) => {
            const entity = ctx.scene.manager.getEntity(binding.objectId);
            if (!entity) return [];
            return [
                ...(binding.poseHint
                    ? [
                          {
                              type: ReplacePoseCommand.TYPE,
                              payload: { objectId: entity.id, pose: entity.pose?.toJSON() ?? null },
                          },
                      ]
                    : []),
                { type: MOVE_OBJECT_COMMAND_TYPE, payload: { id: binding.objectId, transform: toJS(entity.transform) } },
                ...(binding.poseHint && entity.actionId
                    ? [{ type: MountActionCommand.TYPE, payload: { objectId: entity.id, actionId: entity.actionId } }]
                    : []),
            ];
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
