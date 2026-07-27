import type {
  EditPredictRequest,
  EditPredictResponse,
} from '@pierre/diffs/edit';
import { z } from 'zod';

import { isGithubAuthenticated } from '../_auth/github';

const CACHE_CONTROL = 'no-store';
const CODESTRAL_FIM_URL = 'https://api.mistral.ai/v1/fim/completions';
const MAX_HISTORY_ENTRY_BYTES = 6144;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_UPSTREAM_BYTES = 64 * 1024;
const MISTRAL_TIMEOUT_MS = 15_000;
const textEncoder = new TextEncoder();

const requestSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(1024)
      .refine((path) => !/[\r\n]/.test(path)),
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    eol: z.enum(['\n', '\r\n', '\r']),
    excerptText: z.string().max(MAX_REQUEST_BYTES),
    excerptStartLine: z.number().int().nonnegative().max(10_000_000),
    cursorOffsetInExcerpt: z.number().int().nonnegative(),
    editableRange: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict(),
    editHistory: z
      .array(
        z
          .object({
            diff: z.string().min(1),
            source: z.enum(['user', 'prediction']),
          })
          .strict()
      )
      .max(10),
  })
  .strict();

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  if (
    process.env.NEXT_PUBLIC_SITE !== undefined &&
    process.env.NEXT_PUBLIC_SITE !== 'diffs'
  ) {
    return createErrorResponse('Not found.', 404);
  }

  if (!isGithubAuthenticated(request)) {
    return createErrorResponse('GitHub sign-in required.', 401);
  }

  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  if (apiKey === undefined || apiKey === '') {
    return createErrorResponse('Edit prediction is not configured.', 503);
  }

  if (
    request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() !== 'application/json'
  ) {
    return createErrorResponse('Expected an application/json request.', 415);
  }

  let requestText: string | undefined;
  try {
    requestText = await readTextWithinLimit(request.body, MAX_REQUEST_BYTES);
  } catch {
    return createErrorResponse('Could not read the request body.', 400);
  }
  if (requestText === undefined) {
    return createErrorResponse('Request body is too large.', 413);
  }

  let json: unknown;
  try {
    json = JSON.parse(requestText);
  } catch {
    return createErrorResponse('Request body must be valid JSON.', 400);
  }

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return createErrorResponse('Invalid edit prediction request.', 400);
  }
  const input: EditPredictRequest = parsed.data;
  const { cursorOffsetInExcerpt, editableRange, excerptText } = input;
  if (
    editableRange.start > cursorOffsetInExcerpt ||
    cursorOffsetInExcerpt > editableRange.end ||
    editableRange.end > excerptText.length ||
    splitsTextUnit(excerptText, editableRange.start) ||
    splitsTextUnit(excerptText, cursorOffsetInExcerpt) ||
    splitsTextUnit(excerptText, editableRange.end) ||
    input.editHistory.some(
      ({ diff }) =>
        textEncoder.encode(diff).byteLength > MAX_HISTORY_ENTRY_BYTES
    )
  ) {
    return createErrorResponse('Invalid edit prediction request.', 400);
  }

  const upstreamSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(MISTRAL_TIMEOUT_MS),
  ]);
  let upstream: Response;
  try {
    upstream = await fetch(CODESTRAL_FIM_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'codestral-latest',
        prompt: excerptText.slice(0, cursorOffsetInExcerpt),
        suffix: excerptText.slice(cursorOffsetInExcerpt),
        max_tokens: 128,
        temperature: 0,
        stream: false,
      }),
      signal: upstreamSignal,
    });
  } catch {
    if (request.signal.aborted) {
      return createErrorResponse('Edit prediction was cancelled.', 499);
    }
    return createErrorResponse(
      upstreamSignal.aborted
        ? 'Edit prediction service timed out.'
        : 'Edit prediction service is unavailable.',
      upstreamSignal.aborted ? 504 : 502
    );
  }

  if (!upstream.ok) {
    return createErrorResponse(
      upstream.status === 429
        ? 'Edit prediction rate limit exceeded.'
        : 'Edit prediction service returned an error.',
      upstream.status === 429 ? 429 : 502
    );
  }

  let upstreamText: string | undefined;
  try {
    upstreamText = await readTextWithinLimit(upstream.body, MAX_UPSTREAM_BYTES);
  } catch {
    if (request.signal.aborted) {
      return createErrorResponse('Edit prediction was cancelled.', 499);
    }
    return createErrorResponse(
      upstreamSignal.aborted
        ? 'Edit prediction service timed out.'
        : 'Invalid edit prediction response.',
      upstreamSignal.aborted ? 504 : 502
    );
  }
  if (upstreamText === undefined) {
    return createErrorResponse('Edit prediction response is too large.', 502);
  }

  let upstreamJSON: unknown;
  try {
    upstreamJSON = JSON.parse(upstreamText);
  } catch {
    return createErrorResponse('Invalid edit prediction response.', 502);
  }
  if (
    upstreamJSON === null ||
    typeof upstreamJSON !== 'object' ||
    !Array.isArray((upstreamJSON as { choices?: unknown }).choices) ||
    (upstreamJSON as { choices: unknown[] }).choices.length !== 1
  ) {
    return createErrorResponse('Invalid edit prediction response.', 502);
  }

  const choice = (upstreamJSON as { choices: unknown[] }).choices[0];
  if (
    choice === null ||
    typeof choice !== 'object' ||
    (choice as { finish_reason?: unknown }).finish_reason !== 'stop'
  ) {
    return createErrorResponse(
      (choice as { finish_reason?: unknown } | null)?.finish_reason === 'length'
        ? 'Edit prediction was truncated.'
        : 'Invalid edit prediction response.',
      502
    );
  }

  const message = (choice as { message?: unknown }).message;
  const completion =
    message !== null && typeof message === 'object'
      ? (message as { content?: unknown }).content
      : undefined;
  if (
    typeof completion !== 'string' ||
    textEncoder.encode(completion).byteLength > MAX_OUTPUT_BYTES
  ) {
    return createErrorResponse('Invalid edit prediction response.', 502);
  }

  const newText = completion.replace(/\r\n|\r|\n/g, input.eol);
  if (textEncoder.encode(newText).byteLength > MAX_OUTPUT_BYTES) {
    return createErrorResponse('Edit prediction response is too large.', 502);
  }

  const relativeCursor = positionAt(excerptText, cursorOffsetInExcerpt);
  const cursor = {
    line: input.excerptStartLine + relativeCursor.line,
    character: relativeCursor.character,
  };
  const insertedCursor = positionAt(newText, newText.length);
  const response: EditPredictResponse = {
    edits:
      newText === ''
        ? []
        : [
            {
              range: { start: cursor, end: cursor },
              newText,
            },
          ],
    newCursor:
      insertedCursor.line === 0
        ? {
            line: cursor.line,
            character: cursor.character + insertedCursor.character,
          }
        : {
            line: cursor.line + insertedCursor.line,
            character: insertedCursor.character,
          },
  };
  return Response.json(response, {
    headers: { 'Cache-Control': CACHE_CONTROL },
  });
}

async function readTextWithinLimit(
  body: ReadableStream<Uint8Array> | null,
  limit: number
): Promise<string | undefined> {
  if (body === null) {
    return '';
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function splitsTextUnit(text: string, offset: number): boolean {
  const current = text.charCodeAt(offset);
  const previous = text.charCodeAt(offset - 1);
  return (
    (previous === 13 && current === 10) ||
    (previous >= 0xd800 &&
      previous <= 0xdbff &&
      current >= 0xdc00 &&
      current <= 0xdfff)
  );
}

function positionAt(
  text: string,
  offset: number
): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    const character = text.charCodeAt(index);
    if (character === 13 && text.charCodeAt(index + 1) === 10) {
      index++;
    }
    if (character === 10 || character === 13) {
      line++;
      lineStart = index + 1;
    }
  }
  return { line, character: offset - lineStart };
}

function createErrorResponse(error: string, status: number): Response {
  return Response.json(
    { error },
    {
      status,
      headers: { 'Cache-Control': CACHE_CONTROL },
    }
  );
}
