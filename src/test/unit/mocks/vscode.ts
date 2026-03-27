/**
 * Lightweight mock of the `vscode` module for pure unit tests.
 * Only stubs the surface area actually used by source modules under test.
 */

export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
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

export class Uri {
    static file(path: string): Uri {
        return new Uri('file', '', path, '', '');
    }
    static joinPath(base: Uri, ...pathSegments: string[]): Uri {
        const joined = [base.fsPath, ...pathSegments].join('/');
        return Uri.file(joined);
    }
    static parse(value: string): Uri {
        return new Uri('parsed', '', value, '', '');
    }
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly fsPath: string;
    readonly query: string;
    readonly fragment: string;
    private constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.fsPath = path;
        this.query = query;
        this.fragment = fragment;
    }
    toString(): string {
        return `${this.scheme}://${this.path}`;
    }
}

export class RelativePattern {
    constructor(public base: string | Uri, public pattern: string) {}
}

export enum CommentThreadState {
    Unresolved = 0,
    Resolved = 1,
}

export const workspace = {
    fs: {
        readFile: async (_uri: Uri): Promise<Uint8Array> => new Uint8Array(),
        writeFile: async (_uri: Uri, _content: Uint8Array): Promise<void> => {},
        createDirectory: async (_uri: Uri): Promise<void> => {},
    },
    workspaceFolders: undefined as any,
    asRelativePath: (uri: any, _includeWorkspace?: boolean): string => {
        if (typeof uri === 'string') { return uri; }
        return uri.fsPath || uri.path || String(uri);
    },
    getConfiguration: (_section?: string) => ({
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
    }),
    createFileSystemWatcher: (_pattern: any) => ({
        onDidChange: (_cb: any) => ({ dispose: () => {} }),
        onDidCreate: (_cb: any) => ({ dispose: () => {} }),
        onDidDelete: (_cb: any) => ({ dispose: () => {} }),
        dispose: () => {},
    }),
    onDidChangeTextDocument: (_cb: any) => ({ dispose: () => {} }),
    onDidRenameFiles: (_cb: any) => ({ dispose: () => {} }),
    onDidDeleteFiles: (_cb: any) => ({ dispose: () => {} }),
    onDidOpenTextDocument: (_cb: any) => ({ dispose: () => {} }),
    onDidChangeConfiguration: (_cb: any) => ({ dispose: () => {} }),
};

export const window = {
    showInputBox: async (_options?: any): Promise<string | undefined> => undefined,
    showQuickPick: async (_items: any, _options?: any): Promise<any> => undefined,
    showWarningMessage: async (..._args: any[]): Promise<any> => undefined,
    showInformationMessage: async (..._args: any[]): Promise<any> => undefined,
    showErrorMessage: async (..._args: any[]): Promise<any> => undefined,
    activeTextEditor: undefined as any,
    visibleTextEditors: [] as any[],
    onDidChangeActiveTextEditor: (_cb: any) => ({ dispose: () => {} }),
    createTextEditorDecorationType: (_options: any) => ({
        dispose: () => {},
    }),
};

export const commands = {
    registerCommand: (_command: string, _callback: (...args: any[]) => any) => ({
        dispose: () => {},
    }),
};

export const languages = {
    registerHoverProvider: (_selector: any, _provider: any) => ({
        dispose: () => {},
    }),
};

export const comments = {
    createCommentController: (_id: string, _label: string) => ({
        options: {},
        commentingRangeProvider: undefined as any,
        createCommentThread: (_uri: any, _range: any, _comments: any) => ({
            contextValue: '',
            label: undefined as string | undefined,
            state: 0,
            canReply: true,
            comments: [] as any[],
            dispose: () => {},
        }),
        dispose: () => {},
    }),
};

export class Range {
    constructor(
        public readonly startLine: number,
        public readonly startCharacter: number,
        public readonly endLine: number,
        public readonly endCharacter: number,
    ) {}
    get start() { return { line: this.startLine, character: this.startCharacter }; }
    get end() { return { line: this.endLine, character: this.endCharacter }; }
}

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
}

export class MarkdownString {
    value = '';
    isTrusted = false;
    appendMarkdown(value: string): MarkdownString { this.value += value; return this; }
}

export class Hover {
    constructor(public contents: MarkdownString | MarkdownString[]) {}
}

export class ThemeColor {
    constructor(public readonly id: string) {}
}

export enum CommentMode {
    Preview = 0,
    Editing = 1,
}

export enum OverviewRulerLane {
    Left = 1,
    Center = 2,
    Right = 4,
    Full = 7,
}
