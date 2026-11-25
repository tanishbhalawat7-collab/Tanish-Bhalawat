import {
  GoogleGenAI,
  Modality,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
} from '@google/genai';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyCameraHealth } from './cameraService.ts';
import {
  getExpirySummary,
  getNotifications,
  listProducts,
} from './db.ts';

const ALLOWED_VOICES = new Set(['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir']);

const LIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_inventory_summary',
    description:
      'Returns the real-time count of all tracked products, broken down into fresh, expiring soon, expired, and unknown expiry dates, plus category totals.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_expiring_and_expired_products',
    description:
      'Lists products that are already expired or expiring soon, including days remaining, brand, category, and exact expiry date.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        statusFilter: {
          type: Type.STRING,
          description: 'Optional filter: "all_alerts", "expired", or "expiring_soon". Defaults to "all_alerts".',
        },
      },
    },
  },
  {
    name: 'search_inventory_products',
    description:
      'Searches stored products in the Fresh Vibe database by product name, brand, category, or barcode.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search keyword such as product name, brand, category, or barcode digits.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_esp32_camera_status',
    description:
      'Checks whether the ESP32-CAM hardware camera is currently connected and verified via a real JPEG capture.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

async function executeLiveTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{ result: unknown; summary: string }> {
  switch (name) {
    case 'get_inventory_summary': {
      const summary = getExpirySummary();
      return {
        result: {
          total: summary.total,
          fresh: summary.fresh,
          expiringSoon: summary.expiringSoon,
          expired: summary.expired,
          unknown: summary.unknown,
          thresholds: summary.thresholds,
          categories: summary.categories,
        },
        summary: `Checked inventory (${summary.total} items total)`,
      };
    }

    case 'get_expiring_and_expired_products': {
      const filter =
        typeof args?.statusFilter === 'string' ? args.statusFilter : 'all_alerts';
      const all = listProducts();
      const matched = all.filter((p) => {
        if (filter === 'expired') return p.expiryStatus === 'expired';
        if (filter === 'expiring_soon') return p.expiryStatus === 'expiring_soon';
        return p.expiryStatus === 'expired' || p.expiryStatus === 'expiring_soon';
      });
      const notifications = getNotifications().filter((n) => !n.dismissed);
      return {
        result: {
          count: matched.length,
          products: matched.slice(0, 15).map((p) => ({
            name: p.name,
            brand: p.brand,
            category: p.category,
            expiryDate: p.expiryDate,
            daysRemaining: p.daysRemaining,
            expiryStatus: p.expiryStatus,
          })),
          activeAlertsCount: notifications.length,
        },
        summary: `Found ${matched.length} expiring/expired items`,
      };
    }

    case 'search_inventory_products': {
      const q = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
      const all = listProducts();
      const matched = q
        ? all.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              (p.brand || '').toLowerCase().includes(q) ||
              p.category.toLowerCase().includes(q) ||
              (p.barcode || '').toLowerCase().includes(q)
          )
        : all.slice(0, 10);
      return {
        result: {
          query: q,
          count: matched.length,
          products: matched.slice(0, 12).map((p) => ({
            name: p.name,
            brand: p.brand,
            category: p.category,
            expiryDate: p.expiryDate,
            manufacturingDate: p.manufacturingDate,
            daysRemaining: p.daysRemaining,
            expiryStatus: p.expiryStatus,
            batchNumber: p.batchNumber,
          })),
        },
        summary: `Searched inventory for "${q || 'all'}" (${matched.length} matches)`,
      };
    }

    case 'check_esp32_camera_status': {
      const cam = await verifyCameraHealth();
      return {
        result: {
          connected: cam.connected,
          mode: cam.mode,
          deviceOnline: cam.deviceOnline,
          deviceIp: cam.deviceIp,
          rssi: cam.rssi,
          streamActive: cam.streamActive,
          flashEnabled: cam.flashEnabled,
          latencyMs: cam.latencyMs,
          message: cam.message,
          error: cam.error,
        },
        summary: cam.connected
          ? `ESP32-CAM connected via Cloud API (${cam.latencyMs}ms)`
          : 'ESP32-CAM disconnected',
      };
    }

    default:
      return {
        result: { error: `Unknown tool: ${name}` },
        summary: `Unknown tool ${name}`,
      };
  }
}

