import * as assert from 'assert';
import { normalizePath } from '../../pathUtils';

suite('normalizePath', () => {
    test('returns forward-slash paths unchanged', () => {
        assert.strictEqual(normalizePath('src/app.ts'), 'src/app.ts');
    });

    test('converts backslashes to forward slashes', () => {
        assert.strictEqual(normalizePath('src\\app.ts'), 'src/app.ts');
    });

    test('converts mixed separators', () => {
        assert.strictEqual(normalizePath('src\\components/App.tsx'), 'src/components/App.tsx');
    });

    test('handles deeply nested backslash paths', () => {
        assert.strictEqual(normalizePath('a\\b\\c\\d\\e.ts'), 'a/b/c/d/e.ts');
    });

    test('handles empty string', () => {
        assert.strictEqual(normalizePath(''), '');
    });

    test('handles path with no separators', () => {
        assert.strictEqual(normalizePath('file.ts'), 'file.ts');
    });
});
