import { makeAutoObservable } from "mobx";

/**
 * 统一时钟(阶段二时间轴的地基)。
 *
 * 所有时间驱动的子系统(骨骼动作/走位/运镜/音频)共享同一个 playhead:
 * - 播放期:渲染循环调 tick(delta),transport 推进 playhead;
 * - 拖动定位(阶段二时间轴 UI):seek(t) 直接设 playhead。
 *
 * playhead 是 observable(帧级写入),消费纪律:
 * - 引擎/渲染循环:reaction/autorun(CameraMotionSampler、PlaybackDriver);
 * - UI 显示:经 PlayheadDisplay 节流为低频值后 observer 直读;
 * - 禁止 observer 组件渲染期直读 time(帧级写入会导致逐帧重渲)。
 */
export class TimeTransport {
    private playheadSeconds = 0;
    private playing = false;
    private stopSequence = 0;

    constructor() {
        makeAutoObservable(this);
    }

    get time(): number {
        return this.playheadSeconds;
    }

    get isPlaying(): boolean {
        return this.playing;
    }

    /** 停止事件与 playhead=0 区分：协调器据此恢复实体权威变换。 */
    get stoppedAt(): number {
        return this.stopSequence;
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
        this.stopSequence += 1;
    }

    seek(timeSeconds: number): void {
        this.playheadSeconds = Math.max(0, timeSeconds);
    }

    /** 渲染循环每帧调用;暂停时是空操作,零分配 */
    tick(deltaSeconds: number): void {
        if (!this.playing) return;
        this.playheadSeconds += deltaSeconds;
    }
}
