import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveKitClientSession } from '../dist/client.js';

test('applies subscriptions only to known publications', () => {
  const calls = [];
  const publication = { trackSid: 'TR_1', setSubscribed: value => calls.push(value) };
  const room = { remoteParticipants: new Map([['p', { trackPublications: new Map([['TR_1', publication]]) }]]) };
  const session = new LiveKitClientSession(room);
  session.applySubscriptions([{ trackSid: 'TR_1', subscribed: true }, { trackSid: 'TR_missing', subscribed: true }]);
  assert.deepEqual(calls, [true]);
});
