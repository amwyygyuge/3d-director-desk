import type { QuaternionTuple } from "@/pose/PoseSnapshot";

/**
 * 骨骼家族标识:与 AssetEntry.skeletonFamily 同词表,体型解算与姿势库的兼容前置声明。
 *
 * 取 "ue" 而非厂商名:命名沿用 Unreal Engine 的标准人形骨骼词表
 * (root/pelvis/spine_01/clavicle_l/upperarm_l/thigh_l…),
 * 任何遵循该词表的资产都能直接互换动作,不绑定单一资产来源。
 */
export const SKELETON_FAMILY_UE = "ue";

/**
 * 根骨:承载 root motion 的容器骨,**不属于**任何身体部位。
 *
 * 位置与朝向由实体 transform 独占(见 MountActionCommand 与动作烘制脚本),
 * 故根骨既不进姿势预设、也不接收动作轨道——留在拓扑里只为表达父子关系的完整性。
 */
const ROOT_BONE = "root";

/** 骨盆:骨架的实际起点,坐卧姿的整体朝向由它决定。 */
const PELVIS_BONE = "pelvis";

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

const SIDE_LEFT = "l";
const SIDE_RIGHT = "r";

/** 手指名:五指齐全,每指 3 节 + 一个 leaf 末端(末端不参与蒙皮,仅定位指尖)。 */
const FINGER_BASES: readonly string[] = ["thumb", "index", "middle", "ring", "pinky"];

/** 指节链:`index_01_l → index_02_l → index_03_l → index_04_leaf_l`。 */
function fingerChain(base: string, side: string): BoneNodeSpec {
    return {
        name: `${base}_01_${side}`,
        children: [
            {
                name: `${base}_02_${side}`,
                children: [{ name: `${base}_03_${side}`, children: [{ name: `${base}_04_leaf_${side}` }] }],
            },
        ],
    };
}

function armChain(side: string): BoneNodeSpec {
    return {
        name: `clavicle_${side}`,
        children: [
            {
                name: `upperarm_${side}`,
                children: [
                    {
                        name: `lowerarm_${side}`,
                        children: [
                            { name: `hand_${side}`, children: FINGER_BASES.map((base) => fingerChain(base, side)) },
                        ],
                    },
                ],
            },
        ],
    };
}

function legChain(side: string): BoneNodeSpec {
    return {
        name: `thigh_${side}`,
        children: [
            {
                name: `calf_${side}`,
                children: [
                    {
                        name: `foot_${side}`,
                        children: [{ name: `ball_${side}`, children: [{ name: `ball_leaf_${side}` }] }],
                    },
                ],
            },
        ],
    };
}

const SPINE_SUBTREE: BoneNodeSpec = {
    name: "spine_01",
    children: [
        {
            name: "spine_02",
            children: [
                {
                    name: "spine_03",
                    children: [
                        { name: "neck_01", children: [{ name: "Head" }] },
                        armChain(SIDE_LEFT),
                        armChain(SIDE_RIGHT),
                    ],
                },
            ],
        },
    ],
};

/** 骨架拓扑(65 joints,与 humanoid-generic.glb 实测一致):父子关系与部位掩码的唯一来源。 */
const SKELETON_TREE: BoneNodeSpec = {
    name: ROOT_BONE,
    children: [
        {
            name: PELVIS_BONE,
            children: [SPINE_SUBTREE, legChain(SIDE_LEFT), legChain(SIDE_RIGHT)],
        },
    ],
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
export const SKELETON_BONE_ORDER: readonly string[] = flattenNames(SKELETON_TREE);

const BONE_PARENTS: ReadonlyMap<string, string | null> = new Map(collectParents(SKELETON_TREE, null));

export function skeletonParentOf(boneName: string): string | null {
    return BONE_PARENTS.get(boneName) ?? null;
}

export function isSkeletonBone(boneName: string): boolean {
    return BONE_PARENTS.has(boneName);
}

/**
 * 部位 → 骨骼名集合。上下半身互补且不相交(pelvis 归下半身:坐卧姿的整体朝向由它决定),
 * 因此两个局部姿势的稀疏并集即是完整姿势,无需额外冲突消解。
 *
 * 根骨不属于任何部位,故 LOWER ∪ UPPER ⊊ FULL——FULL 只用于「整体」作用域,
 * 而 lower/upper 的并集是姿势预设能覆盖的全部骨骼。
 */
const LOWER_BONES: readonly string[] = [
    PELVIS_BONE,
    ...flattenNames(legChain(SIDE_LEFT)),
    ...flattenNames(legChain(SIDE_RIGHT)),
];
const UPPER_BONES: readonly string[] = flattenNames(SPINE_SUBTREE);

export const SKELETON_PART_BONES: Record<BodyPart, readonly string[]> = {
    [BODY_PART.LOWER]: LOWER_BONES,
    [BODY_PART.UPPER]: UPPER_BONES,
    [BODY_PART.FULL]: [...LOWER_BONES, ...UPPER_BONES],
};

/** 躯干围度作用骨:胖瘦的主体量感。 */
export const SKELETON_TORSO_GIRTH_BONES: readonly string[] = ["spine_01", "spine_02", "spine_03"];

/** 四肢围度作用骨:与躯干同向但按 LIMB_GIRTH_RATIO 减弱,避免手臂随躯干等比膨胀。 */
export const SKELETON_LIMB_GIRTH_BONES: readonly string[] = [
    `thigh_${SIDE_LEFT}`,
    `calf_${SIDE_LEFT}`,
    `thigh_${SIDE_RIGHT}`,
    `calf_${SIDE_RIGHT}`,
    `upperarm_${SIDE_LEFT}`,
    `lowerarm_${SIDE_LEFT}`,
    `upperarm_${SIDE_RIGHT}`,
    `lowerarm_${SIDE_RIGHT}`,
];

/** 肩宽作用骨:clavicle 的局部 +Y 指向 upperarm(实测 rest 偏移 [0.019,0.141,0.081]),故纵向缩放即横向加宽。 */
export const SKELETON_SHOULDER_BONES: readonly string[] = [`clavicle_${SIDE_LEFT}`, `clavicle_${SIDE_RIGHT}`];

/** 姿势库的数据形态:骨骼名 → 局部绝对旋转;跨模型可移植,运行时再换算 BoneKey。 */
export type BoneRotationsByName = Readonly<Record<string, QuaternionTuple>>;
