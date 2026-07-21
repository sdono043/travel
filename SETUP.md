# Setup

One-time steps to get the site running. Frontend is plain HTML/JS on GitHub Pages; Firebase provides auth, the database, and the two Cloud Functions.

## 1. Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project**. You can reuse an existing Google Cloud project or create a new one.
2. **Build → Authentication → Sign-in method**: enable **Email/Password** and **Google**.
3. **Build → Firestore Database**: create a database (production mode).
4. **Build → Functions**: requires the **Blaze** (pay-as-you-go) plan, since functions call external APIs (Anthropic, Gmail, Calendar).
5. **Project settings → General → Your apps → Add app → Web**. Copy the resulting `firebaseConfig` object into `js/firebase-config.js`.
6. Note your **Project ID** and put it in `.firebaserc` (replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID`).

## 2. Google Cloud OAuth (Gmail + Calendar)

Firebase projects are backed by a Google Cloud project of the same ID — use the [Google Cloud console](https://console.cloud.google.com/) for this part.

1. **APIs & Services → Library**: enable the **Gmail API** and **Google Calendar API**.
2. **APIs & Services → OAuth consent screen**: set up as **Internal** if you're on Google Workspace, or **External** + **Testing** mode otherwise (Testing mode is fine for a family-only site — just add each family Google account under "Test users").
3. Add these scopes to the consent screen: `.../auth/gmail.readonly`, `.../auth/calendar.readonly` (in addition to the default `email`/`profile`/`openid`).
4. The web OAuth client Firebase Auth already created for you (under **APIs & Services → Credentials**) is what's used — no separate client needed, since `signInWithPopup` + `GoogleAuthProvider.addScope` in `js/auth.js` requests these scopes at sign-in time.

## 3. Anthropic API key

Get an API key from the [Anthropic Console](https://console.anthropic.com/), then store it as a Firebase Functions secret (run from the `functions/` directory or repo root — the CLI will prompt):

```sh
firebase functions:secrets:set ANTHROPIC_API_KEY
```

## 4. Family allowlist

The allowlist is a Firestore collection, not something the site can self-serve (see `firestore.rules` — `familyMembers` denies all client access). Add each family member manually in the Firebase console under **Firestore Database → Start collection → `familyMembers`**, with:

- Document ID: the member's email address, **lowercase**
- Any single field (e.g. `addedAt: <timestamp>`) — the document just needs to exist

Only emails present here can create an account on `index.html`.

## 5. Install the CLI and deploy

```sh
npm install -g firebase-tools   # if not already installed
firebase login
cd /Users/samdonovan/travel
firebase deploy --only firestore:rules,firestore:indexes,functions
```

This deploys the Firestore security rules and the two Cloud Functions (`syncGmailBookings`, `getTripRecommendations`). There is no `firebase deploy --only hosting` step — GitHub Pages serves the frontend, not Firebase Hosting.

## 6. Push the frontend to GitHub Pages

```sh
git add -A
git commit -m "Add family travel site"
git push
```

Confirm in the `sdono043/travel` repo settings that **Pages** is enabled and serving from the branch/folder you pushed to (Settings → Pages). The site will be live at `https://sdono043.github.io/travel/`.

## Verify it works

1. Visit the site, click **Sign up**, use an email you added to `familyMembers` — confirm signup succeeds for an allowlisted email and fails for one that isn't.
2. Add a trip, add a manual booking, confirm it shows up.
3. As the owner account, click **Sync from Gmail/Calendar** on a trip — you'll be prompted to grant Gmail/Calendar read access, then it scans recent mail/events and proposes bookings.
4. Use **Get recommendations** on a trip and confirm a researched, price-range answer comes back.
5. If something fails, check `firebase functions:log` for errors from the two Cloud Functions.
