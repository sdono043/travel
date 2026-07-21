// Free, keyless geocoding via OpenStreetMap's Nominatim search API. Fine for
// occasional, user-initiated lookups in a small family app; don't call this
// in a tight loop (Nominatim's usage policy caps at ~1 request/second).
export async function geocodeLocation(text) {
  if (!text) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(text)}`
    );
    if (!res.ok) return null;
    const results = await res.json();
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}
