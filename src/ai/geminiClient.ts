import { GoogleGenAI } from '@google/genai';
import type {
  AppSettings,
  MistakePattern,
  PracticeMeta,
  SubjectDomain,
} from '../db/schema';
import type { ClusteredSnapshot } from '../engine/strokeClustering';

export interface DetectedStepMistake {
  stepId: string;
  subject: SubjectDomain;
  categorySlug: string;
  categoryTitle: string;
  wrongExpression: string;
  ghostLatex: string;
  socraticHint: string;
  shortExplanation: string;
}

export interface MentorAnalysisResult {
  transcribedSteps: { stepId: string; latex: string }[];
  hasMistake: boolean;
  mistakes: DetectedStepMistake[];
  usedOfflineDemoFallback?: boolean;
}

const MENTOR_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    transcribedSteps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stepId: { type: 'string', description: 'Badge ID such as S1, S2, S3.' },
          latex: { type: 'string', description: 'Transcribed LaTeX or text of this step.' },
        },
        required: ['stepId', 'latex'],
      },
    },
    hasMistake: {
      type: 'boolean',
      description: 'True only if there is a genuine mathematical, physical, or logical mistake.',
    },
    mistakes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stepId: {
            type: 'string',
            description: 'The exact badge ID (e.g. S2) where the mistake first appears.',
          },
          subject: {
            type: 'string',
            enum: ['math', 'physics', 'logic'],
          },
          categorySlug: {
            type: 'string',
            description: 'Short kebab-case tag such as distributive-sign-error or chain-rule.',
          },
          categoryTitle: {
            type: 'string',
            description: 'Short human-readable skill name (2-4 words).',
          },
          wrongExpression: {
            type: 'string',
            description: 'LaTeX of what the user actually wrote in this flawed step.',
          },
          ghostLatex: {
            type: 'string',
            description:
              'Clean corrected LaTeX for ONLY this step (do NOT jump ahead to the final answer of the whole problem!).',
          },
          socraticHint: {
            type: 'string',
            description:
              'One crisp critical-thinking question (max 18 words) nudging the user to spot the error themselves without spoiling.',
          },
          shortExplanation: {
            type: 'string',
            description:
              'Ultra-clean 1-line explanation (max 16 words) of why the Ghost Ink correction fixes that step.',
          },
        },
        required: [
          'stepId',
          'subject',
          'categorySlug',
          'categoryTitle',
          'wrongExpression',
          'ghostLatex',
          'socraticHint',
          'shortExplanation',
        ],
      },
    },
  },
  required: ['transcribedSteps', 'hasMistake', 'mistakes'],
};

const PRACTICE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    promptLatexOrText: {
      type: 'string',
      description: 'A single concise LaTeX problem targeting the blind spot (e.g. "\\\\text{Solve } 3(2x - 5) = 9").',
    },
    hint: {
      type: 'string',
      description: 'Short 1-line reminder of the blind spot to watch out for.',
    },
    answerLatex: {
      type: 'string',
      description: 'Final simplified answer in LaTeX so the user can self-check when finished.',
    },
  },
  required: ['promptLatexOrText', 'hint', 'answerLatex'],
};

async function invokeGeminiInteraction(params: {
  settings: AppSettings;
  systemInstruction: string;
  input: unknown;
  schema: Record<string, unknown>;
}): Promise<string> {
  const responseFormat = {
    type: 'text' as const,
    mime_type: 'application/json' as const,
    schema: params.schema,
  };

  const trimmedKey = params.settings.geminiApiKey.trim();

  // 1. Direct BYOK call when user has saved their own Google AI Studio key locally
  if (trimmedKey) {
    const ai = new GoogleGenAI({ apiKey: trimmedKey, apiVersion: 'v1beta' });
    const interaction = await ai.interactions.create({
      model: params.settings.preferredModel || 'gemini-4-hydrogen',
      system_instruction: params.systemInstruction,
      input: params.input as any,
      response_format: responseFormat as any,
      store: false,
    });
    return interaction.output_text ?? '{}';
  }

  // 2. Otherwise call the /api/mentor serverless proxy (Vite dev middleware or Cloudflare Pages Function)
  const resp = await fetch('/api/mentor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.settings.preferredModel || 'gemini-4-hydrogen',
      systemInstruction: params.systemInstruction,
      input: params.input,
      responseFormat,
    }),
  });

  if (!resp.ok) {
    const errPayload = await resp.json().catch(() => ({}));
    const code = errPayload?.error || `HTTP_${resp.status}`;
    throw new Error(code === 'NO_SERVER_KEY' ? 'NO_API_KEY' : errPayload?.message || code);
  }

  const data = (await resp.json()) as { outputText?: string };
  return data.outputText ?? '{}';
}

