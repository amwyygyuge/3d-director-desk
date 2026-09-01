import { makeAutoObservable } from "mobx";

/** 时间轴的权威时长来源(窄端口):TimelineStore 天然满足,时钟不反向依赖整个 Store。 */
export interface TimelineDurationSource {
    readonly durationSeconds: number;
}

/**
 * 统一时钟(阶段二时间轴的地基)。
 *
 * 所有时间驱动的子系统(骨骼动作/走位/运镜/音频)共享同一个 playhead:
 * - 播放期:渲染循环调 tick(delta),transport 推进 playhead;
 * - 拖动定位(时间轴 UI):seek(t) 直接设 playhead。
 *
 * 时长封顶:playhead 双端钳在 [0, duration]。播过尾后 Program 无输出、画面停住而时间继续涨
 * 是编排期反复踩的坑,故到尾即停(或按 loop 回到 0),时长仍以时间轴文档为唯一权威。
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

    constructor(private readonly durationSource: TimelineDurationSource) {
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

    setLooping(looping: boolean): void {
        this.looping = looping;
    }

    seek(timeSeconds: number): void {
        this.playheadSeconds = Math.min(Math.max(0, timeSeconds), this.durationSeconds);
    }

    /** 渲染循环每帧调用;暂停时是空操作,零分配 */
    tick(deltaSeconds: number): void {
        if (!this.playing) return;
        const next = this.playheadSeconds + deltaSeconds;
        const duration = this.durationSeconds;
        if (next < duration) {
            this.playheadSeconds = next;
            return;
        }
        this.playheadSeconds = this.looping ? 0 : duration;
        if (!this.looping) this.playing = false;
    }
}
