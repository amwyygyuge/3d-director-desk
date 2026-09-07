import type { QuaternionTuple } from "@/pose/PoseSnapshot";

/** 骨骼家族标识:与 AssetEntry.skeletonFamily 同词表,体型解算与姿势库的兼容前置声明。 */
export const SKELETON_FAMILY_MIXAMO = "mixamo";

/** Mixamo 骨骼统一前缀(humanoid-generic.glb 实测);禁在别处硬编码字符串拼接。 */
const BONE_PREFIX = "mixamorig";

function bone(shortName: string): string {
    return `${BONE_PREFIX}${shortName}`;
}

/** 身体部位:姿势预设的作用域掩码,也是组合器两列的领域依据。 */
export const BODY_PART = {
    LOWER: "lower",
    UPPER: "upper",
    FULL: "full",
} as const;
export type BodyPart = (typeof BODY_PART)[keyof typeof BODY_PART];

const BODY_PARTS: readonly string[] = Object.values(BODY_PART);

export function isBodyPart(value: unknown): value is BodyPart {
    return typeof value === "string" && BODY_PARTS.includes(value);
}

interface BoneNodeSpec {
    readonly name: string;
    readonly children?: readonly BoneNodeSpec[];
}

function fingerChain(side: string): BoneNodeSpec {
    return {
        name: bone(`${side}HandIndex1`),
        children: [
            {
                name: bone(`${side}HandIndex2`),
                children: [{ name: bone(`${side}HandIndex3`), children: [{ name: bone(`${side}HandIndex4`) }] }],
            },
        ],
    };
}

function armChain(side: string): BoneNodeSpec {
    return {
        name: bone(`${side}Shoulder`),
        children: [
            {
                name: bone(`${side}Arm`),
                children: [
                    {
                        name: bone(`${side}ForeArm`),
                        children: [{ name: bone(`${side}Hand`), children: [fingerChain(side)] }],
                    },
                ],
            },
        ],
    };
}

function legChain(side: string): BoneNodeSpec {
    return {
        name: bone(`${side}UpLeg`),
        children: [
            {
                name: bone(`${side}Leg`),
                children: [
                    {
                        name: bone(`${side}Foot`),
                        children: [{ name: bone(`${side}ToeBase`), children: [{ name: bone(`${side}Toe_End`) }] }],
                    },
                ],
            },
        ],
    };
}

const SIDE_LEFT = "Left";
const SIDE_RIGHT = "Right";

const SPINE_SUBTREE: BoneNodeSpec = {
    name: bone("Spine"),
    children: [
        {
            name: bone("Spine1"),
            children: [
                {
                    name: bone("Spine2"),
                    children: [
                        {
                            name: bone("Neck"),
                            children: [{ name: bone("Head"), children: [{ name: bone("HeadTop_End") }] }],
                        },
                        armChain(SIDE_LEFT),
                        armChain(SIDE_RIGHT),
                    ],
                },
            ],
        },
    ],
};

/** 骨架拓扑(33 joints,与 humanoid-generic.glb 实测一致):父子关系与部位掩码的唯一来源。 */
const MIXAMO_TREE: BoneNodeSpec = {
    name: bone("Hips"),
    children: [SPINE_SUBTREE, legChain(SIDE_LEFT), legChain(SIDE_RIGHT)],
};

function flattenNames(node: BoneNodeSpec): readonly string[] {
    return [node.name, ...(node.children ?? []).flatMap(flattenNames)];
}

function collectParents(node: BoneNodeSpec, parent: string | null): readonly (readonly [string, string | null])[] {
    return [
        [node.name, parent] as const,
        ...(node.children ?? []).flatMap((child) => collectParents(child, node.name)),
    ];
}

/** 深度优先顺序:父恒排在子之前,体型解算单遍累计父缩放即可,无需回溯。 */
export const MIXAMO_BONE_ORDER: readonly string[] = flattenNames(MIXAMO_TREE);

const MIXAMO_PARENTS: ReadonlyMap<string, string | null> = new Map(collectParents(MIXAMO_TREE, null));

export function mixamoParentOf(boneName: string): string | null {
    return MIXAMO_PARENTS.get(boneName) ?? null;
}

export function isMixamoBone(boneName: string): boolean {
    return MIXAMO_PARENTS.has(boneName);
}

/**
 * 动作资产的目标名归一到本仓 rig:Mixamo 导出可能是 mixamorig:Hips、
 * Blender 重新导出的 Armature:Hips,或 Unity 解包后的 Hips。
 */
export function normalizeMixamoBoneName(boneName: string): string | null {
    if (isMixamoBone(boneName)) return boneName;
    const withoutNamespace = boneName.split(":").pop() ?? boneName;
    const shortName = withoutNamespace.replace(/^Armature(?=mixamorig|[A-Z])/, "");
    const normalized = bone(shortName);
    return isMixamoBone(normalized) ? normalized : null;
}

const LOWER_BONES: readonly string[] = [
    MIXAMO_TREE.name,
    ...flattenNames(legChain(SIDE_LEFT)),
    ...flattenNames(legChain(SIDE_RIGHT)),
];
const UPPER_BONES: readonly string[] = flattenNames(SPINE_SUBTREE);

/**
 * 部位 → 骨骼名集合。上下半身互补且不相交(Hips 归下半身:坐卧姿的整体朝向由它决定),
 * 因此两个局部姿势的稀疏并集即是完整姿势,无需额外冲突消解。
 */
export const MIXAMO_PART_BONES: Record<BodyPart, readonly string[]> = {
    [BODY_PART.LOWER]: LOWER_BONES,
    [BODY_PART.UPPER]: UPPER_BONES,
    [BODY_PART.FULL]: MIXAMO_BONE_ORDER,
};

/** 躯干围度作用骨:胖瘦的主体量感。 */
export const MIXAMO_TORSO_GIRTH_BONES: readonly string[] = [bone("Spine"), bone("Spine1"), bone("Spine2")];

/** 四肢围度作用骨:与躯干同向但按 LIMB_GIRTH_RATIO 减弱,避免手臂随躯干等比膨胀。 */
export const MIXAMO_LIMB_GIRTH_BONES: readonly string[] = [
    bone(`${SIDE_LEFT}UpLeg`),
    bone(`${SIDE_LEFT}Leg`),
    bone(`${SIDE_RIGHT}UpLeg`),
    bone(`${SIDE_RIGHT}Leg`),
    bone(`${SIDE_LEFT}Arm`),
    bone(`${SIDE_LEFT}ForeArm`),
    bone(`${SIDE_RIGHT}Arm`),
    bone(`${SIDE_RIGHT}ForeArm`),
];

/** 肩宽作用骨:Shoulder 的局部 +Y 指向 Arm(实测 rest 偏移 [0,13.695,0]),故纵向缩放即横向加宽。 */
export const MIXAMO_SHOULDER_BONES: readonly string[] = [bone(`${SIDE_LEFT}Shoulder`), bone(`${SIDE_RIGHT}Shoulder`)];

/** 姿势库的数据形态:骨骼名 → 局部绝对旋转;跨模型可移植,运行时再换算 BoneKey。 */
export type BoneRotationsByName = Readonly<Record<string, QuaternionTuple>>;
