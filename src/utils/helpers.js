// ─── Shared Constants ─────────────────────────────────────────────────────────

export const ORANGE = '#f97316';

export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#57606f' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f4f5e' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0d5ce' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
];

// ─── Shared Helpers ───────────────────────────────────────────────────────────

/** Convert a Firestore Timestamp, Date, or number to a JS Date. */
export function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

/** Return up to 2 uppercase initials from a display name. */
export function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * Deterministic avatar background color derived from a user's UID.
 * Always returns the same color for the same UID across the entire app.
 */
export function getAvatarColor(uid) {
  const colors = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ef4444', '#06b6d4', '#f59e0b', '#ec4899'];
  return colors[(uid?.charCodeAt(0) ?? 0) % colors.length];
}

/** Format a car object into a human-readable string, e.g. "2020 Toyota Supra · Red". */
export function formatCarString(car) {
  if (!car) return '';
  const { year, make, model, color } = car;
  const base = [year, make, model].filter(Boolean).join(' ');
  if (!base) return '';
  return color ? `${base} · ${color}` : base;
}
