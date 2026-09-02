import type { OrbitLike } from "@/navigation/orbit";

/**
 * 视口轨道控制器：每桌唯一持有 OrbitControls 的可变启停与阻尼刷新入口。
 *
 * TransformControls 会直接重设第三方 controls.enabled；其他模块不得再写该字段，
 * 而是在相机所有权变化后经本类重新施加授权。Three 引用仅存于普通字段。
 */
export class ViewportOrbitController {
    private controls: OrbitLike | null = null;

    attach(controls: OrbitLike): void {
        this.controls = controls;
    }

    detach(controls: OrbitLike): void {
        if (this.controls === controls) this.controls = null;
    }

    setEnabled(enabled: boolean): void {
        if (!this.controls) return;
        this.controls.enabled = enabled;
    }

    /** 在写入相机或 target 前清除 OrbitControls 遗留的阻尼增量。 */
    drainDampingResidual(): void {
        this.controls?.update();
    }
}
