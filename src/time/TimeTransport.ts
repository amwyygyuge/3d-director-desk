import { makeAutoObservable } from "mobx";

/** 时间轴的权威播放边界(窄端口):时钟只读秒数，永不反向依赖 TimelineStore。 */
export interface TimelinePlaybackRangeSource {
    readonly durationSeconds: number;
    readonly inSeconds: number;
    readonly outSeconds: number;
}

/**
 * 统一时钟(阶段二时间轴的地基)。
 *
 * 所有时间驱动的子系统(骨骼动作/走位/运镜/音频)共享同一个 playhead:
 * - 播放期:渲染循环调 tick(delta),transport 推进 playhead;
 * - 拖动定位(时间轴 UI):seek(t) 直接设 playhead。
 *
 * 播放范围封顶:playhead 双端钳在入出点内。播过出点即停(或按 loop 回到入点),
 * 让作者能只审看/导出一段而不改工程片长。
 *
 * playhead 是 observable(帧级写入),消费纪律:
 * - 引擎/渲染循环:reaction/autorun(AnimationBinder、PlaybackDriver);
 * - UI 显示:经 PlayheadDisplay 节流为低频值后 observer 直读;
 * - 禁止 observer 组件渲染期直读 time(帧级写入会导致逐帧重渲)。
 */
export class TimeTransport {
    private playheadSeconds = 0;
    private playing = false;
    private stopSequence = 0;
    /** 循环开关:编排期反复看同一段是评估节奏的唯一手段 */
    private looping = false;

    constructor(private readonly durationSource: TimelinePlaybackRangeSource) {
        makeAutoObservable<TimeTransport, "durationSource">(this, { durationSource: false });
    }

    get time(): number {
        return this.playheadSeconds;
    }

    get isPlaying(): boolean {
        return this.playing;
    }

    get isLooping(): boolean {
        return this.looping;
    }

    get durationSeconds(): number {
        return this.durationSource.durationSeconds;
    }

    get playbackInSeconds(): number {
        return this.durationSource.inSeconds;
    }

    get playbackOutSeconds(): number {
        return this.durationSource.outSeconds;
    }

    /** 停止事件与 playhead=播放入点区分：协调器据此恢复实体权威变换。 */
    get stoppedAt(): number {
        return this.stopSequence;
    }

    play(): void {
        this.seek(this.playheadSeconds);
        this.playing = true;
    }

    pause(): void {
        this.playing = false;
    }

    stop(): void {
        this.playing = false;
        this.seek(this.playbackInSeconds);
        this.stopSequence += 1;
    }

    setLooping(looping: boolean): void {
        this.looping = looping;
    }

    seek(timeSeconds: number): void {
        this.playheadSeconds = Math.min(Math.max(this.playbackInSeconds, timeSeconds), this.playbackOutSeconds);
    }

    /** 渲染循环每帧调用;暂停时是空操作,零分配 */
    tick(deltaSeconds: number): void {
        if (!this.playing) return;
        const next = this.playheadSeconds + deltaSeconds;
        const outSeconds = this.playbackOutSeconds;
        if (next < outSeconds) {
            this.playheadSeconds = next;
            return;
        }
        this.playheadSeconds = this.looping ? this.playbackInSeconds : outSeconds;
        if (!this.looping) this.playing = false;
    }
}
