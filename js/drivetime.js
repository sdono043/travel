// Free driving-time estimates via OSRM's public demo routing server — no API
// key, but it's a shared demo instance, so this is only called once per hotel
// checkout and the result is cached by the caller.
export async function getDrivingDuration(lat1, lng1, lat2, lng2) {
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;
    return { durationSeconds: route.duration, distanceMeters: route.distance };
  } catch {
    return null;
  }
}

// The last run of consecutive capitalized, all-alphabetic words in a string
// — used to pull a plausible city name out of free-text flight details
// without grabbing the airline name or flight number (e.g. "Allegiant G4
// 2715 Tampa" -> "Tampa", not "Allegiant Tampa").
function lastCityToken(text) {
  const words = text.trim().split(/\s+/);
  let lastRun = [];
  let currentRun = [];
  for (const w of words) {
    if (/^[A-Z][a-zA-Z]*$/.test(w)) {
      currentRun.push(w);
    } else {
      if (currentRun.length) lastRun = currentRun;
      currentRun = [];
    }
  }
  if (currentRun.length) lastRun = currentRun;
  return lastRun.length ? lastRun.join(" ") : null;
}

// Guess a geocode-able "<city> airport" search string for the DEPARTURE side
// of a flight, from its free-text `details` field. Handles both the clean
// "Airline FLT123 CityA -> CityB" format and the older "... departing CityA
// (CODE) arriving CityB (CODE)" phrasing. Falls back to the trip's
// destination when details doesn't parse cleanly.
export function guessDepartureAirportQuery(details, fallbackDestination) {
  if (details) {
    const arrowSplit = details.split(/\s*(?:->|-->|→)\s*/);
    if (arrowSplit.length >= 2) {
      const city = lastCityToken(arrowSplit[0]);
      if (city) return `${city} airport`;
    }
    const departingMatch = details.match(/departing\s+([A-Za-z][A-Za-z .]*?)(?:\s*\(|\s+arriving|,|$)/i);
    if (departingMatch) return `${departingMatch[1].trim()} airport`;
  }
  return fallbackDestination ? `${fallbackDestination} airport` : null;
}
