import { TrackSource } from '@livekit/protocol';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { validateDecision, type AdmissionDecision, type MediaCredential, type MediaCredentialMinter, type MediaSource, type RevocationResult } from '@_linked/live-sessions';
import { liveKitCapabilities } from './capabilities.js';

export interface LiveKitServerConfig {
  /** Browser-reachable wss:// URL (ws:// only for explicit local development). */
  readonly publicUrl: string;
  /** Server-side http(s) API URL. */
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Maximum token age in seconds; default and upper bound are 60. */
  readonly maxTokenTtlSeconds?: number;
  readonly roomService?: Pick<RoomServiceClient, 'removeParticipant' | 'createRoom' | 'deleteRoom'>;
}

const sourceMap: Record<MediaSource, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

export interface RevokeRequest {
  readonly room: string;
  readonly participantIdentity: string;
  readonly credentialExpiresAtMs: number;
}

export class LiveKitServerAdapter implements MediaCredentialMinter {
  readonly capabilities = liveKitCapabilities;
  private readonly roomService: Pick<RoomServiceClient, 'removeParticipant' | 'createRoom' | 'deleteRoom'>;
  private readonly ttl: number;

  constructor(private readonly config: LiveKitServerConfig) {
    const publicUrl = new URL(config.publicUrl);
    const apiUrl = new URL(config.apiUrl);
    if (!['wss:', 'ws:'].includes(publicUrl.protocol) || !['https:', 'http:'].includes(apiUrl.protocol) ||
        !config.apiKey || !config.apiSecret) throw new Error('invalid-livekit-config');
    if (publicUrl.protocol === 'ws:' && publicUrl.hostname !== 'localhost' && publicUrl.hostname !== '127.0.0.1')
      throw new Error('insecure-public-url');
    if (apiUrl.protocol === 'http:' && apiUrl.hostname !== 'localhost' && apiUrl.hostname !== '127.0.0.1')
      throw new Error('insecure-api-url');
    this.ttl = config.maxTokenTtlSeconds ?? 60;
    if (!Number.isInteger(this.ttl) || this.ttl < 1 || this.ttl > 60) throw new Error('invalid-token-ttl');
    this.roomService = config.roomService ?? new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  }

  async mint(decision: AdmissionDecision, nowMs: number): Promise<MediaCredential> {
    // Never let a stale caller-supplied clock extend a policy decision.
    const effectiveNowMs = Math.max(nowMs, Date.now());
    validateDecision(decision, effectiveNowMs);
    const ttl = Math.min(this.ttl, Math.floor((decision.expiresAtMs - effectiveNowMs) / 1000));
    if (ttl < 1) throw new Error('decision-expires-too-soon');
    const token = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: decision.participantIdentity,
      ttl,
    });
    token.addGrant({
      room: decision.mediaRoom,
      roomJoin: true,
      roomAdmin: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
      ingressAdmin: false,
      canPublish: decision.allowedPublishSources.length > 0,
      ...(decision.allowedPublishSources.length > 0 ? { canPublishSources: decision.allowedPublishSources.map(s => sourceMap[s]) } : {}),
      canSubscribe: decision.canSubscribe,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return {
      token: await token.toJwt(),
      serverUrl: this.config.publicUrl,
      room: decision.mediaRoom,
      participantIdentity: decision.participantIdentity,
      expiresAtMs: effectiveNowMs + ttl * 1000,
    };
  }

  /** Create only after the application has admitted this generation and set its capacity. */
  async createRoom(name: string, maxParticipants: number): Promise<void> {
    if (!name.trim() || !Number.isInteger(maxParticipants) || maxParticipants < 1) throw new Error('invalid-room');
    await this.roomService.createRoom({ name, maxParticipants });
  }

  /** End a superseded physical audience room after approved participants have moved. */
  async retireRoom(name: string): Promise<void> {
    if (!name.trim()) throw new Error('invalid-room');
    await this.roomService.deleteRoom(name);
  }

  /** Removal is acknowledged by LiveKit; a previously issued token can still be reusable. */
  async revoke(request: RevokeRequest): Promise<RevocationResult> {
    if (!request.room.trim() || !request.participantIdentity.trim() || !Number.isFinite(request.credentialExpiresAtMs))
      throw new Error('invalid-revocation');
    await this.roomService.removeParticipant(request.room, request.participantIdentity);
    return { transportAcknowledged: true, tokenReusePrevented: false, credentialExpiresAtMs: request.credentialExpiresAtMs };
  }
}
