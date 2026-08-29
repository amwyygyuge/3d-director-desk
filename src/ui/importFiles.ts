import { formatFromFileName, MODEL_FORMAT } from "../assets/ModelAsset";
import type { ModelFormat } from "../assets/ModelAsset";
import type { DirectorDeskStores } from "./DirectorDeskContext";

/** 文件 → 受支持的模型/动作来源:格式守卫 + objectURL(禁 base64) */
function fileToSource(file: File, notify: (message: string) => void): { url: string; format: ModelFormat } | null {
    const format = formatFromFileName(file.name);
    if (!format) {
        notify(`不支持的格式:${file.name}(支持 glb/gltf/fbx/obj)`);
        return null;
    }
    return { url: URL.createObjectURL(file), format };
}

/** 黄金角螺旋落位(与 Toolbar 放置共用语义);index 为当前对象数 */
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));
const PLACEMENT_SPREAD = 1.5;
const OBJECT_BASE_HEIGHT = 0.5;

export function placementFor(index: number): [number, number, number] {
    const radius = PLACEMENT_SPREAD * Math.sqrt(index);
    return [
        Math.cos(index * GOLDEN_ANGLE_RAD) * radius,
        OBJECT_BASE_HEIGHT,
        Math.sin(index * GOLDEN_ANGLE_RAD) * radius,
    ];
}

/** 模型文件导入:资产注册(去重)→ object.place 命令 */
export function importModelFile(stores: DirectorDeskStores, file: File, notify: (message: string) => void): void {
    const source = fileToSource(file, notify);
    if (!source) return;
    const { asset, duplicate } = stores.assets.register({
        name: file.name,
        url: source.url,
        format: source.format,
        sizeBytes: file.size,
    });
    if (duplicate) {
        URL.revokeObjectURL(source.url);
        notify(`资产已存在:${file.name},直接放置已有资产`);
    }
    const result = stores.dispatcher.dispatch(
        {
            type: "object.place",
            payload: {
                id: `model-${crypto.randomUUID()}`,
                kind: "model",
                sourceUrl: asset.url,
                format: asset.format,
                name: asset.name,
                transform: { position: placementFor(stores.scene.objectCount), rotation: [0, 0, 0], scale: [1, 1, 1] },
            },
        },
        stores,
    );
    if (!result.ok) notify(`放置被拒绝:${result.error}`);
}

/**
 * 动作文件导入:复用 ModelImporter 解析管线只取 animations,clip 入动作库。
 * OBJ 无骨骼轨道,直接拒绝;解析后无轨道同样拒绝并回收 URL。
 */
export async function importActionFile(
    stores: DirectorDeskStores,
    file: File,
    notify: (message: string) => void,
): Promise<void> {
    const source = fileToSource(file, notify);
    if (!source) return;
    if (source.format === MODEL_FORMAT.OBJ) {
        URL.revokeObjectURL(source.url);
        notify(`OBJ 不含骨骼动作:${file.name}`);
        return;
    }
    try {
        const handle = await stores.models.acquire(source.url, source.format, { signal: stores.lifecycle.signal });
        if (stores.lifecycle.signal.aborted) {
            handle.release();
            URL.revokeObjectURL(source.url);
            return;
        }
        const clips = [...handle.animations];
        handle.release();
        if (clips.length === 0) {
            URL.revokeObjectURL(source.url);
            notify(`文件中没有动作轨道:${file.name}`);
            return;
        }
        // 多 clip 文件(如 Fox 的 Survey/Walk/Run)逐条入库,名称带 clip 后缀;全部重复说明重复导入,回收新 URL;部分重复则保留给新条目
        const outcomes = clips.map(
            (clip) =>
                stores.animations.register({
                    name: clips.length > 1 ? `${file.name}#${clip.name}` : file.name,
                    url: source.url,
                    clip,
                }).duplicate,
        );
        if (outcomes.every(Boolean)) URL.revokeObjectURL(source.url);
        const freshCount = outcomes.filter((d) => !d).length;
        notify(`动作入库:${file.name} 新增 ${freshCount} 条 / 共 ${clips.length} 条`);
    } catch (error) {
        URL.revokeObjectURL(source.url);
        if (stores.lifecycle.signal.aborted) return;
        console.warn(`[importActionFile] 解析失败 ${file.name}`, error);
        notify(`动作解析失败:${file.name}`);
    }
}
