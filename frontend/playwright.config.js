import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',use:{baseURL:process.env.ZNE_TEST_URL || 'http://127.0.0.1:5173',
  headless:true,launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},
  reporter:'list'});
