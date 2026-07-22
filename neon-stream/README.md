# Neon Stream — Setup & Deployment (GitHub Codespaces → Vercel)

## What's here
```
index.html        Frontend: neon UI, Firebase auth, Firestore subscription
                   check, video.js player + Hilltop VAST/VPAID ads,
                   download button.
api/checkout.js    Creates a Stripe Checkout subscription session.
api/webhook.js     Stripe webhook -> updates Firestore subscription status.
package.json       Backend dependencies (firebase-admin, stripe).
.env.example       Every env var you need to fill in.
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

## Notes on the design
- **Access control lives server-side.** The download button checks
  Firestore client-side for a fast UI response, but the *only* thing
  that ever writes `subscriptionActive: true` is the Stripe webhook —
  never the browser. Don't add client-side writes to that field.
- **Ads**: `videojs-vast-vpaid` is a generic VAST/VPAID player plugin —
  it works with any VAST-compliant network's tag URL, Hilltop included.
  If Hilltop gives you a JS snippet instead of a VAST tag URL, let me
  know and I'll adjust the integration to match their SDK instead.
- **Video storage**: nothing touches Firebase Storage; playback URLs
  come straight from `VIDEO_API_URL` at request time, as requested.
