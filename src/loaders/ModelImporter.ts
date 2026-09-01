import { Line, LoadingManager, Mesh, Points } from "three";
import type { AnimationClip, BufferGeometry, Material, Object3D, Texture } from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

import { MODEL_FORMAT } from "@/assets/ModelAsset";
import type { ModelFormat } from "@/assets/ModelAsset";

/** 加载解析结果:原始场景图源 + 动作 clip(动作挂载在 05 任务消费) */
interface ParsedModel {
    source: Object3D;
    animations: readonly AnimationClip[];
}

type ProgressCallback = (progress01: number) => void;

interface ModelAcquireOptions {
    onProgress?: ProgressCallback;
    signal?: AbortSignal;
}

type FormatLoader = (url: string, manager: LoadingManager, onProgress?: ProgressCallback) => Promise<ParsedModel>;

interface CacheEntry extends ParsedModel {
    refs: number;
    disposed: boolean;
}

interface PendingConsumer {
    readonly onProgress: ProgressCallback | undefined;
    readonly resolve: (handle: ModelHandle) => void;
    readonly reject: (reason: unknown) => void;
    readonly signal: AbortSignal | undefined;
    abortListener: () => void;
}

interface PendingLoad {
    readonly manager: LoadingManager;
    readonly consumers: Set<PendingConsumer>;
    readonly promise: Promise<CacheEntry>;
}

type RenderableObject = Mesh | Line | Points;

const EMPTY_PROGRESS = 0;
const NO_REFERENCES = 0;
const ONE_REFERENCE = 1;
const ABORT_ERROR_NAME = "AbortError";
const ABORT_ERROR_MESSAGE = "Model loading was cancelled";

function createProgressReporter(
    onProgress: ProgressCallback | undefined,
): ((event: ProgressEvent) => void) | undefined {
    if (onProgress === undefined) return undefined;
    return (event) => onProgress(event.total > EMPTY_PROGRESS ? event.loaded / event.total : EMPTY_PROGRESS);
}

function cacheKey(url: string, format: ModelFormat): string {
    return JSON.stringify([format, url]);
}

function cancelledError(): DOMException {
    return new DOMException(ABORT_ERROR_MESSAGE, ABORT_ERROR_NAME);
}

function isRenderableObject(node: Object3D): node is RenderableObject {
    return node instanceof Mesh || node instanceof Line || node instanceof Points;
}

function collectTextures(value: unknown, textures: Set<Texture>, visited: Set<object>): void {
    if (isTexture(value)) {
        textures.add(value);
        return;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) return;
    visited.add(value);
    for (const property of Object.values(value)) collectTextures(property, textures, visited);
}

function isTexture(value: unknown): value is Texture {
    return typeof value === "object" && value !== null && "isTexture" in value;
}

/** 格式 → 加载器查表(纪律:禁 if 链);每次请求有独立 LoadingManager,可按引用安全中止 */
const FORMAT_LOADERS: Record<ModelFormat, FormatLoader> = {
    [MODEL_FORMAT.GLTF]: async (url, manager, onProgress) => {
        const gltf = await new GLTFLoader(manager).loadAsync(url, createProgressReporter(onProgress));
        return { source: gltf.scene, animations: gltf.animations };
    },
    [MODEL_FORMAT.FBX]: async (url, manager, onProgress) => {
        const object = await new FBXLoader(manager).loadAsync(url, createProgressReporter(onProgress));
        return { source: object, animations: object.animations };
    },
    [MODEL_FORMAT.OBJ]: async (url, manager, onProgress) => ({
        source: await new OBJLoader(manager).loadAsync(url, createProgressReporter(onProgress)),
        animations: [],
    }),
};

/** 一次挂载的句柄:克隆体 + 动作 + 幂等释放路径 */
export interface ModelHandle {
    object3d: Object3D;
    animations: readonly AnimationClip[];
    release: () => void;
}

/**
 * 模型导入器(领域服务):格式分发、解析缓存、实例克隆、引用计数和取消。
 *
 * 缓存和并发请求都以「格式 + URL」标识。每个进行中的解析记录所有消费者；
 * 最后一个消费者取消时中止其 LoadingManager，异步完成也不会再发布到缓存。
 */
export class ModelImporter {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly inflight = new Map<string, PendingLoad>();
    private disposed = false;

    acquire(url: string, format: ModelFormat, options: ModelAcquireOptions = {}): Promise<ModelHandle> {
        if (this.disposed || options.signal?.aborted) return Promise.reject(cancelledError());

        const key = cacheKey(url, format);
        const cached = this.cache.get(key);
        if (cached) return Promise.resolve(this.createHandle(key, cached));

        const pending = this.inflight.get(key) ?? this.createPendingLoad(key, url, format);
        return this.addConsumer(key, pending, options);
    }

