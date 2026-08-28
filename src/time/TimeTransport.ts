import { makeAutoObservable } from "mobx";

/**
 * 统一时钟(阶段二时间轴的地基)。
 *
 * 所有时间驱动的子系统(骨骼动作/走位/运镜/音频)共享同一个 playhead:
 * - 播放期:渲染循环调 tick(delta),transport 推进 playhead;
 * - 拖动定位(阶段二时间轴 UI):seek(t) 直接设 playhead。
 *
 * 订阅者拿到的是绝对时间而非 delta——scrub 语义与播放语义统一,
 * 避免阶段二把时间轴嫁接到自由播放 API 上造成破坏性变更。
 */
export class TimeTransport {
    private playheadSeconds = 0;
    private playing = false;
    private readonly listeners = new Set<(timeSeconds: number) => void>();

    constructor() {
        // playing 进 observable(UI 播放键、frameloop 切换订阅它);
        // playheadSeconds 高频逐帧推进,排除 observable,订阅者走 subscribe 回调
        makeAutoObservable(this, { playheadSeconds: false, listeners: false } as never);
    }

    get time(): number {
        return this.playheadSeconds;
    }

    get isPlaying(): boolean {
        return this.playing;
    }

    play(): void {
        this.playing = true;
    }

    pause(): void {
        this.playing = false;
    }

    stop(): void {
        this.playing = false;
        this.seek(0);
    }

    seek(timeSeconds: number): void {
        this.playheadSeconds = Math.max(0, timeSeconds);
        this.emit();
    }

    /** 渲染循环每帧调用;暂停时是空操作,零分配 */
    tick(deltaSeconds: number): void {
        if (!this.playing) return;
        this.playheadSeconds += deltaSeconds;
        this.emit();
    }

    subscribe(listener: (timeSeconds: number) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        for (const listener of this.listeners) listener(this.playheadSeconds);
    }
}
