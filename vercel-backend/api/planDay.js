const Anthropic = require("@anthropic-ai/sdk");
const { requireFamilyMember } = require("./_lib/firebaseAdmin");
const { applyCors } = require("./_lib/cors");

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

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await requireFamilyMember(req);
    const { tripId, destination, date, existingItems, interests } = req.body || {};
    if (!tripId || !destination || !date) {
      return res.status(400).json({ error: "tripId, destination, and date are required." });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    return res.status(200).json({ suggestions: parsed.suggestions });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};
