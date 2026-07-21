const Anthropic = require("@anthropic-ai/sdk");
const { requireFamilyMember } = require("./_lib/firebaseAdmin");
const { applyCors } = require("./_lib/cors");

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

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { db, admin } = await requireFamilyMember(req);
    const { tripId, items } = req.body || {};
    if (!tripId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "tripId and a non-empty items array are required." });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    return res.status(200).json({ added: added.length, bookings: added });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};
