import { GOOGLE_PLACES_KEY } from '../config/keys';

// Reuse the same key for all Google APIs
const KEY = GOOGLE_PLACES_KEY;

function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export async function getDirections(originLat, originLon, destLat, destLon) {
  const url =
    `https://maps.googleapis.com/maps/api/directions/json` +
    `?origin=${originLat},${originLon}&destination=${destLat},${destLon}&mode=driving&key=${KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') return null;
  const leg = data.routes[0].legs[0];
  return {
    coordinates: decodePolyline(data.routes[0].overview_polyline.points),
    distance: leg.distance.text,
    duration: leg.duration.text,
    durationValue: leg.duration.value,
  };
}

export async function getETAs(origins, destLat, destLon) {
  if (!origins.length) return [];
  const originsStr = origins.map((o) => `${o.lat},${o.lon}`).join('|');
  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json` +
    `?origins=${encodeURIComponent(originsStr)}&destinations=${destLat},${destLon}&mode=driving&key=${KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.rows.map((row, i) => ({
    uid: origins[i].uid,
    duration: row.elements[0].duration?.text ?? 'unknown',
    durationValue: row.elements[0].duration?.value ?? 0,
    distance: row.elements[0].distance?.text ?? 'unknown',
  }));
}
