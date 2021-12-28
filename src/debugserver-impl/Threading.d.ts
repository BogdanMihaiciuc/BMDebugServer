/**
 * An interface describing a java lock.
 */
interface Lock {
    /**
     * Acquires the lock.
     */
    lock(): void;

    /**
     * Releases the lock.
     */
    unlock(): void;

    /**
     * 
     */
    newCondition(): Condition;
}

/**
 * Conditions provide a means for one thread to suspend execution (to "wait") 
 * until notified by another thread that some state condition may now be true.
 * 
 * Because access to this shared state information occurs in different threads, 
 * it must be protected, so a lock of some form is associated with the condition. 
 * 
 * The key property that waiting for a condition provides is that it atomically 
 * releases the associated lock and suspends the current thread.
 */
interface Condition {
    /**
     * Causes the current thread to wait until it is signalled or interrupted.
     */
    await(): void;

    /**
     * Wakes up one waiting thread.
     */
    signal(): void;

    /**
     * Wakes up all waiting threads.
     */
    signalAll(): void;
}

/**
 * This class provides thread-local variables. 
 * 
 * These variables differ from their normal counterparts in that each thread that accesses one (via its get or set method) 
 * has its own, independently initialized copy of the variable. ThreadLocal instances are typically private static fields 
 * in classes that wish to associate state with a thread (e.g., a user ID or Transaction ID).
 */
interface ThreadLocal<T> {
    /**
     * Returns the value in the current thread's copy of this thread-local variable.
     */
    get(): T | null;

    /**
     * Sets the current thread's copy of this thread-local variable to the specified value.
     * @param value     The value.
     */
    set(value: T): void;
}

interface Packages {
    [key: string]: any;
}

declare const Packages: Packages;