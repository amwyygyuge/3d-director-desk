import type { DirectorDeskStores } from "../DirectorDeskContext";
import { importActionFile, placementFor } from "../importFiles";

/** 测试资产(public/test-assets,gitignored)的统一入口 */
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

export function placePrimitives(stores: DirectorDeskStores, count: number): void {
    for (let i = 0; i < count; i++) {
        stores.dispatcher.dispatch(
            {
                type: "object.place",
                payload: {
                    id: `prim-${crypto.randomUUID()}`,
                    kind: "primitive",
                    transform: {
                        position: placementFor(stores.scene.objectCount),
                        rotation: [0, 0, 0],
                        scale: [1, 1, 1],
                    },
                },
            },
            stores,
        );
    }
}

/** 拉测试资产转 File 走真实动作导入管线(与文件选择同一路径) */
export async function importActionFromUrl(stores: DirectorDeskStores, url: string, name: string): Promise<void> {
    const blob = await (await fetch(url)).blob();
    await importActionFile(stores, new File([blob], name), () => {});
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
