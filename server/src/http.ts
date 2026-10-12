import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, 'not_found', 'Not found.');
export const fieldError = (field: string, message: string) =>
  new HttpError(400, 'validation', 'Check the highlighted fields.', { [field]: message });

// Validates untrusted input; the first problem per field becomes fields[name].
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) {
    const key = String(i.path[0] ?? 'body');
    fields[key] ??= i.message;
  }
  throw new HttpError(400, 'validation', 'Check the highlighted fields.', fields);
}

// Checks the header itself: req.is() answers null for body-less requests.
export const requireJson: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) return next();
  next(new HttpError(400, 'validation', 'Send the request as application/json.'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let e = err;
  if (!(e instanceof HttpError)) {
    if (e?.type === 'entity.parse.failed') e = new HttpError(400, 'validation', 'The request body is not valid JSON.');
    else if (e?.type === 'entity.too.large') e = new HttpError(400, 'validation', 'The request body is too large.');
    else {
      console.error(err);
      e = new HttpError(500, 'internal', 'Something went wrong.');
    }
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.fields && { fields: e.fields }) } });
};
