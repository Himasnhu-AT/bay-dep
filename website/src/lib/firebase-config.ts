/**
 * The Firebase project, as plain data. It imports nothing, so the route
 * handlers can read the project id without pulling the SDK loader into the
 * server bundle.
 *
 * These values are public by design. What a signed-in browser may read is
 * decided by the Firestore rules (../firebase/firestore.rules), not by keeping
 * the API key secret.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyCv5j0n_KWnizBrE0uD7f2I4HKKez5V4fk",
  authDomain: "bay-editor-app.firebaseapp.com",
  projectId: "bay-editor-app",
  appId: "1:92159805240:web:ec5d5354eabe07d596a3cd",
  messagingSenderId: "92159805240",
  storageBucket: "bay-editor-app.firebasestorage.app",
} as const;

/** The owner. The rules decide who may read the dashboard; this only decides what the page offers. */
export const ADMIN_EMAIL = "hyattherate2005@gmail.com";
