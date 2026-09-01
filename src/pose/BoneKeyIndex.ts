import type { BoneKey } from "@/pose/PoseSnapshot";
import type { BoneTreeNodeDto, SkeletonDiscoveryDto } from "@/pose/SkeletonRuntimeRegistry";

/** Runtime skeleton discovery is converted once into stable name/key lookup tables. */
export class BoneKeyIndex {
    private readonly keysByName = new Map<string, BoneKey>();
    private readonly namesByKey = new Map<BoneKey, string>();
    private readonly ready: boolean;

    private constructor(ready: boolean) {
        this.ready = ready;
    }

    static from(discovery: SkeletonDiscoveryDto): BoneKeyIndex {
        const index = new BoneKeyIndex(discovery.ready);
        index.collect(discovery.roots);
        return index;
    }

    get isReady(): boolean {
        return this.ready;
    }

    keyOf(boneName: string): BoneKey | undefined {
        return this.keysByName.get(boneName);
    }

    nameOf(key: BoneKey): string | undefined {
        return this.namesByKey.get(key);
    }

    private collect(nodes: readonly BoneTreeNodeDto[]): void {
        for (const node of nodes) {
            this.keysByName.set(node.name, node.key);
            this.namesByKey.set(node.key, node.name);
            this.collect(node.children);
        }
    }
}
