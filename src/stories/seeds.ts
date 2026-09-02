import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { placementFor } from "@/ui/assets/importFiles";

/** 测试资产(public/test-assets,已入库,来源见该目录 README)的统一入口 */
export const TEST_ASSETS = {
    fox: "/test-assets/fox.glb",
    helmet: "/test-assets/desk-test.glb",
    sambaFbx: "/test-assets/desk-test.fbx",
    maleObj: "/test-assets/desk-test.obj",
} as const;
/** 经命令层放模型(与 UI 导入同一路径);模型归一化后底面贴地,y 一律 0;可显式覆盖位置 */
export function placeModel(stores: DirectorDeskStores, url: string, position?: [number, number, number]): void {
    const spiral = placementFor(stores.scene.objectCount);
    stores.dispatcher.dispatch(
        {
            type: "object.place",
            payload: {
                id: `model-${crypto.randomUUID()}`,
                kind: "model",
                sourceUrl: url,
                transform: { position: position ?? [spiral[0], 0, spiral[2]], rotation: [0, 0, 0], scale: [1, 1, 1] },
            },
        },
        stores,
    );
}

export function placeModels(stores: DirectorDeskStores, count: number): void {
    Array.from({ length: count }, () => placeModel(stores, TEST_ASSETS.helmet));
}

/** 预置两个机位(纯数据,走命令层) */
export function seedShots(stores: DirectorDeskStores): void {
    stores.dispatcher.dispatch(
        {
            type: "camera.set-shot",
            payload: { id: "shot-正面中景", shot: { position: [0, 1.6, 4.2], target: [0, 0.9, 0], fov: 45 } },
        },
        stores,
    );
    stores.dispatcher.dispatch(
        {
            type: "camera.set-shot",
            payload: { id: "shot-侧后远景", shot: { position: [-6, 3.2, -5.5], target: [0, 1, 0], fov: 40 } },
        },
        stores,
    );
}
