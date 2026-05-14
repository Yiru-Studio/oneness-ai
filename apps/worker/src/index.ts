import { logger } from '@oneness/shared/logger';
import { config } from './config.js';

logger.info(
  {
    providers: {
      image: config.PROVIDER_IMAGE,
      video: config.PROVIDER_VIDEO,
      text: config.PROVIDER_TEXT,
    },
    failRate: config.STUB_FAIL_RATE,
  },
  'worker booted (no consumers yet)',
);
