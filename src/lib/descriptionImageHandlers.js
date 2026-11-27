import { getDb } from '@/lib/db';
import { getSessionUserId, isAdmin } from '@/lib/access';
import { canViewVideo } from '@/lib/videoVisibility';
import { getGraphToken, getUserDriveId, ensureFolderExists } from '@/lib/onedriveServer';
import { rateLimitResponse } from '@/lib/rateLimit';
import { createDescriptionImageHandlers } from './descriptionImageService.mjs';

export const descriptionImageHandlers = createDescriptionImageHandlers({ getDb, getSessionUserId, isAdmin, canViewVideo, getGraphToken, getUserDriveId, ensureFolderExists, rateLimitResponse });
