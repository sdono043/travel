const Anthropic = require("@anthropic-ai/sdk");
const { requireFamilyMember } = require("./_lib/firebaseAdmin");
const { applyCors } = require("./_lib/cors");

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { db, admin } = await requireFamilyMember(req);
    const { tripId, destination, startDate, endDate, interests, bookings } = req.body || {};
    if (!tripId || !destination) {
      return res.status(400).json({ error: "tripId and destination are required." });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const bookingsSummary = (Array.isArray(bookings) ? bookings : [])
      .map((b) => {
        const dates = b.endDate && b.endDate !== b.startDate ? `${b.startDate} to ${b.endDate}` : b.startDate;
        return `- ${b.type}: ${b.details}${dates ? ` (${dates})` : ""}${b.location ? ` @ ${b.location}` : ""}`;
      })
      .join("\n");

    const hasSpecificAsk = !!(interests && interests.trim());

    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      output_config: { effort: "high" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages: [
        {
          role: "user",
          content:
            `A family is planning/taking a trip to ${destination} from ${startDate} to ${endDate}.\n\n` +
            (bookingsSummary
              ? `Already booked for this trip:\n${bookingsSummary}\n\n`
              : "Nothing is booked for this trip yet.\n\n") +
            (hasSpecificAsk
              ? `The user's request: "${interests.trim()}"\n\n` +
                "Answer exactly what they asked for — nothing broader. Do NOT include flight or hotel research, " +
                "a trip overview, or any other booking category unless the request specifically asks for it. If " +
                "they already have a hotel/area booked above, use its location to ground your suggestions (e.g. " +
                "distance/drive time from it) rather than proposing alternative lodging. Search the web for " +
                "current, specific, real options (actual names/addresses, not generic categories) and give 3-6 " +
                "concrete recommendations with brief reasons and rough current price ranges (USD) where relevant."
              : "The user hasn't specified what they want yet, so give general family-friendly ideas: skip any " +
                "booking category listed as already booked above, and focus research on what's still open " +
                "(e.g. skip flights/hotels if already booked, and cover activities/dining instead). Search for " +
                "current, specific, real options with rough current price ranges (USD), and note that prices are " +
                "estimates to verify before booking."),
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
