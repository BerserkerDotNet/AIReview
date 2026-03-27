import { ReviewThread, ReviewComment, ReviewData } from '../../models';

export function createComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
    return {
        id: 'comment-' + Math.random().toString(36).slice(2, 8),
        author: 'user',
        body: 'Test comment body',
        timestamp: new Date().toISOString(),
        ...overrides,
    };
}

export function createThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
    return {
        id: 'thread-' + Math.random().toString(36).slice(2, 8),
        filePath: 'src/test.ts',
        lineNumber: 1,
        status: 'open',
        createdAt: new Date().toISOString(),
        comments: [createComment()],
        ...overrides,
    };
}

export function createReviewData(threads: ReviewThread[] = []): ReviewData {
    return { version: 1, threads };
}
