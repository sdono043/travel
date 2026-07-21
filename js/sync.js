import { getGoogleAccessToken, functions, signInWithGoogle } from "./auth.js";
import { geocodeLocation } from "./geocode.js";
import { updateBookingLocation } from "./trips.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const GMAIL_QUERY =
  'category:primary newer_than:180d (subject:(confirmation OR itinerary OR "booking confirmed" OR reservation) (flight OR hotel OR "rental car" OR itinerary OR trip))';

async function gmailApi(path, token) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json();
}

async function calendarApi(path, token) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);
  return res.json();
}

function decodeBase64Url(data) {
  return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
}

function extractPlainText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

async function fetchRecentTravelEmails(token, maxResults = 15) {
  const list = await gmailApi(`messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=${maxResults}`, token);
  const ids = (list.messages || []).map((m) => m.id);
  const snippets = [];
  for (const id of ids) {
    const msg = await gmailApi(`messages/${id}?format=full`, token);
    const subjectHeader = msg.payload.headers.find((h) => h.name === "Subject");
    const fromHeader = msg.payload.headers.find((h) => h.name === "From");
    const body = extractPlainText(msg.payload).slice(0, 4000);
    snippets.push({
      subject: subjectHeader?.value || "",
      from: fromHeader?.value || "",
      body,
    });
  }
  return snippets;
}

async function fetchUpcomingCalendarEvents(token) {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();
  const data = await calendarApi(
    `calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`,
    token
  );
  return (data.items || []).map((e) => ({
    subject: e.summary || "",
    from: "calendar",
    body: `${e.description || ""}\nLocation: ${e.location || ""}\nStart: ${e.start?.dateTime || e.start?.date}\nEnd: ${e.end?.dateTime || e.end?.date}`,
  }));
}

// Called from trip.html "Sync from Gmail/Calendar" button.
export async function syncFromGoogle(tripId) {
  let token = getGoogleAccessToken();
  if (!token) {
    await signInWithGoogle({ requestGmailAndCalendar: true });
    token = getGoogleAccessToken();
  }
  if (!token) throw new Error("Google sign-in did not return an access token.");

  const [emails, events] = await Promise.all([
    fetchRecentTravelEmails(token),
    fetchUpcomingCalendarEvents(token),
  ]);

  const syncGmailBookings = httpsCallable(functions, "syncGmailBookings");
  const result = await syncGmailBookings({ tripId, items: [...emails, ...events] });

  // Best-effort: geocode each new booking's location so it can show up as a
  // map pin. Failures here shouldn't block the sync from being reported as
  // successful.
  for (const booking of result.data.bookings) {
    if (!booking.location) continue;
    try {
      const geo = await geocodeLocation(booking.location);
      if (geo) await updateBookingLocation(tripId, booking.id, geo.lat, geo.lng);
    } catch {
      // ignore — the booking still saved, just without a map pin
    }
  }

  return result.data; // { added: number, bookings: [...] }
}
