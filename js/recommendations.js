import { functions } from "./auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

// Called from trip.html "Get recommendations" panel.
export async function getRecommendations(tripId, { destination, startDate, endDate, interests }) {
  const getTripRecommendations = httpsCallable(functions, "getTripRecommendations");
  const result = await getTripRecommendations({ tripId, destination, startDate, endDate, interests });
  return result.data; // { text: string }
}
