# Setup

One-time steps to get the site running. Frontend is plain HTML/JS on GitHub Pages. Firebase (free Spark plan) provides auth and the database. The three backend functions (Gmail/Calendar sync, AI recommendations, day planning) run on Vercel instead of Firebase Cloud Functions — Cloud Functions require the paid Blaze plan (a card on file) even to stay within the free usage tier, so this setup avoids that entirely.

**Status for this project:** the steps below are already done for `donovan-family-travel` (Firebase project) and `donovan-family-travel-api` (Vercel project). This doc is for reference / redoing it if you ever rotate credentials or fork the project.

## 1. Firebase project (Spark/free plan — no billing needed)

1. [Firebase console](https://console.firebase.google.com/) → **Add project**.
2. **Build → Authentication → Sign-in method**: enable **Email/Password** and **Google**.
3. **Build → Firestore Database**: create a database (production mode). Requires the Cloud Firestore API to be enabled on the underlying Google Cloud project first (Firebase will prompt/link to this if needed).
4. **Project settings → General → Your apps → Add app → Web**. Copy the resulting `firebaseConfig` object into `js/firebase-config.js`.
5. Put the project ID in `.firebaserc`.
6. Deploy Firestore rules/indexes: `firebase deploy --only firestore:rules,firestore:indexes --project <project-id>` (requires `npm install -g firebase-tools` and `firebase login`).

## 2. Family allowlist

The allowlist is a Firestore collection, not something the site can self-serve (`firestore.rules` denies all client access to it). Add each family member in the Firebase console under **Firestore Database → Start collection → `familyMembers`**:

- Document ID: the member's email address, **lowercase**
- Any field (e.g. `role: "owner"`) — the document just needs to exist

Only emails present here can create an account on `index.html`.

## 3. Google Cloud OAuth (Gmail + Calendar, for the sync feature)

Same underlying Google Cloud project as Firebase — use the [Google Cloud console](https://console.cloud.google.com/).

1. **APIs & Services → Library**: enable the **Gmail API** and **Google Calendar API**.
2. **Google Auth Platform → Audience**: set to **Testing** (not "In production") — this avoids the scary "unverified app" warning for family members. Add each family Google account under **Test users** (max 100).
3. **Google Auth Platform → Data Access**: add scopes `.../auth/gmail.readonly` and `.../auth/calendar.readonly` (paste the full scope URLs in "Manually add scopes" if they don't show up in the filtered list).

No separate OAuth client needed — Firebase Auth's Google provider already has one; `signInWithPopup` + `GoogleAuthProvider.addScope` in `js/auth.js` requests these scopes at sign-in time.

## 4. Backend functions on Vercel

The three functions (`syncGmailBookings`, `getTripRecommendations`, `planDay`) live in `vercel-backend/` and deploy as a **separate Vercel project** from the GitHub Pages frontend.

1. Install the CLI and log in yourself (real OAuth login — don't have an assistant do this): `npm install -g vercel` then `vercel login`.
2. From `vercel-backend/`, deploy: `vercel --prod`. First run creates the project.
3. Get a Firebase service account key: **Firebase console → Project settings → Service accounts → Generate new private key**. This downloads a JSON file — keep it private, never commit it.
4. In the Vercel project's dashboard (**Settings → Environment Variables**), add:
   - `FIREBASE_SERVICE_ACCOUNT_KEY` — paste the entire contents of the downloaded JSON file
   - `ANTHROPIC_API_KEY` — your key from the [Anthropic Console](https://console.anthropic.com/settings/keys)
5. Redeploy so the functions pick up the new env vars: `vercel --prod` again.
6. Copy the production URL (e.g. `https://donovan-family-travel-api.vercel.app`) into `API_BASE_URL` in `js/firebase-config.js`.

If you ever need to redeploy after editing `vercel-backend/`, just run `vercel --prod` from that directory again.

## 5. Push the frontend to GitHub Pages

```sh
git add -A
git commit -m "Update site"
git push
```

Confirm in the `sdono043/travel` repo settings that **Pages** is enabled and serving from the branch/folder you pushed to (Settings → Pages). The site is live at `https://sdono043.github.io/travel/`.

## Verify it works

1. Visit the site, click **Sign up**, use an email you added to `familyMembers` — confirm signup succeeds for an allowlisted email and fails for one that isn't.
2. Add a trip, add a manual booking, confirm it shows up.
3. As the owner account, click **Sync from Gmail/Calendar** on a trip — you'll be prompted to grant Gmail/Calendar read access, then it scans recent mail/events and proposes bookings. A real flight/hotel confirmation should auto-promote the trip from "idea" to "booked".
4. Use **Get recommendations** on a trip and confirm a researched, price-range answer comes back.
5. Open a day in the itinerary and click **Plan this day** — confirm AI suggestions appear and "Add" inserts them into that day.
6. If something fails, check Vercel's function logs (Vercel dashboard → project → Deployments → the deployment → Functions tab, or `vercel logs <deployment-url>`).
