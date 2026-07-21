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
        },
        required: ["type", "details", "confirmationNumber", "startDate", "cost"],
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
