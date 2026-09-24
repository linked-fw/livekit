import { Room, type RemoteTrackPublication } from 'livekit-client';
import type { MediaCredential, SubscriptionIntent } from '@_linked/live-sessions';
export type { SubscriptionIntent } from '@_linked/live-sessions';

export class LiveKitClientSession {
  readonly room: Room;

  constructor(room?: Room) {
    this.room = room ?? new Room();
  }

  async connect(credential: MediaCredential): Promise<void> {
    if (credential.expiresAtMs <= Date.now()) throw new Error('expired-credential');
    await this.room.connect(credential.serverUrl, credential.token, { autoSubscribe: false });
  }

  applySubscriptions(intents: readonly SubscriptionIntent[]): void {
    const wanted = new Map(intents.map(intent => [intent.trackSid, intent.subscribed]));
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const desired = wanted.get(publication.trackSid);
        if (desired !== undefined) (publication as RemoteTrackPublication).setSubscribed(desired);
      }
    }
  }

  async disconnect(): Promise<void> { await this.room.disconnect(); }
}
