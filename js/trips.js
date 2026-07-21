import { db } from "./auth.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
    status: status || "planning",
    createdBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteTrip(tripId) {
  await deleteDoc(doc(db, "trips", tripId));
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

export async function listRecommendations(tripId) {
  const q = query(collection(db, "trips", tripId, "recommendations"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
