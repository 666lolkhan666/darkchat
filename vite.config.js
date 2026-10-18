import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rolldownOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        owner: resolve(process.cwd(), "owner.html")
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "firebase-auth",
              test: /node_modules\/@firebase\/auth\//,
              priority: 10
            },
            {
              name: "firebase-firestore",
              test: /node_modules\/@firebase\/firestore\//,
              priority: 10
            }
          ]
        }
      }
    }
  }
});