    /** 停止新请求并取消未完成解析；已交付句柄继续持有共享 GPU 资源直至各自 release。 */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const [key, pending] of this.inflight) this.cancelPendingLoad(key, pending);
        for (const [key, entry] of this.cache) {
            if (entry.refs !== NO_REFERENCES) continue;
            this.cache.delete(key);
            this.disposeEntry(entry);
        }
    }

    private createPendingLoad(key: string, url: string, format: ModelFormat): PendingLoad {
        const manager = new LoadingManager();
        const consumers = new Set<PendingConsumer>();
        const pending: PendingLoad = {
            manager,
            consumers,
            promise: this.load(url, format, manager, (progress01) => this.reportProgress(consumers, progress01)),
        };
        this.inflight.set(key, pending);
        void pending.promise.then(
            (entry) => this.completePendingLoad(key, pending, entry),
            (reason: unknown) => this.rejectPendingLoad(key, pending, reason),
        );
        return pending;
    }

    private addConsumer(key: string, pending: PendingLoad, options: ModelAcquireOptions): Promise<ModelHandle> {
        const { promise, resolve, reject } = Promise.withResolvers<ModelHandle>();
        const consumer: PendingConsumer = {
            onProgress: options.onProgress,
            resolve,
            reject,
            signal: options.signal,
            abortListener: () => this.cancelConsumer(key, pending, consumer),
        };
        if (consumer.signal?.aborted) {
            reject(cancelledError());
            return promise;
        }

        pending.consumers.add(consumer);
        consumer.signal?.addEventListener("abort", consumer.abortListener, { once: true });
        return promise;
    }

    private async load(
        url: string,
        format: ModelFormat,
        manager: LoadingManager,
        onProgress: ProgressCallback,
    ): Promise<CacheEntry> {
        const parsed = await FORMAT_LOADERS[format](url, manager, onProgress);
        return { ...parsed, refs: NO_REFERENCES, disposed: false };
    }

    private completePendingLoad(key: string, pending: PendingLoad, entry: CacheEntry): void {
        if (this.inflight.get(key) !== pending || this.disposed || pending.consumers.size === NO_REFERENCES) {
            this.disposeEntry(entry);
            return;
        }

        this.inflight.delete(key);
        this.cache.set(key, entry);
        for (const consumer of pending.consumers) this.resolveConsumer(key, pending, entry, consumer);
    }

    private rejectPendingLoad(key: string, pending: PendingLoad, reason: unknown): void {
        if (this.inflight.get(key) !== pending) return;
        this.inflight.delete(key);
        for (const consumer of pending.consumers) this.rejectConsumer(pending, consumer, reason);
    }

    private resolveConsumer(key: string, pending: PendingLoad, entry: CacheEntry, consumer: PendingConsumer): void {
        if (!pending.consumers.delete(consumer)) return;
        consumer.signal?.removeEventListener("abort", consumer.abortListener);
        consumer.resolve(this.createHandle(key, entry));
    }

    private rejectConsumer(pending: PendingLoad, consumer: PendingConsumer, reason: unknown): void {
        if (!pending.consumers.delete(consumer)) return;
        consumer.signal?.removeEventListener("abort", consumer.abortListener);
        consumer.reject(reason);
    }

    private cancelConsumer(key: string, pending: PendingLoad, consumer: PendingConsumer): void {
        this.rejectConsumer(pending, consumer, cancelledError());
        if (pending.consumers.size !== NO_REFERENCES) return;
        this.inflight.delete(key);
        pending.manager.abort();
    }

    private cancelPendingLoad(key: string, pending: PendingLoad): void {
        this.inflight.delete(key);
        for (const consumer of pending.consumers) this.rejectConsumer(pending, consumer, cancelledError());
        pending.manager.abort();
    }

    private reportProgress(consumers: ReadonlySet<PendingConsumer>, progress01: number): void {
        for (const consumer of consumers) consumer.onProgress?.(progress01);
    }

    private createHandle(key: string, entry: CacheEntry): ModelHandle {
        entry.refs += ONE_REFERENCE;
        const releaseState = { released: false };
        return {
            object3d: cloneSkeleton(entry.source),
            animations: entry.animations,
            release: () => {
                if (releaseState.released) return;
                releaseState.released = true;
                this.releaseEntry(key, entry);
            },
        };
    }

    private releaseEntry(key: string, entry: CacheEntry): void {
        if (entry.disposed || entry.refs === NO_REFERENCES) return;
        entry.refs -= ONE_REFERENCE;
        if (entry.refs !== NO_REFERENCES) return;
        if (this.cache.get(key) === entry) this.cache.delete(key);
        this.disposeEntry(entry);
    }

    /** 仅在缓存源失去全部引用时调用；Mesh、Line、Points 的几何、材质与贴图统一去重释放。 */
    private disposeEntry(entry: CacheEntry): void {
        if (entry.disposed) return;
        entry.disposed = true;
        const geometries = new Set<BufferGeometry>();
        const materials = new Set<Material>();
        const textures = new Set<Texture>();
        const visited = new Set<object>();
        entry.source.traverse((node) => {
            if (!isRenderableObject(node)) return;
            geometries.add(node.geometry);
            const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of nodeMaterials) materials.add(material);
        });
        for (const material of materials) collectTextures(material, textures, visited);
        for (const material of materials) material.dispose();
        for (const geometry of geometries) geometry.dispose();
        for (const texture of textures) texture.dispose();
    }
}
