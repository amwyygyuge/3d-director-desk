/** 骨骼显示标签:主视觉使用中文语义;isFinger 供树层做手指链折叠。 */
export interface BoneLabel {
    /** 中文语义名:如「左肩」「右手食指·近节」;非 Mixamo 骨回退为分词后的原名 */
    readonly zh: string;
    /** 手指链成员:树层据此把整链折叠成一个分组行 */
    readonly isFinger: boolean;
}

/** Mixamo 导出前缀(humanoid-generic 实测为小写;其他导出器可能带冒号/大小写差异) */
const MIXAMO_PREFIX_PATTERN = /^mixamorig:?/i;

const SIDE_ZH: Readonly<Record<string, string>> = { Left: "左", Right: "右" };

/** 部位词表:mixamoSkeleton.ts 拓扑名的显示层映射;未收录的基部回退拉丁分词 */
const BASE_ZH: Readonly<Record<string, string>> = {
    Hips: "髋部",
    Spine: "脊柱",
    Neck: "颈部",
    Head: "头部",
    HeadTop_End: "头顶",
    Shoulder: "肩",
    Arm: "大臂",
    ForeArm: "小臂",
    Hand: "手腕",
    HandThumb: "拇指",
    HandIndex: "食指",
    HandMiddle: "中指",
    HandRing: "无名指",
    HandPinky: "小指",
    UpLeg: "大腿",
    Leg: "小腿",
    Foot: "脚",
    ToeBase: "脚趾",
    Toe_End: "脚尖",
};

/** 手指链基部表:isFinger 谓词的唯一判据 */
const FINGER_BASES: Readonly<Record<string, true>> = {
    HandThumb: true,
    HandIndex: true,
    HandMiddle: true,
    HandRing: true,
    HandPinky: true,
};

/** 指节序号 → 解剖名词(1=近节 … 4=末节);超出范围回退序号本身 */
const FINGER_SEGMENT_ZH = ["近节", "中节", "远节", "末节"] as const;

function splitCamelCase(name: string): string {
    return name
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Za-z])(\d)/g, "$1 $2")
        .replace(/_/g, " ");
}

function orderSuffix(base: string, order: number | null): string {
    if (order === null) return "";
    if (FINGER_BASES[base]) return `·${FINGER_SEGMENT_ZH[order - 1] ?? order}`;
    return ` ${order}`;
}

/**
 * 骨骼名 → 显示标签。解析层级:剥前缀 → 左右侧 → 基部 + 尾序号。
 * 任何一层不匹配都安全回退(显示分词原名),绝不抛错——第三方骨架命名不可预期。
 */
export function labelBone(boneName: string): BoneLabel {
    const stripped = boneName.replace(MIXAMO_PREFIX_PATTERN, "");
    const sideMatch = stripped.match(/^(Left|Right)/);
    const side = sideMatch?.[1] ?? null;
    const afterSide = side ? stripped.slice(side.length) : stripped;
    const orderMatch = afterSide.match(/^(.*?)(\d+)$/);
    const base = orderMatch?.[1] ?? afterSide;
    const order = orderMatch?.[2] ? Number(orderMatch[2]) : null;
    const baseZh = BASE_ZH[base] ?? splitCamelCase(afterSide);
    return {
        zh: `${side ? (SIDE_ZH[side] ?? "") : ""}${baseZh}${orderSuffix(base, order)}`,
        isFinger: FINGER_BASES[base] === true,
    };
}
