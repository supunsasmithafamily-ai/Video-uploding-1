// api/webhook.js
// Vercel serverless function: listens for Stripe events and keeps
// Firestore's users/{uid}.subscriptionActive in sync. This is what
// actually grants/revokes download access — never trust the client.
//
// Configure this URL (https://your-app.vercel.app/api/webhook) in the
// Stripe Dashboard -> Developers -> Webhooks, listening for:
//   checkout.session.completed
//   customer.subscription.updated
//   customer.subscription.deleted

import Stripe from 'stripe';
import admin from 'firebase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

// Stripe needs the raw request body to verify the webhook signature,
// so we disable Vercel's default JSON body parsing.
export const config = {
  api: { bodyParser: false },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.client_reference_id || session.metadata?.firebaseUID;
        if (uid) {
          await db.collection('users').doc(uid).set(
            {
              subscriptionActive: true,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription,
            },
            { merge: true }
          );
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const active = sub.status === 'active' || sub.status === 'trialing';
        await updateByCustomerId(sub.customer, { subscriptionActive: active });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await updateByCustomerId(sub.customer, { subscriptionActive: false });
        break;
      }

      default:
        // Ignore other event types
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}

async function updateByCustomerId(stripeCustomerId, fields) {
  const snap = await db
    .collection('users')
    .where('stripeCustomerId', '==', stripeCustomerId)
    .limit(1)
    .get();
  if (!snap.empty) {
    await snap.docs[0].ref.set(fields, { merge: true });
  }
}
