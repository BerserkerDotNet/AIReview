import * as assert from 'assert';
import { SimpleEventEmitter } from '../../events';

suite('SimpleEventEmitter', () => {
    test('fire() delivers to all listeners', () => {
        const emitter = new SimpleEventEmitter<number>();
        const calls: number[] = [];
        emitter.event(() => calls.push(1));
        emitter.event(() => calls.push(2));
        emitter.event(() => calls.push(3));

        emitter.fire(42);

        assert.deepStrictEqual(calls, [1, 2, 3]);
    });

    test('fire() passes correct data', () => {
        const emitter = new SimpleEventEmitter<{ name: string; value: number }>();
        let received: { name: string; value: number } | undefined;
        emitter.event(data => { received = data; });

        const payload = { name: 'test', value: 99 };
        emitter.fire(payload);

        assert.deepStrictEqual(received, payload);
    });

    test('listener dispose removes only that listener', () => {
        const emitter = new SimpleEventEmitter<string>();
        const calls: string[] = [];
        const subA = emitter.event(() => calls.push('A'));
        emitter.event(() => calls.push('B'));

        subA.dispose();
        emitter.fire('go');

        assert.deepStrictEqual(calls, ['B']);
    });

    test('dispose() removes all listeners', () => {
        const emitter = new SimpleEventEmitter<number>();
        let callCount = 0;
        emitter.event(() => callCount++);
        emitter.event(() => callCount++);

        emitter.dispose();
        emitter.fire(1);

        assert.strictEqual(callCount, 0);
    });

    test('fire() with no listeners is a no-op', () => {
        const emitter = new SimpleEventEmitter<void>();
        assert.doesNotThrow(() => emitter.fire(undefined as never));
    });

    test('multiple fires deliver multiple times', () => {
        const emitter = new SimpleEventEmitter<number>();
        const received: number[] = [];
        emitter.event(n => received.push(n));

        emitter.fire(1);
        emitter.fire(2);
        emitter.fire(3);

        assert.deepStrictEqual(received, [1, 2, 3]);
    });

    test('listener added after fire does not receive past events', () => {
        const emitter = new SimpleEventEmitter<string>();
        const received: string[] = [];

        emitter.fire('first');
        emitter.event(s => received.push(s));
        emitter.fire('second');

        assert.deepStrictEqual(received, ['second']);
    });
});
