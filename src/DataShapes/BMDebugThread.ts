
/**
 * An enum that contains constants describing a debug thread's state.
 */
const enum BMDebugThreadState {

    /**
     * Indicates that the thread is currently running.
     */
    Running = 'running',

    /**
     * Indicates that the thread is currently suspended.
     */
    Suspended = 'suspended'
}

/**
 * A data shape that describes a thread.
 */
class BMDebugThread extends DataShapeBase {

    /**
     * The thread's java ID.
     */
    @primaryKey ID!: number;

    /**
     * The thread's state.
     */
    state!: STRING<BMDebugThreadState>;

    /**
     * For suspended threads, the reason for which the thread is suspended.
     */
    reason?: string;

    /**
     * For suspended threads, the stack trace at the moment of suspension.
     */
    stackTrace?: string;
}