import { getGoogleAccessToken, signInWithGoogle, getIdToken } from "./auth.js";
import { API_BASE_URL } from "./firebase-config.js";

// No category: restriction — Gmail auto-sorts most hotel/flight confirmation
// emails into "Updates" or "Promotions", not "Primary", so filtering to
// Primary silently misses them. Keeping this broad (not subject-only) means
// more false positives reach Claude, but that's cheap — a missed booking
// email can never be recovered, so recall matters more than precision here.
const GMAIL_QUERY =
  'newer_than:180d (confirmation OR confirmed OR itinerary OR reservation OR "booking confirmed" OR flight OR hotel OR "rental car" OR "car rental" OR "e-ticket")';

// Thrown when Google rejects the cached access token (expired — they're only
// good for about an hour) so the caller knows to clear it and re-auth, rather
// than surfacing a raw "401" to the user.
class GoogleAuthError extends Error {
  constructor(message) {
    super(message);
    this.isAuthError = true;
  }
}

async function gmailApi(path, token) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new GoogleAuthError(`Gmail API error: ${res.status}`);
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json();
}

async function calendarApi(path, token) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new GoogleAuthError(`Calendar API error: ${res.status}`);
  if (!res.ok) throw new Error(`Calendar API error: ${res.status}`);
  return res.json();
}

function decodeBase64Url(data) {
  return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
}

function findPart(payload, mimeType) {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findPart(part, mimeType);
      if (found) return found;
    }
  }
  return null;
}

// Booking confirmations (hotels especially) are almost always sent as
// HTML-only emails with no text/plain alternative. The old fallback here
// returned the raw, undecoded HTML — check-in/check-out tables buried under
// a wall of markup/CSS that got cut off by the length limit before Claude
// ever saw the actual dates. Parsing it as a DOM and reading textContent
// gives Claude the same readable text a human sees.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body?.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function extractPlainText(payload) {
  const plainPart = findPart(payload, "text/plain");
  if (plainPart) return decodeBase64Url(plainPart.body.data);
  const htmlPart = findPart(payload, "text/html");
  if (htmlPart) return htmlToText(decodeBase64Url(htmlPart.body.data));
  if (payload?.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

async function fetchRecentTravelEmails(token, maxResults = 25) {
  const list = await gmailApi(`messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=${maxResults}`, token);
  const ids = (list.messages || []).map((m) => m.id);
  const snippets = [];
  for (const id of ids) {
    const msg = await gmailApi(`messages/${id}?format=full`, token);
    const subjectHeader = msg.payload.headers.find((h) => h.name === "Subject");
    const fromHeader = msg.payload.headers.find((h) => h.name === "From");
    const body = extractPlainText(msg.payload).slice(0, 8000);
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

// Called from trip.html "Sync from Gmail/Calendar" button. Returns candidate
// bookings for review — nothing is saved yet. The caller shows a pick list
// and only writes the ones the user selects (see addSyncCandidate in trip.html).
export async function syncFromGoogle(tripId, { destination, startDate, endDate } = {}) {
  let token = getGoogleAccessToken();
  if (!token) {
    await signInWithGoogle({ requestGmailAndCalendar: true });
    token = getGoogleAccessToken();
  }
  if (!token) throw new Error("Google sign-in did not return an access token.");

  let emails, events;
  try {
    [emails, events] = await Promise.all([fetchRecentTravelEmails(token), fetchUpcomingCalendarEvents(token)]);
  } catch (err) {
    // The cached access token is only good for about an hour. If Google
    // rejects it, the old code would keep reusing the same dead token forever
    // (getGoogleAccessToken only re-prompts when nothing is cached at all) —
    // clear it and prompt for a fresh one instead of surfacing a raw 401.
    if (!err.isAuthError) throw err;
    sessionStorage.removeItem("googleAccessToken");
    await signInWithGoogle({ requestGmailAndCalendar: true });
    token = getGoogleAccessToken();
    if (!token) throw new Error("Google sign-in did not return an access token.");
    [emails, events] = await Promise.all([fetchRecentTravelEmails(token), fetchUpcomingCalendarEvents(token)]);
  }

  const idToken = await getIdToken();
  const res = await fetch(`${API_BASE_URL}/api/syncGmailBookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ tripId, items: [...emails, ...events], destination, startDate, endDate }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Sync failed (${res.status})`);
  return data; // { candidates: [{ type, details, confirmationNumber, startDate, cost, location, likelyMatch }] }
}
