import { formatFromFileName } from "@/assets/ModelAsset";
import type { ModelAsset, ModelFormat } from "@/assets/ModelAsset";
import { createId } from "@/core/createId";
import { IDENTITY_TRANSFORM } from "@/core/SceneObject";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/** 文件 → 受支持的模型/动作来源:格式守卫 + objectURL(禁 base64) */
function fileToSource(file: File, notify: (message: string) => void): { url: string; format: ModelFormat } | null {
    const format = formatFromFileName(file.name);
    if (!format) {
        notify(`不支持的格式:${file.name}(支持 glb/gltf/fbx/obj)`);
        return null;
    }
    return { url: URL.createObjectURL(file), format };
}

/**
 * 本地文件的资产注册段(模型导入与布景导入共用,Rule of Two):
 * 格式守卫 → objectURL → 资产表去重;重复资产回收本次 objectURL 并复用已有条目。
 * 两个入口只在「怎么落进场景」上分叉,注册语义必须同源。
 */
function registerImportedAsset(
    stores: DirectorDeskStores,
    file: File,
    notify: (message: string) => void,
): ModelAsset | null {
    const source = fileToSource(file, notify);
    if (!source) return null;
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
    return asset;
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
    const asset = registerImportedAsset(stores, file, notify);
    if (!asset) return;
    const result = stores.dispatcher.dispatch(
        {
            type: "object.place",
            payload: {
                id: `model-${createId()}`,
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
 * 布景文件导入:与模型导入共用资产注册段,只在落位与交互态上分叉。
 *
 * 落原点而非走 `placementFor` 螺旋:布景文件自带世界布局(一整间屋子、一条街),
 * 螺旋是给「一件件道具别叠在一起」用的,施加到布景上等于把作者在 DCC 里摆好的世界整体平移,保真即失。
 * 同理 locked:true——布景是固定背景,默认不参与视口点选/gizmo/变换编辑,避免误拖整场景。
 */
export function importSceneryFile(stores: DirectorDeskStores, file: File, notify: (message: string) => void): void {
    const asset = registerImportedAsset(stores, file, notify);
    if (!asset) return;
    const result = stores.dispatcher.dispatch(
        {
            type: "object.place",
            payload: {
                id: `scenery-${createId()}`,
                kind: "model",
                sourceUrl: asset.url,
                format: asset.format,
                name: asset.name,
                transform: IDENTITY_TRANSFORM,
                locked: true,
            },
        },
        stores,
    );
    if (!result.ok) notify(`放置被拒绝:${result.error}`);
}
