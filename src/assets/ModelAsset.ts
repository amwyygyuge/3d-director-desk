/**
 * 模型格式:阶段一支持的导入格式。
 * 扩展名 → 格式的映射是查表(Record),不堆 if。
 */
export const MODEL_FORMAT = {
    GLTF: "gltf",
    FBX: "fbx",
    OBJ: "obj",
} as const;
export type ModelFormat = (typeof MODEL_FORMAT)[keyof typeof MODEL_FORMAT];

const EXT_TO_FORMAT: Record<string, ModelFormat> = {
    glb: MODEL_FORMAT.GLTF,
    gltf: MODEL_FORMAT.GLTF,
    fbx: MODEL_FORMAT.FBX,
    obj: MODEL_FORMAT.OBJ,
};

/** 从文件名解析格式;无法识别返回 null(由调用方决定拒绝还是兜底) */
export function formatFromFileName(name: string): ModelFormat | null {
    const ext = name.split(".").pop()?.toLowerCase();
    return ext ? (EXT_TO_FORMAT[ext] ?? null) : null;
}

/**
 * 从 URL 解析格式;blob: URL 无扩展名,返回 null——
 * 本地导入的格式必须由 File.name 侧显式带入(见 importFiles/PlaceObjectCommand)。
 */
export function formatFromUrl(url: string): ModelFormat | null {
    try {
        return formatFromFileName(new URL(url, window.location.origin).pathname);
    } catch {
        return null;
    }
}

/**
 * 模型资产值对象:由属性值定义、不可变。
 * url 一律 blob/objectURL 或宿主 http(s);禁 base64(storyai 教训)。
 */
export class ModelAsset {
    readonly id: string;
    readonly name: string;
    readonly url: string;
    readonly format: ModelFormat;
    readonly sizeBytes: number;

    constructor(init: { id: string; name: string; url: string; format: ModelFormat; sizeBytes: number }) {
        this.id = init.id;
        this.name = init.name;
        this.url = init.url;
        this.format = init.format;
        this.sizeBytes = init.sizeBytes;
        Object.freeze(this);
    }
}
