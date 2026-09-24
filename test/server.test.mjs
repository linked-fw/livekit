import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { LiveKitServerAdapter } from '../dist/server.js';

const key = 'test-key';
const secret = 'this-is-a-local-test-secret-with-enough-length';
const decision = { principalIri: 'https://example.org/people/1', audienceIri: 'https://example.org/rooms/1', audienceGeneration: '2', mediaRoom: 'room-generation-2', participantIdentity: 'opaque-1', mediaProfile: 'call', allowedPublishSources: ['microphone'], canSubscribe: false, expiresAtMs: Date.now() + 120_000, policyVersion: '3' };
const calls = [];
const adapter = new LiveKitServerAdapter({ publicUrl: 'ws://localhost:7880', apiUrl: 'http://localhost:7880', apiKey: key, apiSecret: secret, roomService: { removeParticipant: async (...args) => { calls.push(args); }, createRoom: async () => ({}), deleteRoom: async () => {} } });

test('mints a short-lived room-only human grant with source and subscriber restrictions', async () => {
  const now = Date.now();
  const credential = await adapter.mint(decision, now);
  const grant = await new TokenVerifier(key, secret).verify(credential.token);
  assert.equal(grant.video?.room, decision.mediaRoom);
  assert.equal(grant.video?.roomJoin, true);
  assert.equal(grant.video?.roomAdmin, false);
  assert.deepEqual(grant.video?.canPublishSources, ['microphone']);
  assert.equal(grant.video?.canSubscribe, false);
  assert.equal(grant.video?.canPublishData, false);
  assert.ok(credential.expiresAtMs - now <= 60_000);
});
test('empty publisher sources cannot publish', async () => {
  const credential = await adapter.mint({ ...decision, allowedPublishSources: [] }, Date.now());
  const grant = await new TokenVerifier(key, secret).verify(credential.token);
  assert.equal(grant.video?.canPublish, false);
  assert.equal(grant.video?.canPublishSources, undefined);
});
test('a stale supplied clock cannot extend an expired decision', async () => {
  await assert.rejects(adapter.mint({ ...decision, expiresAtMs: Date.now() - 1 }, 1), /expired/);
});
test('reports missing per-listener enforcement and honest removal acknowledgement', async () => {
  assert.equal(adapter.capabilities['per-listener-track-acl'], false);
  const result = await adapter.revoke({ room: decision.mediaRoom, participantIdentity: decision.participantIdentity, credentialExpiresAtMs: 123 });
  assert.deepEqual(calls[0], [decision.mediaRoom, decision.participantIdentity]);
  assert.equal(result.transportAcknowledged, true);
  assert.equal(result.tokenReusePrevented, false);
});
test('uses the application room cap and propagates failed removal', async () => {
  const created = [];
  const failing = new LiveKitServerAdapter({ publicUrl: 'ws://localhost:7880', apiUrl: 'http://localhost:7880', apiKey: key, apiSecret: secret,
    roomService: { createRoom: async options => { created.push(options); return {}; }, deleteRoom: async () => {}, removeParticipant: async () => { throw Error('media service unavailable'); } } });
  await failing.createRoom('room-generation-2', 24);
  assert.deepEqual(created, [{ name: 'room-generation-2', maxParticipants: 24 }]);
  await assert.rejects(failing.revoke({ room: 'room-generation-2', participantIdentity: 'opaque-1', credentialExpiresAtMs: 123 }), /media service unavailable/);
});
test('retires a superseded physical room through the media service', async () => {
  const retired = [];
  const retiring = new LiveKitServerAdapter({ publicUrl: 'ws://localhost:7880', apiUrl: 'http://localhost:7880', apiKey: key, apiSecret: secret,
    roomService: { createRoom: async () => ({}), removeParticipant: async () => {}, deleteRoom: async name => { retired.push(name); } } });
  await retiring.retireRoom('old-generation');
  assert.deepEqual(retired, ['old-generation']);
});
