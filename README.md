# DARK HOST

A minimal, text-only terminal for sending messages to the owner. The public page is `/`. Enter `MBI DARK` at the name prompt to open owner sign-in; `/owner.html` remains available and uses the same flow. Messages are not stored locally or reported as sent when Firebase is unavailable.

The supplied logo is used as the browser tab icon and the share-preview image. The page title and share text are both `Chat with Dark`.

## Run locally

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Firebase web app configuration is in `src/firebase/config.js`; messages can be sent once the Firestore database and rules are enabled. Owner login additionally needs the owner's Firebase Authentication email and UID. A missing Firebase response times out with an explicit unconfirmed-delivery message; it never reports success without a confirmed Firestore write.

## Firebase setup

1. Create a Firebase project and register a web app.
2. Enable **Email/Password** and **Anonymous** sign-in providers in Firebase Authentication. Create the owner account. The password is set in Firebase, never in this repository or frontend source. Anonymous auth gives each visitor a persistent Firebase UID so the page can restore their conversation after refresh.
3. The web app's public configuration is populated in `src/firebase/config.js`. Set `ownerEmail` to the owner account's email and `ownerUid` to its Firebase Authentication UID. Firebase web config is public; do not put private service-account credentials here.
4. Create a Cloud Firestore database. Set the same owner UID in `firestore.rules`, then publish those rules. Authenticated anonymous visitors can create messages and read only their own thread; only the configured owner UID can read every thread and send replies. Both sides receive real-time updates.
File attachments are currently disabled so the project can run without enabling Firebase Storage or adding a billing account. To enable the previously implemented 256 MiB-per-file attachments later, set `attachmentsEnabled` to `true` in `src/firebase/config.js`, enable Firebase Storage, verify its bucket configuration, and publish `storage.rules`.

The visible owner-name prompt (`MBI DARK`) is a UX step, not an authorization boundary. Access is authenticated by Firebase Authentication, and Firestore/Storage rules restrict message and file access. Set any development password directly in Firebase Authentication; credentials must not be placed in this repository or frontend bundle.

The Firestore rules are a starter template. Review and publish them for your deployment, configure Firebase App Check and appropriate abuse controls before production use, and never deploy permissive test-mode rules. If enabling Storage later, review its rules and billing before allowing uploads.

## Build and GitHub Pages

```sh
npm run build
```

The included GitHub Actions workflow builds and deploys `dist/` on pushes to `main`. In GitHub repository settings, enable Pages with **GitHub Actions** as the build and deployment source. This app uses `owner.html` as its static-compatible owner route, so GitHub Pages does not need SPA rewrite configuration. The relative asset base in `vite.config.js` supports both root and repository-subpath hosting.
