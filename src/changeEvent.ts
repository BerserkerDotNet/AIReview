export interface ThreadChangeEvent {
    type: 'add' | 'update' | 'delete' | 'reload';
    threadId?: string;
    filePath?: string;
}
