const admin = require("firebase-admin");

function getAdminApp() {
  if (admin.apps.length) return admin.app();
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Verifies the caller's Firebase ID token and checks the family allowlist.
// Throws an Error with .statusCode set on failure — callers should catch and
// respond with that status.
async function requireFamilyMember(req) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error("Missing Authorization header");
    err.statusCode = 401;
    throw err;
  }

  const app = getAdminApp();
  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(match[1]);
  } catch {
    const err = new Error("Invalid or expired sign-in token");
    err.statusCode = 401;
    throw err;
  }

  const email = (decoded.email || "").toLowerCase();
  if (!email) {
    const err = new Error("Token has no email");
    err.statusCode = 401;
    throw err;
  }

  const db = admin.firestore(app);
  const memberDoc = await db.collection("familyMembers").doc(email).get();
  if (!memberDoc.exists) {
    const err = new Error("Not on the family allowlist");
    err.statusCode = 403;
    throw err;
  }

  return { email, db, admin };
}

module.exports = { getAdminApp, requireFamilyMember };
