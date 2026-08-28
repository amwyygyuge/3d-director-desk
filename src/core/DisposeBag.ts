/**
 * 统一资源释放袋:收集 dispose 回调,一次性释放。
 * 性能铁律:任何进入场景的 BufferGeometry / Material / Texture / 外部引用
 * 必须在注册时登记释放路径,场景卸载时零泄漏。
 */
export class DisposeBag {
    private readonly disposers = new Set<() => void>();
    private disposed = false;

    register(dispose: () => void): void {
        if (this.disposed) {
            dispose();
            return;
        }
        this.disposers.add(dispose);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const dispose of this.disposers) dispose();
        this.disposers.clear();
    }
}
