import { randomUUID } from 'node:crypto';

export function apiErrorBody(error, { context = 'API', message = 'เกิดข้อผิดพลาด', body } = {}) {
  const id = randomUUID();
  console.error(`[${context}] ${id}`, error);
  return { success: false, ...body, error: message, id };
}

export function apiError(error, { status = 500, headers, ...options } = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return Response.json(apiErrorBody(error, options), { status, headers: responseHeaders });
}
