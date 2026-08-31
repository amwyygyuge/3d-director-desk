import { DirectorCommand } from "./DirectorCommand";
import type { CommandDispatcher } from "./CommandDispatcher";
import type { DirectorContext } from "./DirectorCommand";

interface SeekPayload {
    readonly time: number;
}

const EMPTY_PAYLOAD: Record<string, never> = {};

/** Camera sequence transport commands. They drive Program motion only, never model animation. */
export class TransportPlayCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "transport.play";
    readonly type = TransportPlayCommand.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.play();
    }
}

export class TransportPauseCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "transport.pause";
    readonly type = TransportPauseCommand.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.pause();
    }
}

export class TransportStopCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "transport.stop";
    readonly type = TransportStopCommand.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.stop();
        ctx.playback.sampleCurrent();
    }
}

export class TransportSeekCommand extends DirectorCommand<SeekPayload> {
    static readonly TYPE = "transport.seek";
    readonly type = TransportSeekCommand.TYPE;

    constructor(readonly payload: SeekPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return Number.isFinite(this.payload.time) && this.payload.time >= 0 && this.payload.time <= ctx.timeline.duration
            ? []
            : ["镜头播放头必须位于序列时长内"];
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.seek(this.payload.time);
        ctx.playback.sampleCurrent();
    }
}

export function registerTransportCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(TransportPlayCommand.TYPE, () => new TransportPlayCommand());
    dispatcher.register(TransportPauseCommand.TYPE, () => new TransportPauseCommand());
    dispatcher.register(TransportStopCommand.TYPE, () => new TransportStopCommand());
    dispatcher.register(TransportSeekCommand.TYPE, (payload: SeekPayload) => new TransportSeekCommand(payload));
}
