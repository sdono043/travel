const Anthropic = require("@anthropic-ai/sdk");
const { requireFamilyMember } = require("./_lib/firebaseAdmin");
const { applyCors } = require("./_lib/cors");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { db, admin } = await requireFamilyMember(req);
    const { tripId, destination, startDate, endDate, interests } = req.body || {};
    if (!tripId || !destination) {
      return res.status(400).json({ error: "tripId and destination are required." });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    return res.status(200).json({ id: ref.id, text });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};
