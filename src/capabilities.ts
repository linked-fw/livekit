import type { Enforcement } from '@_linked/live-sessions';

/** Observed with self-hosted LiveKit 1.13.7; fine per-listener ACL is not enforced. */
export const liveKitCapabilities: Readonly<Record<Enforcement, boolean>> = Object.freeze({
  'room-isolation': true,
  'coarse-subscribe-deny': true,
  'per-listener-track-acl': false,
});
