import { formatFromFileName } from "../../assets/ModelAsset";
import type { ModelFormat } from "../../assets/ModelAsset";
import type { DirectorDeskStores } from "../shell/DirectorDeskContext";

/** 文件 → 受支持的模型/动作来源:格式守卫 + objectURL(禁 base64) */
function fileToSource(file: File, notify: (message: string) => void): { url: string; format: ModelFormat } | null {
    const format = formatFromFileName(file.name);
    if (!format) {
        notify(`不支持的格式:${file.name}(支持 glb/gltf/fbx/obj)`);
        return null;
    }
    return { url: URL.createObjectURL(file), format };
}

/** 黄金角螺旋落位(资源库放置与本地导入共用语义);index 为当前对象数 */
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
