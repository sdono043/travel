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
            description:
              "Single physical venue/address, for mapping — e.g. a hotel or activity's name/address. " +
              "Always empty string for flights and rental cars (a flight has two airports, not one point).",
          },
          likelyMatch: {
            type: "boolean",
            description:
              "True if this booking's dates/destination plausibly belong to the trip described below. False if " +
              "it looks like a different trip (e.g. unrelated dates or a different city).",
          },
        },
        required: ["type", "details", "confirmationNumber", "startDate", "cost", "location", "likelyMatch"],
        additionalProperties: false,
      },
    },
  },
  required: ["bookings"],
  additionalProperties: false,
};

// Note: this endpoint no longer writes anything to Firestore. It only
// extracts candidate bookings from the raw inbox/calendar items and hands
// them back — the client shows a review step so the user can pick which
// ones actually belong to this trip before anything is saved.
module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireFamilyMember(req);
    const { tripId, items, destination, startDate, endDate } = req.body || {};
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
            "Extract every genuine travel booking confirmation (flights, hotels, rental cars, paid activities) " +
            "into structured bookings — across ANY trip, not just the one below. Ignore anything that isn't an " +
            "actual booking confirmation (newsletters, marketing, unrelated calendar events). If a field isn't " +
            `present in the source text, use an empty string for text fields or 0 for cost.\n\n` +
            `The trip currently being planned is: destination "${destination || "unknown"}", dates ${startDate || "?"} ` +
            `to ${endDate || "?"}. For each booking you find, set likelyMatch to true only if its dates/destination ` +
            "plausibly belong to this specific trip — set it to false for anything that looks like a different trip " +
            "(e.g. clearly different city, or dates far outside this range). Still include non-matching bookings in " +
            "the list — just mark them false — so the user can decide.\n\n" +
            itemsText,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(textBlock.text);

    return res.status(200).json({ candidates: parsed.bookings });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};
