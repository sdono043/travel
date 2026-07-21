import { db } from "./auth.js";
import { geocodeLocation } from "./geocode.js";
import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Ordered by date only (avoids needing a composite index); sort by time
// client-side within a day when rendering.
export async function listItinerary(tripId) {
  const q = query(collection(db, "trips", tripId, "itinerary"), orderBy("date", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addItineraryItem(tripId, item) {
  let lat = item.lat ?? null;
  let lng = item.lng ?? null;
  if ((lat == null || lng == null) && item.location) {
    const geo = await geocodeLocation(item.location);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
    }
  }
  const ref = await addDoc(collection(db, "trips", tripId, "itinerary"), {
    ...item,
    lat,
    lng,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteItineraryItem(tripId, itemId) {
  await deleteDoc(doc(db, "trips", tripId, "itinerary", itemId));
}