export async function analyzeHandwrittenSteps(
  snapshot: ClusteredSnapshot,
  settings: AppSettings,
  pastBlindSpots: MistakePattern[]
): Promise<MentorAnalysisResult> {
  const blindSpotSummary =
    pastBlindSpots.length > 0
      ? `User's recurring blind spots: ${pastBlindSpots
          .slice(0, 5)
          .map((p) => `${p.title} (${p.categorySlug}, ${p.occurrences}x)`)
          .join('; ')}. Reuse matching categorySlug if the same mistake recurs.`
      : 'No prior blind spots logged yet.';

  const systemInstruction = `You are Notepad-AI's Socratic Math, Physics & Logic Mentor.
Examine the cropped image of the user's handwritten work. Each horizontal line/step has a blue badge on the left ([S1], [S2], ...).
Rules:
1. Transcribe every badged step accurately into LaTeX.
2. Check whether each step follows validly from the step above (and any problem prompt).
3. ONLY flag genuine mistakes. Never flag unfinished work in progress if it is valid so far, and never solve the entire remaining problem!
4. For ghostLatex, provide ONLY the corrected version of that specific flawed step so it can be rendered cleanly beside the user's step.
5. Keep socraticHint (critical-thinking question) and shortExplanation under 18 words each.
${blindSpotSummary}`;

  const promptText = [
    `Labeled step IDs in image: ${snapshot.clusters.map((c) => c.stepId).join(', ')}.`,
    snapshot.nearbyTextContext ? `Nearby note context:\n${snapshot.nearbyTextContext}` : '',
    'Inspect the steps and return JSON matching the schema.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const rawJson = await invokeGeminiInteraction({
      settings,
      systemInstruction,
      input: [
        { type: 'text', text: promptText },
        {
          type: 'image',
          data: snapshot.base64Png,
          mime_type: 'image/png',
        },
      ],
      schema: MENTOR_RESPONSE_SCHEMA,
    });

    const parsed = JSON.parse(rawJson) as MentorAnalysisResult;
    return {
      transcribedSteps: Array.isArray(parsed.transcribedSteps) ? parsed.transcribedSteps : [],
      hasMistake: Boolean(parsed.hasMistake),
      mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes : [],
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'NO_API_KEY' && snapshot.clusters.length >= 2) {
      // Built-in interactive sandbox preview when testing the starter equation before adding an API key
      const secondStep = snapshot.clusters[1];
      return {
        transcribedSteps: [
          { stepId: snapshot.clusters[0].stepId, latex: '2(x - 3) = 10' },
          { stepId: secondStep.stepId, latex: '2x - 3 = 10' },
        ],
        hasMistake: true,
        usedOfflineDemoFallback: true,
        mistakes: [
          {
            stepId: secondStep.stepId,
            subject: 'math',
            categorySlug: 'distributive-property',
            categoryTitle: 'Distributive Multiplication',
            wrongExpression: '2x - 3 = 10',
            ghostLatex: '2x - 6 = 10',
            socraticHint: 'When multiplying (x - 3) by 2, did both terms inside the brackets get multiplied?',
            shortExplanation: 'Multiply both x and -3 by 2 -> 2x - 6 = 10 (Add Gemini API key in Settings for live vision!).',
          },
        ],
      };
    }
    throw err;
  }
}

export async function generateSimilarPracticeProblem(
  pattern: MistakePattern,
  settings: AppSettings
): Promise<PracticeMeta> {
  const latestExample = pattern.examples[0];
  const systemInstruction = `Create ONE fresh, concise ${pattern.subject} practice problem targeting the user's specific blind spot: "${pattern.title}" (${pattern.categorySlug}). Keep numbers clean and solvable by hand in 3-4 lines.`;

  try {
    const rawJson = await invokeGeminiInteraction({
      settings,
      systemInstruction,
      input: `Blind spot: ${pattern.title}. Past mistake example: wrote "${latestExample?.wrongExpr ?? ''}" instead of "${latestExample?.rightLatex ?? ''}". Generate 1 similar practice problem.`,
      schema: PRACTICE_RESPONSE_SCHEMA,
    });
    const parsed = JSON.parse(rawJson);
    return {
      categorySlug: pattern.categorySlug,
      categoryTitle: pattern.title,
      promptLatexOrText: parsed.promptLatexOrText || '\\text{Solve } 3(x - 4) = 15',
      hint: parsed.hint || `Watch out for: ${pattern.title}`,
      answerLatex: parsed.answerLatex || 'x = 9',
    };
  } catch {
    // Clean offline fallback practice generator so 1-tap practice always works at $0
    return {
      categorySlug: pattern.categorySlug,
      categoryTitle: pattern.title,
      promptLatexOrText: '\\text{Solve for } x:\\quad 3(2x - 4) - (x - 5) = 13',
      hint: `Carefully apply ${pattern.title.toLowerCase()} on every bracketed term.`,
      answerLatex: '5x - 7 = 13 \\implies x = 4',
    };
  }
}
