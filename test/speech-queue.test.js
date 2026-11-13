import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpeechQueue } from '../src/feedback/speech-queue.js';

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('does not interrupt active speech and selects waiting items by stable priority', async () => {
  const starts = [];
  let finishActive;
  const queue = createSpeechQueue({ delay: async () => {} });
  const play = (name, wait = false) => () => {
    starts.push(name);
    return wait ? new Promise((resolve) => { finishActive = resolve; }) : undefined;
  };

  queue.enqueue({ eventKey: 'routine-1', priority: 30, play: play('routine-1', true) });
  queue.enqueue({ eventKey: 'complete', priority: 100, play: play('complete') });
  queue.enqueue({ eventKey: 'correction', priority: 80, play: play('correction') });
  queue.enqueue({ eventKey: 'correction-2', priority: 80, play: play('correction-2') });
  await nextTurn();
  assert.deepEqual(starts, ['routine-1']);

  finishActive();
  await nextTurn();
  assert.deepEqual(starts, ['routine-1', 'complete', 'correction', 'correction-2']);
});

test('coalesces duplicate keys and continues after a playback error', async () => {
  const starts = [];
  const errors = [];
  const queue = createSpeechQueue({
    delay: async () => {},
    onError: (error) => errors.push(error),
  });
  queue.enqueue({
    eventKey: 'same',
    play: async () => { starts.push('first'); },
  });
  assert.equal(queue.enqueue({
    eventKey: 'same',
    play: async () => { starts.push('duplicate'); },
  }), false);
  queue.enqueue({
    eventKey: 'broken',
    priority: 1,
    play: async () => { throw new Error('device error'); },
  });
  queue.enqueue({
    eventKey: 'after-error',
    play: async () => { starts.push('after-error'); },
  });

  await nextTurn();
  assert.deepEqual(starts, ['first', 'after-error']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /device error/);
  assert.equal(queue.enqueue({
    eventKey: 'broken',
    play: async () => { starts.push('retried-broken'); },
  }), true);
  await nextTurn();
  assert.deepEqual(starts, ['first', 'after-error', 'retried-broken']);
});

test('deduplicates keys while queued, active, and for 4500 ms after completion', async () => {
  let timestamp = 1000;
  let finishActive;
  const starts = [];
  const queue = createSpeechQueue({
    delay: async () => {},
    now: () => timestamp,
  });
  queue.enqueue({
    eventKey: 'same',
    play: () => {
      starts.push('first');
      return new Promise((resolve) => { finishActive = resolve; });
    },
  });
  assert.equal(queue.enqueue({ eventKey: 'same', play: () => {} }), false);
  await nextTurn();
  assert.deepEqual(starts, ['first']);
  assert.equal(queue.enqueue({ eventKey: 'same', play: () => {} }), false);
  queue.enqueue({ eventKey: 'different', play: () => { starts.push('different'); } });

  finishActive();
  await nextTurn();
  assert.deepEqual(starts, ['first', 'different']);

  timestamp = 5499;
  assert.equal(queue.enqueue({ eventKey: 'same', play: () => { starts.push('too-soon'); } }), false);
  timestamp = 5500;
  assert.equal(queue.enqueue({ eventKey: 'same', play: () => { starts.push('after-window'); } }), true);
  await nextTurn();
  assert.deepEqual(starts, ['first', 'different', 'after-window']);
});

test('waits the configured gap between consecutive completed items', async () => {
  const delays = [];
  const starts = [];
  const queue = createSpeechQueue({
    delay: async (duration) => { delays.push(duration); },
  });
  queue.enqueue({ eventKey: 'first', play: () => { starts.push('first'); } });
  queue.enqueue({ eventKey: 'second', play: () => { starts.push('second'); } });
  queue.enqueue({ eventKey: 'third', play: () => { starts.push('third'); } });

  await nextTurn();
  assert.deepEqual(starts, ['first', 'second', 'third']);
  assert.deepEqual(delays, [350, 350]);
});

test('clearPending discards waiting items without interrupting active speech', async () => {
  let finishActive;
  let activeCancelled = false;
  const starts = [];
  const queue = createSpeechQueue({ delay: async () => {} });
  queue.enqueue({
    eventKey: 'active',
    play: () => {
      starts.push('active');
      return new Promise((resolve) => { finishActive = resolve; });
    },
    cancel: () => { activeCancelled = true; },
  });
  queue.enqueue({ eventKey: 'pending', play: () => { starts.push('pending'); } });
  await nextTurn();

  queue.clearPending();
  assert.deepEqual(starts, ['active']);
  assert.equal(activeCancelled, false);
  assert.equal(queue.enqueue({ eventKey: 'pending', play: () => { starts.push('requeued'); } }), true);
  queue.clearPending();
  finishActive();
  await nextTurn();
  assert.deepEqual(starts, ['active']);
});

