import { functions } from "./auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Called from trip.html "Get recommendations" panel (destination-level research).
export async function getRecommendations(tripId, { destination, startDate, endDate, interests }) {
  const getTripRecommendations = httpsCallable(functions, "getTripRecommendations");
  const result = await getTripRecommendations({ tripId, destination, startDate, endDate, interests });
  return result.data; // { text: string }
}

// Called from a day drill-in's "Plan this day" button. Returns structured
// suggestions the UI can add to the itinerary individually, rather than
// free-form text.
export async function planDay(tripId, { destination, date, existingItems, interests }) {
  const planDayFn = httpsCallable(functions, "planDay");
  const result = await planDayFn({ tripId, destination, date, existingItems, interests });
  return result.data; // { suggestions: [{ time, type, title, location, notes, cost }] }
}
