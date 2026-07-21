import { db } from "./auth.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// status is one of "idea" | "booked". A trip is auto-promoted from idea to
// booked by the sync Cloud Function as soon as a real flight/hotel
// confirmation is found for it.
export async function listTrips() {
  const q = query(collection(db, "trips"), orderBy("startDate", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getTrip(tripId) {
  const snap = await getDoc(doc(db, "trips", tripId));
  if (!snap.exists()) throw new Error("Trip not found");
  return { id: snap.id, ...snap.data() };
}

export async function createTrip({ name, destination, startDate, endDate, status, createdBy }) {
  const ref = await addDoc(collection(db, "trips"), {
    name,
    destination,
    startDate,
    endDate,
    status: status || "idea",
    createdBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteTrip(tripId) {
  await deleteDoc(doc(db, "trips", tripId));
}

export async function setTripStatus(tripId, status) {
  await updateDoc(doc(db, "trips", tripId), { status });
}

// Geocoded once per trip and cached on the trip doc so the weather forecast
// (and anything else keyed off the destination) doesn't re-geocode on every
// page load.
export async function updateTripLocation(tripId, { lat, lng }) {
  await updateDoc(doc(db, "trips", tripId), { lat, lng });
}

export async function listBookings(tripId) {
  const q = query(collection(db, "trips", tripId, "bookings"), orderBy("startDate", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addBooking(tripId, booking) {
  const ref = await addDoc(collection(db, "trips", tripId, "bookings"), {
    ...booking,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteBooking(tripId, bookingId) {
  await deleteDoc(doc(db, "trips", tripId, "bookings", bookingId));
}

export async function updateBookingLocation(tripId, bookingId, { lat, lng }) {
  await updateDoc(doc(db, "trips", tripId, "bookings", bookingId), { lat, lng });
}

export async function listRecommendations(tripId) {
  const q = query(collection(db, "trips", tripId, "recommendations"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
