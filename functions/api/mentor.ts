import { GoogleGenAI } from '@google/genai';

export interface Env {
  GEMINI_API_KEY?: string;
}

/**
 * Cloudflare Pages Function: POST /api/mentor
 * Protects your Google AI Pro $10/month credited GEMINI_API_KEY on the edge at $0 hosting cost.
 */
export const onRequestPost = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  try {
    const body = (await context.request.json()) as {
      apiKey?: string;
      model?: string;
      systemInstruction?: string;
      input?: unknown;
      responseFormat?: unknown;
    };

    const apiKey = body.apiKey || context.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'NO_SERVER_KEY',
          message:
            'No server GEMINI_API_KEY configured. Paste your Google AI Studio key in Settings (BYOK) or configure GEMINI_API_KEY in Cloudflare Pages.',
        }),
        {
          status: 501,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
    const interaction = await ai.interactions.create({
      model: (body.model as any) || 'gemini-4-hydrogen',
      system_instruction: body.systemInstruction,
      input: body.input as any,
      response_format: body.responseFormat as any,
      store: false,
    });

    return new Response(
      JSON.stringify({
        outputText: interaction.output_text ?? '{}',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        error: 'GEMINI_ERROR',
        message: msg,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
