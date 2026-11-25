import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

function localMentorApiPlugin(envApiKey?: string): Plugin {
  return {
    name: 'local-gemini-mentor-proxy',
    configureServer(server) {
      server.middlewares.use('/api/mentor', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += chunk;
        });

        req.on('end', async () => {
          try {
            const body = JSON.parse(rawBody || '{}');
            const apiKey = body.apiKey || envApiKey || process.env.GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 501;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: 'NO_SERVER_KEY',
                  message:
                    'No server GEMINI_API_KEY configured. Paste your free Google AI Studio / Pro key in Settings (BYOK) or add GEMINI_API_KEY to .env.',
                })
              );
              return;
            }

            const { GoogleGenAI } = await import('@google/genai');
            const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });

            const interaction = await ai.interactions.create({
              model: body.model || 'gemini-4-hydrogen',
              system_instruction: body.systemInstruction,
              input: body.input,
              response_format: body.responseFormat,
              store: false,
            });

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ outputText: interaction.output_text ?? '{}' }));
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'GEMINI_ERROR', message: msg }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      localMentorApiPlugin(env.GEMINI_API_KEY),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Notepad-AI — Stylus Notebook & Thinking Mentor',
          short_name: 'Notepad-AI',
          description:
            'Everyday S Pen & stylus notebook with clean Ghost Ink mistake detection and Socratic math/logic mentoring.',
          theme_color: '#0b0d13',
          background_color: '#0b0d13',
          display: 'standalone',
          orientation: 'any',
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
      }),
    ],
    optimizeDeps: {
      include: ['perfect-freehand', 'katex', 'dexie', 'dexie-react-hooks'],
    },
  };
});
