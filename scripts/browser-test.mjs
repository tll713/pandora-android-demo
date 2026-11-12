import { createRequire } from 'node:module';

// Resolve the repository's pinned Playwright dependency, with an explicit runtime override.
const require = createRequire(new URL('../pandora-app/package.json', import.meta.url));
export const { chromium } = process.env.PANDORA_RUNTIME_MODULES
  ? require(`${process.env.PANDORA_RUNTIME_MODULES}/playwright`)
  : require('playwright');
export const browserChannel = process.env.PANDORA_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
