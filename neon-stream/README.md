# Neon Stream — Setup & Deployment (GitHub Codespaces → Vercel)

## What's here
```
index.html         Frontend: neon UI, Firebase auth, Firestore subscription
                    check, video.js player + Hilltop VAST/VPAID ads,
                    download button. Also loads any videos uploaded via
                    upload.html (stored in Firestore + Vercel Blob).
upload.html         Admin page: uploads a video file directly to Vercel
                    Blob storage and records it in Firestore.
api/checkout.js     Creates a Stripe Checkout subscription session.
api/webhook.js      Stripe webhook -> updates Firestore subscription status.
api/upload.js       Issues Vercel Blob upload tokens and saves uploaded
                    video metadata (title, url) to Firestore.
package.json        Backend dependencies (firebase-admin, stripe, @vercel/blob).
.env.example        Every env var you need to fill in.
```

## 1. Fill in real config
1. **Firebase**: create a project at console.firebase.google.com, enable
   Authentication → Email/Password, and Firestore (in production or test
   mode). Copy the web config into `firebaseConfig` at the top of
   `index.html`'s `<script>` block.
2. **Firebase Admin key**: Project settings → Service accounts → Generate
   new private key. Use its `project_id`, `client_email`, `private_key`
   for the `FIREBASE_*` env vars.
3. **Stripe**: create a $5/month recurring Price in the Stripe Dashboard,
   copy its Price ID into `STRIPE_PRICE_ID`. Copy your secret key into
   `STRIPE_SECRET_KEY`.
4. **Hilltop Ads**: get your VAST tag URL from your Hilltop Ads publisher
   dashboard and paste it into `HILLTOP_VAST_TAG_URL` in `index.html`.
5. **Video API**: point `VIDEO_API_URL` in `index.html` at your real
   third-party video listing endpoint. It should return JSON like:
   `[{ "id": 1, "title": "...", "url": "https://.../video.mp4" }, ...]`

## 2. Run locally in Codespaces
```bash
npm install -g vercel
npm install
cp .env.example .env.local   # then fill in real values
vercel dev
```
`vercel dev` serves `index.html` statically and runs the `/api/*`
functions locally (reading `.env.local` automatically). Codespaces will
prompt you to forward the port — open it in the browser preview.

## 3. Connect Stripe webhooks locally (optional but recommended)
```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhook
```
Copy the `whsec_...` value it prints into `STRIPE_WEBHOOK_SECRET`.

## 4. Deploy to Vercel
```bash
vercel login
vercel link          # creates/links the Vercel project
vercel env add STRIPE_SECRET_KEY
vercel env add STRIPE_PRICE_ID
vercel env add STRIPE_WEBHOOK_SECRET
vercel env add FIREBASE_PROJECT_ID
vercel env add FIREBASE_CLIENT_EMAIL
vercel env add FIREBASE_PRIVATE_KEY
vercel env add APP_URL               # e.g. https://neon-stream.vercel.app
vercel --prod
```

## 5. Register the production webhook
In the Stripe Dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://your-app.vercel.app/api/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`

Copy the signing secret it gives you into `STRIPE_WEBHOOK_SECRET` on
Vercel (`vercel env add STRIPE_WEBHOOK_SECRET` again, or edit it in the
dashboard), then redeploy so the function picks it up.

## 6. Set up Cloudflare R2 for video uploads (10GB free, no egress fees)
1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
2. Left sidebar → **R2 Object Storage** → **Create bucket**. Name it
   e.g. `neon-stream-videos`. Note your **Account ID** (shown on the R2
   overview page).
3. Open the bucket → **Settings** → **Public access** → enable it, or
   connect a custom domain. Copy the public URL it gives you
   (looks like `https://pub-xxxxxxxx.r2.dev`) → this is `R2_PUBLIC_URL`.
4. Go to **R2 → Manage R2 API Tokens** → **Create API Token** → give it
   **Object Read & Write** permission, scoped to your bucket. Copy the
   **Access Key ID** and **Secret Access Key** it shows you (shown once).
5. Add these to Vercel env vars: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.
6. Visit `https://your-app.vercel.app/upload.html`, pick a video file,
   and upload. It goes straight to R2; a record (title, url) is saved
   to Firestore's `videos` collection; `index.html` picks it up
   automatically alongside the third-party API videos.

**Security warning:** `upload.html` as shipped has no login check —
anyone with the URL can upload. Before going live, add real
authentication in `api/upload.js` (verify a Firebase ID token the same
way `api/checkout.js` does) so only you (the admin) can upload.

## Notes on the design
- **Access control lives server-side.** The download button checks
  Firestore client-side for a fast UI response, but the *only* thing
  that ever writes `subscriptionActive: true` is the Stripe webhook —
  never the browser. Don't add client-side writes to that field.
- **Ads**: `videojs-vast-vpaid` is a generic VAST/VPAID player plugin —
  it works with any VAST-compliant network's tag URL, Hilltop included.
  If Hilltop gives you a JS snippet instead of a VAST tag URL, let me
  know and I'll adjust the integration to match their SDK instead.
- **Video storage**: videos can come from either the third-party API
  (`VIDEO_API_URL`) or direct uploads via `upload.html` → Cloudflare R2.
  Nothing touches Firebase Storage, so no Blaze plan upgrade is needed.
- **Vercel plan**: since this app charges a subscription, it's a
  commercial project — Vercel's free Hobby plan is for non-commercial
  use only, so you'll need Pro ($20/month) to deploy this legitimately.
