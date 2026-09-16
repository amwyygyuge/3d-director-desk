import type { OrbitLike } from "@/navigation/orbit";

/**
 * 视口轨道控制器：每桌唯一持有 OrbitControls 的可变启停与阻尼刷新入口。
 *
 * TransformControls 会直接重设第三方 controls.enabled；其他模块不得再写该字段，
 * 而是在相机所有权变化后经本类重新施加授权。Three 引用仅存于普通字段。
 */
export class ViewportOrbitController {
    private controls: OrbitLike | null = null;
    /** 授权真值:唯一由所有权裁决写入,第三方对 controls.enabled 的越权写一律被它压回 */
    private authorized = false;

    /**
     * 接管 controls.enabled 这一可变字段:装一个访问器,读回授权真值,
     * 写入则被吞掉(仅记录),从而让 drei TransformControls 的
     * `defaultControls.enabled = !event.value` 这类越权写在物理上无效。
     *
     * 背景:该越权写发生在 gizmo 拖拽结束的 dragging-changed 上,而它与所有权 observable
     * 无关——掌镜/镜头视角下会把轨道悄悄唤醒。此后同一串指针事件被 OrbitControls(绕 target
     * 公转)与摆位手势(绕相机 pan/tilt)各处理一次,实测一次 400px 单向拖拽转出 243.3°
     * 而应为 121.1°(2.01×),来回拖则摆幅在 0.1°~40° 之间乱跳——即「拖着拖着晃动越来越大」。
     * 旧写法只在 isOrbitEnabled 跳变时重申,授权值没变就不重跑 effect,越权写因此长期存活。
     */
    attach(controls: OrbitLike): void {
        this.controls = controls;
        Object.defineProperty(controls, "enabled", {
            configurable: true,
            get: (): boolean => this.authorized,
            set: (): void => {},
        });
    }

    detach(controls: OrbitLike): void {
        if (this.controls !== controls) return;
        Object.defineProperty(controls, "enabled", {
            configurable: true,
            writable: true,
            value: this.authorized,
        });
        this.controls = null;
    }

    setEnabled(enabled: boolean): void {
        this.authorized = enabled;
    }

    /**
     * 在写入相机或 target 前清除 OrbitControls 遗留的阻尼增量。
     *
     * 必须先关阻尼再 update():开阻尼时 update() 只消费 dampingFactor 那一份 sphericalDelta、
     * 余量乘 (1 - dampingFactor) 留到下一帧,所以裸调 update() 不是「清残量」而是「再转一点」
     * ——实测连调 20 次反而多转 15.8°,把进入机位/镜头视角的首帧姿态与落帧一起污染。
     * 关掉阻尼走 else 分支(sphericalDelta.set(0,0,0) + panOffset.set(0,0,0))才是真正归零:
     * 实测一次调用后再调 20 次 update() 角度不再变化。随后恢复原值,导演视角的惯性手感不受影响。
     */
    drainDampingResidual(): void {
        const controls = this.controls;
        if (!controls) return;
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damping;
    }
}
