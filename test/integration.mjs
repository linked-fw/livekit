import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { RoomServiceClient } from 'livekit-server-sdk';
import { LiveKitServerAdapter } from '../dist/server.js';

const apiUrl = process.env.LIVEKIT_API_URL ?? 'http://127.0.0.1:7880';
const publicUrl = process.env.LIVEKIT_URL ?? 'ws://127.0.0.1:7880';
const apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
const apiSecret = process.env.LIVEKIT_API_SECRET ?? 'secret';
const bundle = await build({ entryPoints: [fileURLToPath(new URL('./browser-probe.ts', import.meta.url))], bundle: true, platform: 'browser', format: 'iife', write: false });
const source = bundle.outputFiles[0].text;
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(`<html><body><script>${source}</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const adapter = new LiveKitServerAdapter({ publicUrl, apiUrl, apiKey, apiSecret });
  const admin = new RoomServiceClient(apiUrl, apiKey, apiSecret);
  const decision = {
    principalIri: 'https://example.org/people/1', audienceIri: 'https://example.org/audiences/1',
    audienceGeneration: 'g1', mediaRoom: `linked-livekit-${process.pid}-g1`,
    participantIdentity: 'opaque-person', mediaProfile: 'call', allowedPublishSources: ['microphone'],
    canSubscribe: true, expiresAtMs: Date.now() + 120_000, policyVersion: 'v1',
  };
  await adapter.createRoom(decision.mediaRoom, 2);
  const credential = await adapter.mint(decision, Date.now());
  const joined = await page.evaluate(cred => window.linkedLiveKitProbe.open(cred), credential);
  assert.equal(joined, decision.mediaRoom);
  assert.equal(await page.evaluate(() => window.linkedLiveKitProbe.camera()), 'denied');

  const revoked = await adapter.revoke({ room: credential.room, participantIdentity: credential.participantIdentity, credentialExpiresAtMs: credential.expiresAtMs });
  await page.waitForFunction(() => window.linkedLiveKitProbe.state() === 'disconnected');
  assert.equal(revoked.transportAcknowledged, true);
  const oldTokenRejoined = await page.evaluate(cred => window.linkedLiveKitProbe.open(cred), credential);
  assert.equal(oldTokenRejoined, decision.mediaRoom);

  await admin.removeParticipant(decision.mediaRoom, decision.participantIdentity,
    { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) + 1) });
  await page.waitForFunction(() => window.linkedLiveKitProbe.state() === 'disconnected');
  const timestampOldTokenRejoined = await page.evaluate(cred => window.linkedLiveKitProbe.open(cred), credential);
  assert.equal(timestampOldTokenRejoined, decision.mediaRoom);

  await page.evaluate(() => window.linkedLiveKitProbe.close());
  const rotatedDecision = { ...decision, audienceGeneration: 'g2', mediaRoom: `linked-livekit-${process.pid}-g2` };
  await adapter.createRoom(rotatedDecision.mediaRoom, 2);
  const rotatedCredential = await adapter.mint(rotatedDecision, Date.now());
  const rotatedJoined = await page.evaluate(cred => window.linkedLiveKitProbe.open(cred), rotatedCredential);
  assert.equal(rotatedJoined, rotatedDecision.mediaRoom);
  await adapter.retireRoom(decision.mediaRoom);
  console.log(JSON.stringify({ joined, cameraDenied: true, removed: revoked.transportAcknowledged,
    oldTokenRejoined: true, timestampOldTokenRejoined: true, rotatedJoined, oldRoomRetired: true }, null, 2));
} finally {
  await page.evaluate(() => window.linkedLiveKitProbe.close()).catch(() => {});
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
