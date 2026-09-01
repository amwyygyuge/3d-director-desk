import type { Bone, Object3D } from "three";
import { SkeletonHelper } from "three";

import type { BoneKey, QuaternionTuple } from "./PoseSnapshot";

export interface BoneTreeNodeDto {
    readonly key: BoneKey;
    readonly name: string;
    readonly children: readonly BoneTreeNodeDto[];
}

export interface SemanticBoneCandidateDto {
    readonly label: string;
    readonly boneKey: BoneKey;
}

export interface SkeletonDiscoveryDto {
    readonly objectId: string;
    readonly ready: boolean;
    readonly roots: readonly BoneTreeNodeDto[];
    readonly semanticCandidates: readonly SemanticBoneCandidateDto[];
}

interface SkeletonRuntime {
    readonly bones: ReadonlyMap<BoneKey, Bone>;
    readonly rootBones: readonly Bone[];
    readonly indexedBones: readonly Bone[];
    readonly baselineRotations: readonly QuaternionTuple[];
    readonly roots: readonly BoneTreeNodeDto[];
    readonly semanticCandidates: readonly SemanticBoneCandidateDto[];
}

const SEMANTIC_LABELS: readonly [RegExp, string][] = [
    [/head/i, "head"],
    [/neck/i, "neck"],
    [/(left|_l\b|\.l\b).*?(hand|wrist)/i, "left-hand"],
    [/(right|_r\b|\.r\b).*?(hand|wrist)/i, "right-hand"],
    [/(left|_l\b|\.l\b).*?(foot|ankle)/i, "left-foot"],
    [/(right|_r\b|\.r\b).*?(foot|ankle)/i, "right-foot"],
    [/(spine|chest|torso)/i, "spine"],
];

function labelFor(name: string): string | null {
    for (const [pattern, label] of SEMANTIC_LABELS) {
        if (pattern.test(name)) return label;
    }
    return null;
}

/**
 * Per-desk non-observable Three runtime index. Models are traversed exactly once at readiness;
 * commands and queries only receive serializable DTOs, never references to Bones.
 */
export class SkeletonRuntimeRegistry {
    private readonly runtimes = new Map<string, SkeletonRuntime>();
    /** Dense runtime list is maintained at readiness, so playback uses indexed loops without iterators. */
    private readonly indexedRuntimes: SkeletonRuntime[] = [];

    register(objectId: string, root: Object3D): void {
        const rootBones: Bone[] = [];
        root.traverse((node) => {
            if (node.type === "Bone" && node.parent?.type !== "Bone") rootBones.push(node as Bone);
        });
        const bones = new Map<BoneKey, Bone>();
        const indexedBones: Bone[] = [];
        const baselineRotations: QuaternionTuple[] = [];
        const semanticKeys = new Map<string, BoneKey[]>();
        const createTree = (bone: Bone, key: BoneKey): BoneTreeNodeDto => {
            bones.set(key, bone);
            indexedBones.push(bone);
            baselineRotations.push([bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w]);
            const label = labelFor(bone.name);
            if (label) {
                const candidates = semanticKeys.get(label) ?? [];
                candidates.push(key);
                semanticKeys.set(label, candidates);
            }
            const children: BoneTreeNodeDto[] = [];
            for (let index = 0; index < bone.children.length; index += 1) {
                const child = bone.children[index];
                if (child?.type === "Bone") children.push(createTree(child as Bone, `${key}/${index}`));
            }
            return Object.freeze({ key, name: bone.name || key, children: Object.freeze(children) });
        };
        const roots = rootBones.map((bone, index) => createTree(bone, `root/${index}`));
        const semanticCandidates: SemanticBoneCandidateDto[] = [];
        for (const [label, keys] of semanticKeys) {
            const boneKey = keys.length === 1 ? keys[0] : undefined;
            if (boneKey) semanticCandidates.push(Object.freeze({ label, boneKey }));
        }
        const previous = this.runtimes.get(objectId);
        if (previous) this.indexedRuntimes.splice(this.indexedRuntimes.indexOf(previous), 1);
        const runtime: SkeletonRuntime = {
            bones,
            rootBones: Object.freeze(rootBones),
            indexedBones,
            baselineRotations,
            roots: Object.freeze(roots),
            semanticCandidates: Object.freeze(
                semanticCandidates.sort((left, right) => left.label.localeCompare(right.label)),
            ),
        };
        this.runtimes.set(objectId, runtime);
        this.indexedRuntimes.push(runtime);
    }

    unregister(objectId: string): void {
        const runtime = this.runtimes.get(objectId);
        if (!runtime) return;
        this.runtimes.delete(objectId);
        this.indexedRuntimes.splice(this.indexedRuntimes.indexOf(runtime), 1);
    }

    getBone(objectId: string, key: BoneKey): Bone | undefined {
        return this.runtimes.get(objectId)?.bones.get(key);
    }

    restoreRotations(objectId: string): void {
        const runtime = this.runtimes.get(objectId);
        if (runtime) this.restoreRuntimeRotations(runtime);
    }

    restoreAllRotations(): void {
        for (let runtimeIndex = 0; runtimeIndex < this.indexedRuntimes.length; runtimeIndex += 1) {
            const runtime = this.indexedRuntimes[runtimeIndex];
            if (runtime) this.restoreRuntimeRotations(runtime);
        }
    }

    discover(objectId: string): SkeletonDiscoveryDto {
        const runtime = this.runtimes.get(objectId);
        return runtime
            ? { objectId, ready: true, roots: runtime.roots, semanticCandidates: runtime.semanticCandidates }
            : { objectId, ready: false, roots: [], semanticCandidates: [] };
    }

    createHelpers(objectId: string): readonly SkeletonHelper[] {
        const rootBones = this.runtimes.get(objectId)?.rootBones;
        if (!rootBones || rootBones.length === 0) return [];
        const helpers = new Array<SkeletonHelper>(rootBones.length);
        for (let index = 0; index < rootBones.length; index += 1) {
            const root = rootBones[index];
            if (!root) continue;
            const helper = new SkeletonHelper(root);
            helper.userData.helper = true;
            helper.userData.poseHelper = true;
            helpers[index] = helper;
        }
        return helpers;
    }
    /** 工程替换时释放旧模型骨骼索引；新模型就绪后会重新注册。 */
    clear(): void {
        this.runtimes.clear();
        this.indexedRuntimes.length = 0;
    }

    dispose(): void {
        this.clear();
    }

    private restoreRuntimeRotations(runtime: SkeletonRuntime): void {
        for (let boneIndex = 0; boneIndex < runtime.indexedBones.length; boneIndex += 1) {
            const bone = runtime.indexedBones[boneIndex];
            const baseline = runtime.baselineRotations[boneIndex];
            if (bone && baseline) bone.quaternion.set(baseline[0], baseline[1], baseline[2], baseline[3]);
        }
    }
}
