/**
 * Module-level store for communicating a pending channel auto-join
 * from CrewScreen ("open radio" button) to RadioScreen (on focus).
 */
let _pendingChannelId = null;

export function requestJoinChannel(channelId) {
  _pendingChannelId = channelId;
}

/** Returns and clears the pending channel ID (one-shot). */
export function consumeJoinRequest() {
  const ch = _pendingChannelId;
  _pendingChannelId = null;
  return ch;
}
