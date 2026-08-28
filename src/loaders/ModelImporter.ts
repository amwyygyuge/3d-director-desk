import type { AnimationClip, BufferGeometry, Material, Object3D, Texture } from "three";
import { Mesh } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import { MODEL_FORMAT } from "../assets/ModelAsset";
import type { ModelFormat } from "../assets/ModelAsset";

/** 加载解析结果:原始场景图源 + 动作 clip(动作挂载在 05 任务消费) */
interface ParsedModel {
    source: Object3D;
    animations: readonly AnimationClip[];
}

/** 格式 → 加载器查表(纪律:禁 if 链);每格式一个新实例,规避 loader 内部 path 状态的并发竞争 */
const FORMAT_LOADERS: Record<ModelFormat, (url: string) => Promise<ParsedModel>> = {
    [MODEL_FORMAT.GLTF]: async (url) => {
        const gltf = await new GLTFLoader().loadAsync(url);
        return { source: gltf.scene, animations: gltf.animations };
    },
    [MODEL_FORMAT.FBX]: async (url) => {
        const object = await new FBXLoader().loadAsync(url);
        return { source: object, animations: object.animations };
    },
    [MODEL_FORMAT.OBJ]: async (url) => ({ source: await new OBJLoader().loadAsync(url), animations: [] }),
};

/** 缓存条目:同 URL 只解析一次;refs 归零才释放 GL 资源 */
interface CacheEntry {
    source: Object3D;
    animations: readonly AnimationClip[];
    refs: number;
}

/** 一次挂载的句柄:克隆体 + 动作 + 释放路径 */
export interface ModelHandle {
    object3d: Object3D;
    animations: readonly AnimationClip[];
    release: () => void;
}

function isTexture(value: unknown): value is Texture {
    return typeof value === "object" && value !== null && "isTexture" in value;
}

/**
 * 模型导入器(领域服务):格式分发、解析缓存、实例克隆、引用计数释放。
 *
 * 性能纪律:
 * - 同 URL 只走一次网络 + 解析;后续 acquire 克隆(SkeletonUtils 兼容蒙皮骨骼);
 * - 克隆体与缓存源共享 geometry/material/texture,因此单实例 release 不碰 GL 资源,
 *   refs 归零才统一 dispose——删除最后一个实例时内存真正回落;
 * - 大模型加载是异步的,调用方(视图)负责 loading 占位,UI 线程不被阻塞。
 */
export class ModelImporter {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly inflight = new Map<string, Promise<CacheEntry>>();

    async acquire(url: string, format: ModelFormat): Promise<ModelHandle> {
        const entry = await this.entryFor(url, format);
        entry.refs += 1;
        return {
            object3d: cloneSkeleton(entry.source),
            animations: entry.animations,
            release: () => this.releaseEntry(url, entry),
        };
    }

    dispose(): void {
        for (const [url, entry] of this.cache) {
            this.disposeEntry(entry);
            this.cache.delete(url);
        }
    }

    private entryFor(url: string, format: ModelFormat): Promise<CacheEntry> {
        const cached = this.cache.get(url);
        if (cached) return Promise.resolve(cached);

        const pending = this.inflight.get(url) ?? this.load(url, format);
        this.inflight.set(url, pending);
        return pending;
    }

    private async load(url: string, format: ModelFormat): Promise<CacheEntry> {
        try {
            const parsed = await FORMAT_LOADERS[format](url);
            const entry: CacheEntry = { ...parsed, refs: 0 };
            this.cache.set(url, entry);
            return entry;
        } finally {
            this.inflight.delete(url);
        }
    }

    private releaseEntry(url: string, entry: CacheEntry): void {
        entry.refs -= 1;
        if (entry.refs > 0) return;
        this.cache.delete(url);
        this.disposeEntry(entry);
    }

    /** 单次 traverse 收集去重后统一 dispose;仅在 refs 归零时调用,无共享误伤 */
    private disposeEntry(entry: CacheEntry): void {
        const geometries = new Set<BufferGeometry>();
        const materials = new Set<Material>();
        const textures = new Set<Texture>();
        entry.source.traverse((node) => {
            if (!(node instanceof Mesh)) return;
            geometries.add(node.geometry);
            const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of nodeMaterials) materials.add(material);
        });
        for (const material of materials) {
            for (const value of Object.values(material)) {
                if (isTexture(value)) textures.add(value);
            }
            material.dispose();
        }
        for (const geometry of geometries) geometry.dispose();
        for (const texture of textures) texture.dispose();
    }
}