function sendSafe(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachLiveVoiceWebSocket(wss: WebSocketServer): void {
  wss.on('connection', async (clientWs: WebSocket, req: IncomingMessage) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      sendSafe(clientWs, {
        type: 'error',
        message: 'GEMINI_API_KEY is not configured on the server.',
      });
      clientWs.close(1008, 'API key missing');
      return;
    }

    let voiceName = 'Zephyr';
    try {
      const parsedUrl = new URL(req.url || '/api/live', 'http://localhost');
      const requestedVoice = parsedUrl.searchParams.get('voice') || '';
      if (ALLOWED_VOICES.has(requestedVoice)) {
        voiceName = requestedVoice;
      }
    } catch {
      // keep default Zephyr
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        apiVersion: 'v1beta',
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    let session: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let sessionPromise: Promise<Awaited<ReturnType<typeof ai.live.connect>>> | null = null;
    let isClosed = false;

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      if (session) {
        try {
          session.close();
        } catch {
          // ignore close errors
        }
        session = null;
      }
    };

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);

    clientWs.on('message', async (rawData) => {
      if (isClosed || !sessionPromise) return;
      try {
        const activeSession = session ?? (await sessionPromise);
        if (isClosed || !activeSession) return;

        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          audio?: string;
          text?: string;
          image?: string;
          mimeType?: string;
        };

        if (msg.type === 'audio' && typeof msg.audio === 'string' && msg.audio) {
          activeSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          activeSession.sendRealtimeInput({
            text: msg.text.trim(),
          });
        } else if (msg.type === 'video' && typeof msg.image === 'string' && msg.image) {
          const base64 = msg.image.includes(',')
            ? msg.image.split(',')[1]
            : msg.image;
          activeSession.sendRealtimeInput({
            video: {
              data: base64,
              mimeType: msg.mimeType || 'image/jpeg',
            },
          });
        }
      } catch (err) {
        sendSafe(clientWs, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Invalid Live API message payload.',
        });
      }
    });

    try {
      sessionPromise = ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: LIVE_TOOLS }],
          systemInstruction:
            'You are Fresh Vibe Voice Assistant, a helpful real-time spoken assistant for the Fresh Vibe AI Smart Expiry Tracker. Speak naturally, clearly, and concisely. Always call the provided inventory and camera tools whenever the user asks about their stored products, expiring items, food/medicine shelf life in their inventory, or ESP32-CAM connection status. If a user shares a product packaging photo via camera snapshot, inspect it carefully for product identity and printed EXP/BEST BEFORE/MFG dates without ever fabricating dates. Never guess or invent inventory items.',
        },
        callbacks: {
          onmessage: async (message: LiveServerMessage) => {
            if (isClosed) return;

            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              sendSafe(clientWs, {
                type: 'inputTranscript',
                text: content.inputTranscription.text,
              });
            }
            if (content?.outputTranscription?.text) {
              sendSafe(clientWs, {
                type: 'outputTranscript',
                text: content.outputTranscription.text,
              });
            }
            if (content?.interrupted) {
              sendSafe(clientWs, { type: 'interrupted' });
            }
            if (content?.turnComplete) {
              sendSafe(clientWs, { type: 'turnComplete' });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendSafe(clientWs, {
                  type: 'audio',
                  audio: part.inlineData.data,
                });
              }
            }

            if (message.toolCall?.functionCalls?.length && sessionPromise) {
              const responses = [];
              for (const call of message.toolCall.functionCalls) {
                const callName = call.name || '';
                const outcome = await executeLiveTool(
                  callName,
                  (call.args as Record<string, unknown> | undefined) || {}
                );
                sendSafe(clientWs, {
                  type: 'toolActivity',
                  name: callName,
                  summary: outcome.summary,
                });
                responses.push({
                  id: call.id,
                  name: callName,
                  response: { result: outcome.result },
                });
              }
              try {
                const activeSession = session ?? (await sessionPromise);
                activeSession.sendToolResponse({ functionResponses: responses });
              } catch (err) {
                sendSafe(clientWs, {
                  type: 'error',
                  message:
                    err instanceof Error ? err.message : 'Failed to send tool response to Live API.',
                });
              }
            }
          },
          onerror: (err: unknown) => {
            const msg =
              err && typeof err === 'object' && 'message' in err
                ? String((err as { message: unknown }).message)
                : 'Gemini Live API session error.';
            sendSafe(clientWs, { type: 'error', message: msg });
          },
          onclose: () => {
            sendSafe(clientWs, { type: 'closed' });
            cleanup();
          },
        },
      });

      session = await sessionPromise;
      if (isClosed) {
        session.close();
        session = null;
        return;
      }

      sendSafe(clientWs, {
        type: 'ready',
        model: 'gemini-3.8-live',
        voice: voiceName,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to establish Gemini Live API session.';
      sendSafe(clientWs, { type: 'error', message: msg });
      cleanup();
      clientWs.close(1011, 'Live session init failed');
      return;
    }
  });
}
