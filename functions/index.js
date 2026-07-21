const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

admin.initializeApp();
const db = admin.firestore();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

async function requireFamilyMember(auth) {
  const email = auth?.token?.email;
  if (!email) throw new HttpsError("unauthenticated", "Sign in required.");
  const doc = await db.collection("familyMembers").doc(email.toLowerCase()).get();
  if (!doc.exists) throw new HttpsError("permission-denied", "Not on the family allowlist.");
  return email;
}

const BOOKING_SCHEMA = {
  type: "object",
  properties: {
    bookings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["flight", "hotel", "car", "activity"] },
          details: { type: "string" },
          confirmationNumber: { type: "string" },
          startDate: { type: "string" },
          cost: { type: "number" },
          location: {
            type: "string",
            description: "Property/venue name or address, for mapping. Empty string if unknown.",
          },
        },
        required: ["type", "details", "confirmationNumber", "startDate", "cost", "location"],
        additionalProperties: false,
      },
    },
  },
  required: ["bookings"],
  additionalProperties: false,
};

exports.syncGmailBookings = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  await requireFamilyMember(request.auth);
  const { tripId, items } = request.data;
  if (!tripId || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "tripId and a non-empty items array are required.");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

  const itemsText = items
    .slice(0, 30)
    .map((item, i) => `--- Item ${i + 1} ---\nFrom: ${item.from}\nSubject: ${item.subject}\n${item.body}`)
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    output_config: { effort: "medium", format: { type: "json_schema", schema: BOOKING_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          "The following are raw email subjects/bodies and calendar events from a family member's inbox. " +
          "Extract only genuine travel booking confirmations (flights, hotels, rental cars, paid activities) " +
          "into structured bookings. Ignore anything that isn't an actual booking confirmation (newsletters, " +
          "marketing, unrelated calendar events). If a field isn't present in the source text, use an empty " +
          `string for text fields or 0 for cost.\n\n${itemsText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const parsed = JSON.parse(textBlock.text);

  const batch = db.batch();
  const bookingsRef = db.collection("trips").doc(tripId).collection("bookings");
  const added = [];
  for (const booking of parsed.bookings) {
    const ref = bookingsRef.doc();
    batch.set(ref, {
      ...booking,
      source: "gmail_sync",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    added.push({ id: ref.id, ...booking });
  }
  await batch.commit();

  // A real flight/hotel confirmation means the trip is no longer just an
  // idea — auto-promote it so it shows up under "Booked Trips".
  const hasConfirmedBooking = parsed.bookings.some((b) => b.type === "flight" || b.type === "hotel");
  if (hasConfirmedBooking) {
    const tripRef = db.collection("trips").doc(tripId);
    const tripSnap = await tripRef.get();
    if (tripSnap.exists && tripSnap.data().status === "idea") {
      await tripRef.update({ status: "booked", promotedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }

  return { added: added.length, bookings: added };
});

exports.getTripRecommendations = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  await requireFamilyMember(request.auth);
  const { tripId, destination, startDate, endDate, interests } = request.data;
  if (!tripId || !destination) {
    throw new HttpsError("invalid-argument", "tripId and destination are required.");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    output_config: { effort: "high" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
    messages: [
      {
        role: "user",
        content:
          `Research current flight, hotel, and activity options for a family trip to ${destination} ` +
          `from ${startDate} to ${endDate}. Focus areas: ${interests || "general family-friendly recommendations"}. ` +
          "Search for up-to-date information rather than relying on memory. Give a concise, organized answer " +
          "with rough current price ranges (USD) for flights and hotels, and 3-5 specific recommendations " +
          "with brief reasons. Note that prices are estimates and should be verified before booking.",
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const ref = await db.collection("trips").doc(tripId).collection("recommendations").add({
    destination,
    startDate,
    endDate,
    interests: interests || "",
    text,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: ref.id, text };
});

const DAY_PLAN_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          time: { type: "string", description: "e.g. 09:00, or empty string if flexible" },
          type: { type: "string", enum: ["activity", "meal", "other"] },
          title: { type: "string" },
          location: { type: "string", description: "Name or address, for mapping" },
          notes: { type: "string" },
          cost: { type: "number", description: "Rough estimate in USD, 0 if free/unknown" },
        },
        required: ["time", "type", "title", "location", "notes", "cost"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

// Called from a booked trip's day drill-in ("Plan this day"). Returns
// structured meal/activity suggestions the UI can add to the itinerary
// individually, rather than a block of free-form text.
exports.planDay = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  await requireFamilyMember(request.auth);
  const { tripId, destination, date, existingItems, interests } = request.data;
  if (!tripId || !destination || !date) {
    throw new HttpsError("invalid-argument", "tripId, destination, and date are required.");
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

  const existingText = (existingItems || [])
    .map((i) => `- ${i.time || ""} ${i.type}: ${i.title}`)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    output_config: { effort: "medium", format: { type: "json_schema", schema: DAY_PLAN_SCHEMA } },
    messages: [
      {
        role: "user",
        content:
          `Suggest 3-5 meals and activities for a family day trip in ${destination} on ${date}. ` +
          `Interests/constraints: ${interests || "general family-friendly"}. ` +
          `Already scheduled that day (don't duplicate or conflict with these):\n${existingText || "(nothing yet)"}\n\n` +
          "Spread suggestions across the day (morning/afternoon/evening) with rough times, and keep the group's " +
          "existing plans in mind so nothing overlaps.",
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const parsed = JSON.parse(textBlock.text);
  return { suggestions: parsed.suggestions };
});
