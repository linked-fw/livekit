import { Track } from 'livekit-client';
import { LiveKitClientSession } from '../src/client.js';

let session: LiveKitClientSession | undefined;
Object.assign(window, {
  linkedLiveKitProbe: {
    async open(credential: Parameters<LiveKitClientSession['connect']>[0]) {
      session = new LiveKitClientSession();
      await session.connect(credential);
      return session.room.name;
    },
    state() { return session?.room.state; },
    async camera() {
      if (!session) throw new Error('not-connected');
      const canvas = document.createElement('canvas');
      canvas.width = 2; canvas.height = 2;
      const track = canvas.captureStream(1).getVideoTracks()[0];
      try {
        await session.room.localParticipant.publishTrack(track, { source: Track.Source.Camera });
        return 'allowed';
      } catch { return 'denied'; }
      finally { track.stop(); }
    },
    async close() { await session?.disconnect(); session = undefined; },
  },
});
