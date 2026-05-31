#!/usr/bin/env node
// Diagnostic script: signs in as the bootstrap admin via the Firebase
// Auth REST API, then tries to create a /teams doc via the Firestore
// REST API. Reveals exactly which step is rejected.
//
// Usage:
//   FIREBASE_PASSWORD='your-admin-password' node scripts/test-teams.mjs

const apiKey = "AIzaSyBAr7RIGiQ5Zcp_BYzEed5Mn-895qGtRGI";
const projectId = "flexweg-e1d40";
const email = "contact@flexweg.com";
const password = process.env.FIREBASE_PASSWORD;

if (!password) {
  console.error("Set FIREBASE_PASSWORD env var. Example:");
  console.error("  FIREBASE_PASSWORD='...' node scripts/test-teams.mjs");
  process.exit(1);
}

function fmt(obj) {
  return JSON.stringify(obj, null, 2);
}

// Step 1 — sign in via Identity Toolkit REST.
console.log("→ Signing in as", email);
const signInRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
);
const signInData = await signInRes.json();
if (!signInRes.ok) {
  console.error("✗ Sign-in failed:", signInRes.status, fmt(signInData));
  process.exit(1);
}
console.log("✓ Signed in.");

const idToken = signInData.idToken;
const uid = signInData.localId;

// Step 2 — decode the JWT to verify the email claim that
// `request.auth.token.email` will see server-side.
const payload = JSON.parse(
  Buffer.from(idToken.split(".")[1], "base64url").toString(),
);
console.log("Token claims:");
console.log(
  fmt({
    uid: payload.user_id,
    email: payload.email,
    email_verified: payload.email_verified,
    firebase: payload.firebase,
    iss: payload.iss,
    aud: payload.aud,
  }),
);

if (!payload.email) {
  console.error(
    "✗ Token has NO email claim. Sign-in provider may be missing email — rules using request.auth.token.email will fail.",
  );
  process.exit(1);
}
if (payload.email.toLowerCase() !== email.toLowerCase()) {
  console.error(
    `✗ Token email "${payload.email}" does not match expected "${email}" — isBootstrapAdmin() rule will fail.`,
  );
  process.exit(1);
}
console.log("✓ Token email matches the bootstrap admin email.");

// Step 3a — read /config/migrations (should succeed under our rules).
const migUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/migrations`;
const migRes = await fetch(migUrl, {
  headers: { Authorization: `Bearer ${idToken}` },
});
console.log("→ GET /config/migrations:", migRes.status);
if (migRes.status === 404) {
  console.log("  (no migration doc yet — expected on first run)");
} else if (!migRes.ok) {
  console.error("✗ Read failed:", await migRes.text());
}

// Step 3b — read our own user doc so we know whether the 2nd branch
// of isAdmin() (doc-based) is viable when isBootstrapAdmin() fails.
const meUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
const meRes = await fetch(meUrl, {
  headers: { Authorization: `Bearer ${idToken}` },
});
console.log("→ GET /users/" + uid + ":", meRes.status);
if (meRes.ok) {
  const meDoc = await meRes.json();
  const fields = meDoc.fields ?? {};
  console.log("  Your user doc:", fmt({
    role: fields.role?.stringValue,
    disabled: fields.disabled?.booleanValue,
    teamIds: fields.teamIds?.arrayValue?.values?.map((v) => v.stringValue),
    email: fields.email?.stringValue,
  }));
  if (fields.role?.stringValue !== "admin") {
    console.log(
      "  ⚠ role is not 'admin' — isAdmin()'s 2nd branch will fail. You're relying entirely on isBootstrapAdmin().",
    );
  }
} else if (meRes.status === 404) {
  console.log("  ⚠ No /users/" + uid + " doc — isAdmin()'s 2nd branch impossible. Rely on isBootstrapAdmin().");
} else {
  console.error("  ✗ Cannot read own user doc:", await meRes.text());
}

// Step 4 — try to create /teams/<id>.
const testId = `team_diag_${Date.now()}`;
const createUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/teams?documentId=${testId}`;
console.log("→ POST /teams/" + testId);
const createRes = await fetch(createUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${idToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    fields: {
      name: { stringValue: "Diagnostic" },
      color: { stringValue: "blue" },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  }),
});

if (!createRes.ok) {
  const txt = await createRes.text();
  console.error("✗ Create team REJECTED:", createRes.status);
  console.error(txt);
  process.exit(1);
}
console.log("✓ Team created successfully via REST.");

// Step 5 — clean up.
const deleteUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/teams/${testId}`;
const delRes = await fetch(deleteUrl, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${idToken}` },
});
console.log("→ Cleanup DELETE:", delRes.status);

console.log("");
console.log(
  "✓ All checks passed. If the in-app modal still fails, it's a stale build (do `npm run build` then redeploy dist/, then hard-refresh the browser).",
);
console.log("  UID:", uid);