test('cancel clears pending items, calls active cancellation, and ignores late playback rejection', async () => {
  let rejectOldPlayback;
  let cancellationCount = 0;
  const starts = [];
  const errors = [];
  const queue = createSpeechQueue({
    delay: async () => {},
    onError: (error) => errors.push(error),
  });
  queue.enqueue({
    eventKey: 'old-active',
    play: () => {
      starts.push('old-active');
      return new Promise((resolve, reject) => {
        rejectOldPlayback = reject;
      });
    },
    cancel: () => { cancellationCount += 1; },
  });
  queue.enqueue({ eventKey: 'discarded', play: () => { starts.push('discarded'); } });
  await nextTurn();
  assert.deepEqual(starts, ['old-active']);

  queue.cancel();
  assert.equal(cancellationCount, 1);
  queue.enqueue({ eventKey: 'new-generation', play: () => { starts.push('new-generation'); } });
  await nextTurn();
  assert.deepEqual(starts, ['old-active', 'new-generation']);

  rejectOldPlayback(new Error('late old-generation failure'));
  await nextTurn();
  assert.deepEqual(starts, ['old-active', 'new-generation']);
  assert.deepEqual(errors, []);
});

test('a throwing cancellation callback cannot stall the queue', async () => {
  let rejectActive;
  const errors = [];
  const starts = [];
  const queue = createSpeechQueue({
    delay: async () => {},
    onError: (error) => errors.push(error),
  });
  queue.enqueue({
    eventKey: 'active',
    play: () => new Promise((resolve, reject) => { rejectActive = reject; }),
    cancel: () => { throw new Error('cancel adapter failed'); },
  });
  queue.enqueue({ eventKey: 'next', play: () => { starts.push('next'); } });
  await nextTurn();

  queue.cancel();
  queue.enqueue({ eventKey: 'new', play: () => { starts.push('new'); } });
  await nextTurn();
  assert.deepEqual(starts, ['new']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /cancel adapter failed/);

  rejectActive(new Error('late cancelled failure'));
  await nextTurn();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /cancel adapter failed/);
});

test('an asynchronous cancellation failure is reported without stalling the queue', async () => {
  const errors = [];
  const starts = [];
  const queue = createSpeechQueue({
    delay: async () => {},
    onError: (error) => errors.push(error),
  });
  queue.enqueue({
    eventKey: 'active',
    play: () => new Promise(() => {}),
    cancel: () => Promise.reject(new Error('async cancel failed')),
  });
  await nextTurn();

  queue.cancel();
  queue.enqueue({ eventKey: 'next', play: () => { starts.push('next'); } });
  await nextTurn();

  assert.deepEqual(starts, ['next']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /async cancel failed/);
});

test('cancel during the gap wakes the drain and starts the new generation', async () => {
  let releaseDelay;
  const starts = [];
  const queue = createSpeechQueue({
    delay: () => new Promise((resolve) => { releaseDelay = resolve; }),
  });
  queue.enqueue({ eventKey: 'first', play: () => { starts.push('first'); } });
  queue.enqueue({ eventKey: 'discarded', play: () => { starts.push('discarded'); } });
  await nextTurn();
  assert.deepEqual(starts, ['first']);
  assert.equal(typeof releaseDelay, 'function');

  queue.cancel();
  queue.enqueue({ eventKey: 'new-generation', play: () => { starts.push('new'); } });
  await nextTurn();
  assert.deepEqual(starts, ['first', 'new']);
  releaseDelay();
});

test('a delay rejection is reported without preventing later items from running', async () => {
  const starts = [];
  const errors = [];
  const queue = createSpeechQueue({
    delay: async () => { throw new Error('gap failed'); },
    onError: (error) => errors.push(error),
  });
  queue.enqueue({ eventKey: 'first', play: () => { starts.push('first'); } });
  queue.enqueue({ eventKey: 'second', play: () => { starts.push('second'); } });

  await nextTurn();
  assert.deepEqual(starts, ['first', 'second']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /gap failed/);
});
