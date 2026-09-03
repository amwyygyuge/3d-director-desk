import type { Object3D } from "three";

/**
 * Capture helper runtime registry. It owns only mounted root helpers, never scene entities or MobX state.
 * Hiding a registered root hides its full helper subtree, so capture never traverses the scene graph.
 */
export class CaptureHelperRegistry implements Iterable<Object3D> {
    private readonly helpers = new Set<Object3D>();

    register(helper: Object3D): () => void {
        this.helpers.add(helper);
        return () => this.helpers.delete(helper);
    }

    clear(): void {
        this.helpers.clear();
    }

    [Symbol.iterator](): Iterator<Object3D> {
        return this.helpers.values();
    }
}
