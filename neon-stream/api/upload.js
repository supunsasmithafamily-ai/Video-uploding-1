// api/upload.js
// Two-step direct-to-Cloudflare-R2 video upload:
//   1. Browser calls this with action "get-upload-url" -> gets a
//      presigned PUT URL and asks it to upload the file straight to R2
//      (never passes through this function, so large files are fine).
//   2. After the PUT succeeds, browser calls this again with action
//      "confirm" -> saves { title, url } to Firestore's "videos"
//      collection so index.html can list it.
//
// Requires: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import admin from 'firebase-admin';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

  // ---- Step 1: issue a presigned URL the browser can PUT the file to ----
  if (action === 'get-upload-url') {
    const { filename, contentType } = req.body;
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType are required' });
    }

    const key = `videos/${Date.now()}-${filename.replace(/\s+/g, '-')}`;
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    try {
      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 }); // 10 minutes
      const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
      return res.status(200).json({ uploadUrl, publicUrl, key });
    } catch (err) {
      console.error('R2 presign error:', err);
      return res.status(500).json({ error: 'Could not create upload URL' });
    }
  }

  // ---- Step 2: record the finished upload's metadata in Firestore ----
  if (action === 'confirm') {
    const { title, url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    try {
      await db.collection('videos').add({
        title: title || 'Untitled',
        url,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Firestore save error:', err);
      return res.status(500).json({ error: 'Could not save video record' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
