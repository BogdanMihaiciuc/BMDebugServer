declare class HashMap<K, V> {
    clear(): void;
    put(key: K, value: V): void;
    get(key: K): V | undefined;
    remove(key: K): void;
    size(): number;
    containsKey(key: K): boolean;
    containsValue(value: V): boolean;
}

declare class WeakReference<T> {
    get(): T;
}