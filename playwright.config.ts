import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:"./tests/browser",
  timeout:45_000,
  retries:1,
  workers:1,
  reporter:"list",
  use:{baseURL:"http://127.0.0.1:3000",...devices["Desktop Chrome"],trace:"retain-on-failure"},
  outputDir:"test-results"
});
