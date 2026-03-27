export interface ReviewComment {
    id: string;
    author: 'user' | 'llm';
    body: string;
    timestamp: string;
    editedAt?: string;
}

export interface ReviewThread {
    id: string;
    filePath: string;
    /** lineNumber is 1-indexed (line 1 = first line of the file). */
    lineNumber: number;
    status: 'open' | 'resolved';
    createdAt: string;
    comments: ReviewComment[];
}

export interface ReviewData {
    version: number;
    threads: ReviewThread[];
}
