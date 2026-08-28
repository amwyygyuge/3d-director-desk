import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type { Object3D } from "three";
import { Box3, Group, Vector3 } from "three";

import type { SceneObject } from "../../core/SceneObject";
import type { ModelHandle } from "../../loaders/ModelImporter";
import { useDirectorDeskStores } from "../DirectorDeskContext";

/** 每个 id 一个稳定区分色:走查时肉眼可辨,与选择态高亮解耦 */
const PALETTE = ["#7e57c2", "#26a69a", "#ef6c00", "#5c6bc0", "#c0ca33", "#8d6e63"] as const;

function colorOf(id: string): string {
    const hash = [...id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return PALETTE[hash % PALETTE.length]!;
}

/** 导入模型归一化目标:最大边缩放到 2 个场景单位,底面贴地——游戏模型单位各异(cm/m),裸放会糊满屏 */
const MODEL_TARGET_MAX_DIM = 2;

const TMP_BOX = new Box3();
const TMP_SIZE = new Vector3();
const TMP_CENTER = new Vector3();

/** 给克隆体套归一化壳:等比缩放 + 水平居中 + 底面贴 y=0;实体 transform 仍是用户语义 */
function normalizedShell(object3d: Object3D): Object3D {
    TMP_BOX.setFromObject(object3d);
    TMP_BOX.getSize(TMP_SIZE);
    TMP_BOX.getCenter(TMP_CENTER);
    const maxDim = Math.max(TMP_SIZE.x, TMP_SIZE.y, TMP_SIZE.z);
    const factor = maxDim > 0 ? MODEL_TARGET_MAX_DIM / maxDim : 1;
    const shell = new Group();
    shell.scale.setScalar(factor);
    shell.position.set(-TMP_CENTER.x * factor, -TMP_BOX.min.y * factor, -TMP_CENTER.z * factor);
    shell.add(object3d);
    return shell;
}

export function PrimitiveContent({ entity }: { entity: SceneObject }) {
    return (
        <mesh>
            <boxGeometry />
            <meshStandardMaterial color={colorOf(entity.id)} />
        </mesh>
    );
}

/**
 * 模型实体内容:异步加载 → 挂克隆体;加载中/失败显示线框占位。
 * 加载完成后必须显式 invalidate()——frameloop="demand" 下异步结果不会自动触发渲染。
 * 卸载纪律:effect cleanup 调 handle.release(),引用计数归零后 GL 资源由 ModelImporter 统一释放。
 */
export function ModelContent({ entity }: { entity: SceneObject }) {
    const { models } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    // 配置缺失(无 url/格式)属静态错误,渲染期直接呈现失败占位,不进 effect
    const sourceUrl = entity.sourceUrl;
    const format = entity.format;
    const [handle, setHandle] = useState<ModelHandle | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const failed = sourceUrl === null || format === null || loadFailed;

    useEffect(() => {
        if (sourceUrl === null || format === null) return;
        let cancelled = false;
        let acquired: ModelHandle | null = null;
        models
            .acquire(sourceUrl, format)
            .then((h) => {
                if (cancelled) {
                    h.release();
                    return;
                }
                acquired = h;
                setHandle(h);
                invalidate();
            })
            .catch((error: unknown) => {
                console.warn(`[ModelContent] 加载失败 ${sourceUrl}`, error);
                if (cancelled) return;
                setLoadFailed(true);
                invalidate();
            });
        return () => {
            cancelled = true;
            acquired?.release();
        };
    }, [models, sourceUrl, format, invalidate]);

    // 归一化壳按 handle 钉住:渲染期重复构造会导致 <primitive> 反复重挂载
    const shell = useMemo(() => (handle ? normalizedShell(handle.object3d) : null), [handle]);
    if (shell) return <primitive object={shell} />;
    return (
        <mesh>
            <boxGeometry />
            <meshBasicMaterial wireframe color={failed ? "#e53935" : "#757575"} />
        </mesh>
    );
}
