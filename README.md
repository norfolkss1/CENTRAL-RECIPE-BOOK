# CENTRAL RECIPE BOOK — Kitchen Edition

A deployable, mobile-friendly recipe management app for kitchen staff: categorized
recipes with search, a request → admin-approval modification workflow, version
history, favorites, print, and an admin dashboard (pending requests, recipe/category
management, archive, access codes).

It's plain HTML/CSS/JS (no build step) + Firebase Firestore for live, shared data —
the same pattern as your ordering board, so you host it the same way.

---

## Step-by-step: get it running

### Step 1 — Create the Firestore database (do this first — it's the #1 reason recipes don't show up)

Firebase projects don't have a database until you explicitly create one, even if
`firebase-config.js` is already filled in.

1. Go to the [Firebase console](https://console.firebase.google.com) → open project
   **recipe-book-central**.
2. In the left menu: **Build → Firestore Database**.
3. Click **Create database**.
4. Choose **Start in test mode** (easiest — open read/write for 30 days; see Step 2
   to make it permanent). Pick any location close to you, click **Enable**.

If this project already has Firestore enabled (e.g. it's shared with your ordering
board), skip to Step 2.

### Step 2 — Set Firestore rules

Test mode rules expire after 30 days. Go to **Firestore Database → Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Click **Publish**. This matches the trust level of your ordering board's PIN gate —
it's UI-level access control, not real per-user security. If you'd like this locked
down harder later, ask and I'll write stricter rules plus the matching app changes.

### Step 3 — Open the app

- **Easiest test**: double-click `index.html` to open it in your browser. It should
  connect to Firestore and, on first load, automatically create the categories and
  all 27 recipes.
- **For real use**: don't rely on double-clicking the file long-term — deploy the
  folder to GitHub Pages, Firebase Hosting, or any static host, same as your
  ordering board, so every kitchen device hits the same URL.

### Step 4 — First-login setup

1. Unlock with the default codes: **User: 4671 / Admin: 2580**.
2. As admin, go to **Admin dashboard → Settings** and set your own codes.
3. Browse a recipe or two to confirm the drafts flagged for kitchen review look right.

---

## If recipes still don't show up

A banner will appear at the top of the page explaining the problem. The two most
common causes:

| Symptom | Cause | Fix |
|---|---|---|
| Red banner: "Couldn't reach the recipe database" | Firestore Database not created yet | Do Step 1 above |
| Red banner mentions "permission" or "insufficient" | Firestore rules are blocking access | Do Step 2 above |
| No banner, but the page is just blank/white | `firebase-config.js` wasn't loaded (check browser console, F12) | Make sure you kept the folder structure intact — `index.html` must sit next to `app.js`, `style.css`, `firebase-config.js`, and the `data/` and `images/` folders |

You can also open your browser's developer console (F12 → Console tab) — any
Firestore error will be printed there with more detail than the on-page banner.

---

## What's in this folder

```
index.html              the app shell
style.css                all styling (light theme, mobile + print styles)
app.js                   all app logic (Firestore reads/writes, rendering, workflow)
firebase-config.js        your Firebase project config (already filled in)
data/seed-data.js        starting recipe content (only used the very first time)
images/                  dish photos extracted from the PPTX
```

## How the content was sourced

- **Source of truth**: `recipe_book_CENTRAL_2.pptx`, the kitchen prep book. Every
  ingredient and method line transcribed from it is marked "From source" in the app.
- **Draft content**: 13 dishes had incomplete slides (ingredients/method missing).
  At your request, those were filled in based on the dish photo and the à la carte
  menu description — flagged **Draft** throughout the app until a chef reviews and
  confirms them via "Edit directly" (admin) or an approved change request.
- **Allergens**: blank on every slide in the PPTX. Where a matching dish exists on
  the à la carte PDF, its allergen tags were copied in and labeled "unverified —
  from guest menu" — a starting point, not a confirmed list.
- **No photo available in source**: Cachopo and Mashed Potato — flagged in the
  recipe's chef notes; add a photo any time via admin edit.
- **Prep/cook times, chef notes, plating notes**: left blank everywhere (not in the
  source at all) for the kitchen to fill in.

## How the approval workflow works

1. Any user opens a recipe → "Request a change" → picks a field, writes the new
   value and a reason → submitted to Firestore as a pending request.
2. Admin dashboard → Pending requests → old vs. new side by side → **Approve**,
   **Reject**, or **Ask for clarification** (visible to the requester under
   "My requests").
3. On approval, the recipe updates, its version number increments, and a full
   snapshot of the *previous* version is stored — visible any time via "Version
   history," showing who requested it, who approved it, and when.
4. Admins also have an "Edit directly" option that skips the queue (they're the
   approval authority already) — still logged the same way in version history.

## Other features

- **Search** — matches dish name (EN/AR), ingredients, and method text.
- **Favorites** — starred per device (stored locally in the browser, not shared).
- **Print** — clean, photo-free print layout of the open recipe.
- **Archive** — soft-delete; archived recipes are hidden from the main list but
  restorable from Admin → Recipes.
- **Add recipes/categories** — Admin dashboard → Recipes / Categories.
