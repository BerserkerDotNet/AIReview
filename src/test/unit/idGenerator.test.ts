import * as assert from 'assert';
import { generateThreadId, generateCommentId } from '../../idGenerator';

suite('idGenerator', () => {
    suite('generateThreadId', () => {
        test('returns Adjective-Noun-suffix format', () => {
            const id = generateThreadId();
            const parts = id.split('-');
            // At minimum: Adjective, Noun, suffix (some nouns contain hyphens like "Hot-Take")
            assert.ok(parts.length >= 3, `Expected at least 3 parts, got: ${id}`);
        });

        test('suffix is 4 characters', () => {
            const id = generateThreadId();
            const lastDash = id.lastIndexOf('-');
            const suffix = id.substring(lastDash + 1);
            assert.strictEqual(suffix.length, 4, `Expected 4-char suffix, got "${suffix}" in ${id}`);
        });

        test('generates unique IDs across multiple calls', () => {
            const ids = new Set<string>();
            for (let i = 0; i < 100; i++) {
                ids.add(generateThreadId());
            }
            // With 1600 combos × 1.6M suffixes, 100 IDs should all be unique
            assert.strictEqual(ids.size, 100, 'Expected 100 unique IDs');
        });

        test('uses known adjectives and nouns', () => {
            const knownAdjectives = [
                'Snarky', 'Grumpy', 'Pedantic', 'Nitpicky', 'Sassy',
                'Skeptical', 'Judgmental', 'Caffeinated', 'Dramatic', 'Unimpressed',
                'Bewildered', 'Overworked', 'Exasperated', 'Passive', 'Reluctant',
                'Eloquent', 'Impatient', 'Savage', 'Ruthless', 'Blunt',
                'Petty', 'Smug', 'Cranky', 'Weary', 'Deadpan',
                'Sardonic', 'Cynical', 'Jaded', 'Relentless', 'Merciless',
                'Tireless', 'Thorough', 'Prickly', 'Fussy', 'Withering',
                'Scathing', 'Sarcastic', 'Spirited', 'Feisty', 'Shameless',
            ];

            // Generate several IDs and check the adjective (first segment) is valid
            for (let i = 0; i < 20; i++) {
                const id = generateThreadId();
                const adjective = id.split('-')[0];
                assert.ok(
                    knownAdjectives.includes(adjective),
                    `Unknown adjective "${adjective}" in ID: ${id}`
                );
            }
        });

        test('word lists have 40 entries each', () => {
            // Smoke test: generate many IDs and collect distinct adjectives/nouns
            const adjectives = new Set<string>();
            const nouns = new Set<string>();
            for (let i = 0; i < 5000; i++) {
                const id = generateThreadId();
                const lastDash = id.lastIndexOf('-');
                const namepart = id.substring(0, lastDash);
                const firstDash = namepart.indexOf('-');
                adjectives.add(namepart.substring(0, firstDash));
                nouns.add(namepart.substring(firstDash + 1));
            }
            // With 5000 samples we should see most of the 40 entries
            assert.ok(adjectives.size >= 30, `Expected ≥30 distinct adjectives, got ${adjectives.size}`);
            assert.ok(nouns.size >= 30, `Expected ≥30 distinct nouns, got ${nouns.size}`);
        });
    });

    suite('generateCommentId', () => {
        test('returns a non-empty string', () => {
            const id = generateCommentId();
            assert.ok(id.length > 0, 'Expected non-empty comment ID');
        });

        test('generates unique IDs', () => {
            const ids = new Set<string>();
            for (let i = 0; i < 50; i++) {
                ids.add(generateCommentId());
            }
            assert.strictEqual(ids.size, 50, 'Expected 50 unique comment IDs');
        });
    });
});
