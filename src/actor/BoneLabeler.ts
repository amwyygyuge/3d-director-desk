/** 骨骼显示标签:主视觉使用中文语义;isFinger 供树层做手指链折叠。 */
export interface BoneLabel {
    /** 中文语义名:如「左肩」「右手食指·近节」;非本仓骨架回退为分词后的原名 */
    readonly zh: string;
    /** 手指链成员:树层据此把整链折叠成一个分组行 */
    readonly isFinger: boolean;
}

/**
 * UE 骨骼命名的左右侧后缀:`_l` / `_r`。
 *
 * 必须锚定末尾:`ball_l` 的 `l` 是侧,而 `pelvis` 里的字母不是。
 */
const SIDE_SUFFIX_PATTERN = /_(l|r)$/;

const SIDE_ZH: Readonly<Record<string, string>> = { l: "左", r: "右" };

/** 部位词表:actorSkeleton.ts 拓扑名的显示层映射;未收录的基部回退拉丁分词 */
const BASE_ZH: Readonly<Record<string, string>> = {
    root: "根",
    pelvis: "髋部",
    spine: "脊柱",
    neck: "颈部",
    Head: "头部",
    clavicle: "肩",
    upperarm: "大臂",
    lowerarm: "小臂",
    hand: "手腕",
    thumb: "拇指",
    index: "食指",
    middle: "中指",
    ring: "无名指",
    pinky: "小指",
    thigh: "大腿",
    calf: "小腿",
    foot: "脚",
    ball: "脚掌",
};

/** 手指链基部表:isFinger 谓词的唯一判据 */
const FINGER_BASES: Readonly<Record<string, true>> = {
    thumb: true,
    index: true,
    middle: true,
    ring: true,
    pinky: true,
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
 * 骨骼名 → 显示标签。解析层级:剥 leaf 末端标记 → 剥左右侧后缀 → 基部 + 序号。
 *
 * UE 词表把序号放在中段(`index_02_l`)而非末尾,故先剥侧后缀再取序号。
 * 任何一层不匹配都安全回退(显示分词原名),绝不抛错——第三方骨架命名不可预期。
 */
export function labelBone(boneName: string): BoneLabel {
    // `index_04_leaf_l` / `ball_leaf_r`:leaf 是末端定位骨,显示上并入所属链。
    const withoutLeaf = boneName.replace(/_leaf(?=_(l|r)$|$)/, "");
    const sideMatch = withoutLeaf.match(SIDE_SUFFIX_PATTERN);
    const side = sideMatch?.[1] ?? null;
    const withoutSide = side ? withoutLeaf.slice(0, -2) : withoutLeaf;
    const orderMatch = withoutSide.match(/^(.*?)_(\d+)$/);
    const base = orderMatch?.[1] ?? withoutSide;
    const order = orderMatch?.[2] ? Number(orderMatch[2]) : null;
    const baseZh = BASE_ZH[base] ?? splitCamelCase(withoutSide);
    const isFinger = FINGER_BASES[base] === true;
    return {
        zh: `${side ? (SIDE_ZH[side] ?? "") : ""}${isFinger ? "手" : ""}${baseZh}${orderSuffix(base, order)}`,
        isFinger,
    };
}
