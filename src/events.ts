/** Minimal event interface matching vscode.EventEmitter's shape */
export interface SimpleEvent<T> {
    (listener: (e: T) => void): { dispose(): void };
}

export class SimpleEventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];

    readonly event: SimpleEvent<T> = (listener) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };

    fire(data: T): void {
        for (const listener of this.listeners) {
            listener(data);
        }
    }

    dispose(): void {
        this.listeners = [];
    }
}
