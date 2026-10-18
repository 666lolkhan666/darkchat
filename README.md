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
File attachments use Cloudflare R2 rather than Firebase Storage. They are enabled automatically after `fileApiUrl` is set in `src/firebase/config.js`; uploads are limited to 50 MB per file and require a signed-in Firebase user.

The visible owner-name prompt (`MBI DARK`) is a UX step, not an authorization boundary. Access is authenticated by Firebase Authentication, and Firestore rules plus the Cloudflare Worker restrict message and file access. Set any development password directly in Firebase Authentication; credentials must not be placed in this repository or frontend source.

The Firestore rules are a starter template. Review and publish them for your deployment, configure Firebase App Check and appropriate abuse controls before production use, and never deploy permissive test-mode rules.

## Cloudflare R2 file uploads

The Worker stores files in a private R2 bucket and verifies each Firebase ID token through Firebase Authentication before upload, download, or deletion. Visitors can access only their own conversation files; the configured owner can access files in every conversation. Do not put R2 credentials or Firebase service-account keys in the frontend.

1. In the Cloudflare dashboard, open **R2 Object Storage** and complete its setup. R2 currently includes a monthly free allowance (10 GB-month storage, 1 million Class A and 10 million Class B operations); usage beyond the allowance can be billed. See [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/).
2. Install and authenticate Wrangler from the repository root, then create the bucket (skip the create command if it already exists):
   ```sh
   npx wrangler login
   npx wrangler r2 bucket create darkchat-files
   ```
3. Edit `wrangler.toml`: replace `FIREBASE_API_KEY` with the web API key from `src/firebase/config.js`, keep `OWNER_UID` equal to the configured Firebase owner UID, and ensure `ALLOWED_ORIGINS` contains the exact site origin `https://mbidark.github.io`. The Firebase web API key is public, not a service-account secret.
4. Create a Cloudflare Pages project and deploy the built app with its file API:
   ```sh
   npm run build
   npx wrangler pages project create darkchat-files --production-branch main
   npx wrangler pages deploy dist --project-name darkchat-files
   ```
   The project-create command is only needed once. Cloudflare Pages Functions publishes the API at `https://darkchat-files.pages.dev`; no `workers.dev` URL or custom domain is needed. Pages Functions have a 100,000 request/day free-plan limit shared with Workers; see [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). If you choose another Pages project name, add its `https://<project-name>.pages.dev` origin to `ALLOWED_ORIGINS` in `wrangler.toml` before deploying.
5. Set the Pages API origin as `fileApiUrl` in `src/firebase/config.js`:
   ```js
   export const fileApiUrl = "https://darkchat-files.pages.dev";
   ```
   `attachmentsEnabled` becomes true automatically when this URL is set. For local development, the Worker also permits the Vite origin `http://localhost:5173`.
6. Publish `firestore.rules` in Firebase (Firebase Console → Firestore Database → Rules). It enforces the same 50 MB attachment limit.
7. Rebuild and push the app; the GitHub Pages workflow deploys it. Uploads are unavailable until the Pages Functions deployment is active and `fileApiUrl` is configured.

## Build and GitHub Pages

```sh
npm run build
```

The included GitHub Actions workflow runs `npm ci` and `npm run build`, then deploys the generated `dist/` directory on pushes to `main`. In GitHub repository settings, enable Pages with **GitHub Actions** as the build and deployment source. This app uses `owner.html` as its static-compatible owner route, so GitHub Pages does not need SPA rewrite configuration. The relative asset base in `vite.config.js` supports both root and repository-subpath hosting.
