import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        owner: resolve(process.cwd(), "owner.html")
      }
    }
  }
});
