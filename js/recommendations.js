import { getIdToken } from "./auth.js";
import { API_BASE_URL } from "./firebase-config.js";

async function callApi(path, body) {
  const idToken = await getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Called from trip.html "Get recommendations" panel (destination-level research).
// `bookings` (already-saved flights/hotels/cars/activities) is passed along so
// the backend can answer in context — e.g. suggest dinner spots near an
// already-booked hotel instead of re-researching flights nobody asked about.
export async function getRecommendations(tripId, { destination, startDate, endDate, interests, bookings }) {
  return callApi("/api/getTripRecommendations", { tripId, destination, startDate, endDate, interests, bookings });
  // { text: string }
}

// Called from a day drill-in's "Plan this day" button. Returns structured
// suggestions the UI can add to the itinerary individually, rather than
// free-form text.
export async function planDay(tripId, { destination, date, existingItems, interests }) {
  return callApi("/api/planDay", { tripId, destination, date, existingItems, interests });
  // { suggestions: [{ time, type, title, location, notes, cost }] }
}
