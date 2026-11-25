import {
  AlertCircle,
  AudioLines,
  Camera,
  Database,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Volume2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { NavSection } from '../types';

type VoiceOption = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';
type SessionStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface TranscriptItem {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: string;
  toolName?: string;
}

const VOICE_OPTIONS: Array<{ value: VoiceOption; label: string; tone: string }> = [
  { value: 'Zephyr', label: 'Zephyr', tone: 'Warm & Balanced' },
  { value: 'Kore', label: 'Kore', tone: 'Clear & Crisp' },
  { value: 'Puck', label: 'Puck', tone: 'Upbeat & Energetic' },
  { value: 'Charon', label: 'Charon', tone: 'Deep & Steady' },
  { value: 'Fenrir', label: 'Fenrir', tone: 'Direct & Calm' },
];

const QUICK_PROMPTS = [
  'Which products are expiring soon or already expired?',
  'Give me a summary of my current inventory.',
  'Is my ESP32-CAM camera connected right now?',
  'Do I have any dairy or medicine products tracked?',
];

function downsampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === 16000 || sourceRate <= 0) {
    return input;
  }
  const ratio = sourceRate / 16000;
  const newLength = Math.max(1, Math.floor(input.length / ratio));
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    result[i] = count > 0 ? sum / count : input[start] ?? 0;
  }
  return result;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(new ArrayBuffer(sampleCount * 4));
  for (let i = 0; i < sampleCount; i += 1) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

function formatTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function compressSnapshotToJpeg(dataUrl: string, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Failed to decode snapshot image'));
    img.src = dataUrl;
  });
}

interface VoiceAssistantPageProps {
  onNavigate: (section: NavSection) => void;
}

export function VoiceAssistantPage({ onNavigate }: VoiceAssistantPageProps) {
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [voice, setVoice] = useState<VoiceOption>('Zephyr');
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [snapshotPreview, setSnapshotPreview] = useState<string | null>(null);
  const [capturingCamera, setCapturingCamera] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mutedRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const lastLevelUpdateRef = useRef(0);
  const pendingPromptRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) setMicLevel(0);
  }, [muted]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const stopPlaybackQueue = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore already stopped source
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setAssistantSpeaking(false);
  }, []);

  const stopSession = useCallback(() => {
    sessionReadyRef.current = false;
    pendingPromptRef.current = null;
    stopPlaybackQueue();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      } catch {
        // ignore disconnect errors
      }
      processorRef.current = null;
    }

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      try {
        if (
          wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING
        ) {
          wsRef.current.close();
        }
      } catch {
        // ignore close errors
      }
      wsRef.current = null;
    }

    setMicLevel(0);
    setStatus('idle');
  }, [stopPlaybackQueue]);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, [stopSession]);

  const appendTranscriptChunk = useCallback(
    (role: 'user' | 'assistant', chunk: string) => {
      if (!chunk) return;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role) {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            text: `${last.text}${chunk}`,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role,
            text: chunk,
            timestamp: formatTime(),
          },
        ];
      });
    },
    []
  );

  const playAudioChunk = useCallback((base64Audio: string) => {
    const outputCtx = outputCtxRef.current;
    if (!outputCtx || outputCtx.state === 'closed') return;
    if (outputCtx.state === 'suspended') {
      outputCtx.resume().catch(() => {});
    }

    const float32 = base64Pcm16ToFloat32(base64Audio);
    if (float32.length === 0) return;

    const audioBuffer = outputCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = outputCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputCtx.destination);

    const now = outputCtx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;

    activeSourcesRef.current.add(source);
    setAssistantSpeaking(true);

    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setAssistantSpeaking(false);
      }
    };
  }, []);

  const startSession = useCallback(
    async (initialPrompt?: string) => {
      if (status === 'connecting' || status === 'connected') return;

      setErrorMsg(null);
      setStatus('connecting');
      pendingPromptRef.current = initialPrompt || null;

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setErrorMsg('Microphone access is not supported in this browser context.');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;
      } catch (err) {
        setStatus('error');
        setErrorMsg(
          err instanceof Error
            ? `Microphone permission denied or unavailable: ${err.message}`
            : 'Microphone permission is required for live voice conversations.'
        );
        return;
      }

      try {
        const inputCtx = new AudioContext({ sampleRate: 16000 });
        const outputCtx = new AudioContext({ sampleRate: 24000 });
        if (inputCtx.state === 'suspended') await inputCtx.resume();
        if (outputCtx.state === 'suspended') await outputCtx.resume();
        inputCtxRef.current = inputCtx;
        outputCtxRef.current = outputCtx;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/live?voice=${encodeURIComponent(voice)}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        const silentGain = inputCtx.createGain();
        silentGain.gain.value = 0;

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(inputCtx.destination);
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          const channelData = event.inputBuffer.getChannelData(0);
          const now = performance.now();

          if (!mutedRef.current && now - lastLevelUpdateRef.current > 65) {
            let sumSquares = 0;
            for (let i = 0; i < channelData.length; i += 4) {
              const s = channelData[i];
              sumSquares += s * s;
            }
            const rms = Math.sqrt(sumSquares / Math.max(1, channelData.length / 4));
            const normalized = Math.min(1, rms * 4.5);
            setMicLevel(normalized);
            lastLevelUpdateRef.current = now;
          }

          if (
            mutedRef.current ||
            !sessionReadyRef.current ||
            wsRef.current?.readyState !== WebSocket.OPEN
          ) {
            return;
          }

          const resampled = downsampleTo16k(channelData, inputCtx.sampleRate);
          const base64Audio = float32ToPcm16Base64(resampled);
          wsRef.current.send(
            JSON.stringify({
              type: 'audio',
              audio: base64Audio,
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as {
              type?: string;
              audio?: string;
              text?: string;
              message?: string;
              name?: string;
              summary?: string;
            };

            switch (msg.type) {
              case 'ready':
                sessionReadyRef.current = true;
                setStatus('connected');
                if (pendingPromptRef.current) {
                  const text = pendingPromptRef.current;
                  pendingPromptRef.current = null;
                  setTranscript((prev) => [
                    ...prev,
                    {
                      id: `${Date.now()}-prompt`,
                      role: 'user',
                      text,
                      timestamp: formatTime(),
                    },
                  ]);
                  ws.send(JSON.stringify({ type: 'text', text }));
                }
                break;

              case 'audio':
                if (msg.audio) playAudioChunk(msg.audio);
                break;

              case 'inputTranscript':
                if (msg.text) appendTranscriptChunk('user', msg.text);
                break;

              case 'outputTranscript':
                if (msg.text) appendTranscriptChunk('assistant', msg.text);
                break;

              case 'toolActivity':
                setTranscript((prev) => [
                  ...prev,
                  {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    role: 'tool',
                    text: msg.summary || `Executed ${msg.name || 'tool'}`,
                    toolName: msg.name,
                    timestamp: formatTime(),
                  },
                ]);
                break;

              case 'interrupted':
                stopPlaybackQueue();
                break;

              case 'error':
                setErrorMsg(msg.message || 'Voice session error occurred.');
                setStatus('error');
                break;

              case 'closed':
                stopSession();
                break;

              default:
                break;
            }
          } catch {
            // ignore malformed websocket frame
          }
        };

        ws.onerror = () => {
          setErrorMsg('WebSocket connection to the Live voice server failed.');
          stopSession();
          setStatus('error');
        };

        ws.onclose = () => {
          if (sessionReadyRef.current) {
            stopSession();
          }
        };
      } catch (err) {
        stopSession();
        setStatus('error');
        setErrorMsg(
          err instanceof Error ? err.message : 'Unable to start audio capture or Live session.'
        );
      }
    },
    [appendTranscriptChunk, playAudioChunk, status, stopPlaybackQueue, stopSession, voice]
  );

  const sendTextMessage = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;

      if (status !== 'connected' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        await startSession(clean);
        return;
      }

      setTranscript((prev) => [
        ...prev,
        {
          id: `${Date.now()}-user-txt`,
          role: 'user',
          text: clean,
          timestamp: formatTime(),
        },
      ]);
      wsRef.current.send(JSON.stringify({ type: 'text', text: clean }));
    },
    [startSession, status]
  );

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    const msg = textInput;
    setTextInput('');
    await sendTextMessage(msg);
  };

  const sendVisualFrame = useCallback(
    async (rawDataUrl: string, labelPrompt: string) => {
      const jpegDataUrl = await compressSnapshotToJpeg(rawDataUrl);
      setSnapshotPreview(jpegDataUrl);

      if (status !== 'connected' || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setErrorMsg('Start the voice session first, then capture or upload a snapshot to discuss it live.');
        return;
      }

      wsRef.current.send(
        JSON.stringify({
          type: 'video',
          image: jpegDataUrl,
          mimeType: 'image/jpeg',
        })
      );
      wsRef.current.send(
        JSON.stringify({
          type: 'text',
          text: labelPrompt,
        })
      );
      setTranscript((prev) => [
        ...prev,
        {
          id: `${Date.now()}-snap`,
          role: 'tool',
          text: 'Shared product image snapshot with live voice session',
          toolName: 'camera_snapshot',
          timestamp: formatTime(),
        },
      ]);
    },
    [status]
  );

  const handleCaptureEsp32Snapshot = async () => {
    setCapturingCamera(true);
    setErrorMsg(null);
    try {
      const frame = await api.captureCameraFrame();
      await sendVisualFrame(
        frame.imageDataUrl,
        'I just captured this frame from my ESP32-CAM. Tell me what product this is and read any expiry or manufacturing dates you can spot.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to capture ESP32-CAM frame. Verify camera connection on Connect Camera.'
      );
    } finally {
      setCapturingCamera(false);
    }
  };

  const handleUploadSnapshot = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        try {
          await sendVisualFrame(
            reader.result,
            'I just shared a photo of a product package. Identify the item and read any printed expiry or best-before date.'
          );
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to send image snapshot.');
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const isLive = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <div className="space-y-6">
      {/* Top Hero / Session Controls */}
      <section className="rounded-2xl border border-[#E5EAE7] bg-white p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2.5">
              <div
                className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                  isLive
                    ? 'bg-[#ECFDF5] text-[#059669]'
                    : 'bg-[#F3F6F4] text-[#374151]'
                }`}
              >
                <AudioLines className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-xl font-bold text-[#111827]">
                  Real-Time Voice Assistant
                </h2>
                <p className="text-xs text-[#6B7280]">
                  Speak naturally with Fresh Vibe about expiring products, inventory lookup, ESP32-CAM status, or live snapshots.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Voice Selector */}
            <div className="flex items-center gap-2 rounded-xl border border-[#E5EAE7] bg-[#F6F9F7] px-3 py-2">
              <Volume2 className="h-4 w-4 text-[#6B7280]" />
              <label htmlFor="voice-select" className="text-xs font-medium text-[#374151]">
                Voice
              </label>
              <select
                id="voice-select"
                value={voice}
                disabled={isLive || isConnecting}
                onChange={(e) => setVoice(e.target.value as VoiceOption)}
                className="bg-transparent text-xs font-semibold text-[#111827] focus:outline-none disabled:opacity-60"
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label} ({v.tone})
                  </option>
                ))}
              </select>
            </div>

            {isLive && (
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-colors ${
                  muted
                    ? 'border-[#F59E0B]/40 bg-[#FEF3C7] text-[#92400E]'
                    : 'border-[#E5EAE7] bg-white text-[#111827] hover:bg-[#F6F9F7]'
                }`}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4 text-[#059669]" />}
                <span>{muted ? 'Unmute Mic' : 'Mute Mic'}</span>
              </button>
            )}

            {isLive || isConnecting ? (
              <button
                type="button"
                onClick={stopSession}
                className="inline-flex items-center gap-2 rounded-xl bg-[#DC2626] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#B91C1C] transition-colors"
              >
                <PhoneOff className="h-4 w-4" />
                <span>{isConnecting ? 'Cancel' : 'End Conversation'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => startSession()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#059669] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#047857] transition-colors shadow-xs"
              >
                <Mic className="h-4 w-4" />
                <span>Start Voice Conversation</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Audio Activity & Snapshot Bar */}
        <div className="mt-6 pt-5 border-t border-[#E5EAE7] grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          {/* Mic Input Meter */}
          <div className="rounded-xl border border-[#E5EAE7] bg-[#F6F9F7] px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                Microphone Input
              </p>
              <p className="text-xs font-medium text-[#111827] mt-0.5">
                {!isLive
                  ? isConnecting
                    ? 'Connecting microphone...'
                    : 'Ready to listen'
                  : muted
                  ? 'Microphone muted'
                  : 'Streaming 16kHz PCM'}
              </p>
            </div>
            <div className="flex items-end gap-1 h-7 shrink-0" aria-hidden="true">
              {[0.25, 0.45, 0.65, 0.85, 1].map((threshold, idx) => {
                const active = isLive && !muted && micLevel >= threshold * 0.35;
                const heightPct = 30 + idx * 16;
                return (
                  <span
                    key={threshold}
                    style={{ height: `${heightPct}%` }}
                    className={`w-1.5 rounded-full transition-colors duration-75 ${
                      active ? 'bg-[#059669]' : 'bg-[#D1D5DB]'
                    }`}
                  />
                );
              })}
            </div>
          </div>

          {/* Assistant Output Meter */}
          <div className="rounded-xl border border-[#E5EAE7] bg-[#F6F9F7] px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                Assistant Audio
              </p>
              <p className="text-xs font-medium text-[#111827] mt-0.5">
                {assistantSpeaking
                  ? `Speaking (${voice}, 24kHz)`
                  : isLive
                  ? 'Listening — interrupt anytime'
                  : 'Idle'}
              </p>
            </div>
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${
                assistantSpeaking
                  ? 'bg-[#059669] text-white scale-105'
                  : 'bg-white border border-[#E5EAE7] text-[#6B7280]'
              }`}
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#059669]" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </div>
          </div>

          {/* Visual Snapshot Actions */}
          <div className="rounded-xl border border-[#E5EAE7] bg-[#F6F9F7] px-4 py-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
                Visual Context
              </p>
              <p className="text-xs font-medium text-[#111827] mt-0.5 truncate">
                Ask about a package photo
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!isLive || capturingCamera}
                onClick={handleCaptureEsp32Snapshot}
                title="Capture live frame from ESP32-CAM and ask assistant"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5EAE7] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#ECFDF5] hover:border-[#059669]/40 disabled:opacity-50 transition-colors"
              >
                {capturingCamera ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Camera className="h-3.5 w-3.5 text-[#059669]" />
                )}
                <span>ESP32</span>
              </button>
              <button
                type="button"
                disabled={!isLive}
                onClick={() => fileInputRef.current?.click()}
                title="Upload product image to discuss in live session"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5EAE7] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111827] hover:bg-[#ECFDF5] hover:border-[#059669]/40 disabled:opacity-50 transition-colors"
              >
                <ImagePlus className="h-3.5 w-3.5 text-[#059669]" />
                <span>Photo</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleUploadSnapshot}
                className="hidden"
              />
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-[#DC2626]/30 bg-[#FEF2F2] px-4 py-3 flex items-start gap-3 text-xs text-[#991B1B]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{errorMsg}</p>
              {errorMsg.toLowerCase().includes('camera') && (
                <button
                  type="button"
                  onClick={() => onNavigate('camera')}
                  className="mt-1 font-semibold underline hover:text-[#7F1D1D]"
                >
                  Open Connect Camera settings
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Main Split: Live Transcript + Quick Prompts / Visual Context */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Conversation Transcript */}
        <section className="lg:col-span-2 rounded-2xl border border-[#E5EAE7] bg-white flex flex-col min-h-[420px] max-h-[580px]">
          <div className="px-5 py-4 border-b border-[#E5EAE7] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  isLive ? 'bg-[#059669] animate-pulse' : 'bg-[#D1D5DB]'
                }`}
              />
              <h3 className="font-display text-sm font-semibold text-[#111827]">
                Live Conversation Transcript
              </h3>
            </div>
            {transcript.length > 0 && (
              <button
                type="button"
                onClick={() => setTranscript([])}
                className="text-xs font-medium text-[#6B7280] hover:text-[#111827]"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {transcript.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 px-4">
                <div className="h-12 w-12 rounded-2xl bg-[#ECFDF5] text-[#059669] flex items-center justify-center mb-3">
                  <Mic className="h-6 w-6" />
                </div>
                <p className="text-sm font-semibold text-[#111827]">
                  Start speaking or pick a quick question
                </p>
                <p className="text-xs text-[#6B7280] max-w-md mt-1">
                  Your real-time spoken questions and the assistant&apos;s spoken answers appear here alongside live database and ESP32-CAM lookups.
                </p>
              </div>
            ) : (
              transcript.map((item) => {
                if (item.role === 'tool') {
                  return (
                    <div key={item.id} className="flex justify-center">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-[#E5EAE7] bg-[#F6F9F7] px-3 py-1.5 text-[11px] font-mono text-[#374151]">
                        <Database className="h-3 w-3 text-[#059669]" />
                        <span>{item.text}</span>
                        <span className="text-[#9CA3AF]">{item.timestamp}</span>
                      </div>
                    </div>
                  );
                }

                const isUser = item.role === 'user';
                return (
                  <div
                    key={item.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        isUser
                          ? 'bg-[#0D2E22] text-white'
                          : 'bg-[#F6F9F7] border border-[#E5EAE7] text-[#111827]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-wider ${
                            isUser ? 'text-[#6EE7B7]' : 'text-[#059669]'
                          }`}
                        >
                          {isUser ? 'You' : 'Fresh Vibe Voice'}
                        </span>
                        <span
                          className={`text-[10px] font-mono ${
                            isUser ? 'text-white/60' : 'text-[#9CA3AF]'
                          }`}
                        >
                          {item.timestamp}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{item.text}</p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Optional Text Prompt Input */}
          <form
            onSubmit={handleFormSubmit}
            className="p-3 border-t border-[#E5EAE7] flex items-center gap-2 bg-[#F6F9F7]/60 rounded-b-2xl"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={
                isLive
                  ? 'Type a question into the active voice session...'
                  : 'Type a question to start a voice response...'
              }
              className="flex-1 rounded-xl border border-[#E5EAE7] bg-white px-3.5 py-2.5 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-[#059669]"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || isConnecting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#0D2E22] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#144332] disabled:opacity-40 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Send</span>
            </button>
          </form>
        </section>

        {/* Right Column: Quick Questions & Snapshot Preview */}
        <aside className="space-y-6">
          <div className="rounded-2xl border border-[#E5EAE7] bg-white p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-[#111827]">
              Quick Voice Prompts
            </h3>
            <p className="text-xs text-[#6B7280]">
              Tap any prompt to ask immediately using live database and hardware tools.
            </p>
            <div className="space-y-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isConnecting}
                  onClick={() => sendTextMessage(prompt)}
                  className="w-full text-left rounded-xl border border-[#E5EAE7] bg-[#F6F9F7] px-3.5 py-2.5 text-xs font-medium text-[#111827] hover:border-[#059669] hover:bg-[#ECFDF5] transition-colors disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#E5EAE7] bg-white p-5 space-y-3">
            <h3 className="font-display text-sm font-semibold text-[#111827]">
              Last Shared Snapshot
            </h3>
            {snapshotPreview ? (
              <div className="space-y-2">
                <img
                  src={snapshotPreview}
                  alt="Shared product snapshot"
                  className="w-full h-44 object-cover rounded-xl border border-[#E5EAE7]"
                />
                <p className="text-[11px] text-[#6B7280]">
                  Sent to the active voice session for live packaging and expiry inspection.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-[#F6F9F7] p-6 text-center">
                <Camera className="h-6 w-6 text-[#9CA3AF] mx-auto mb-2" />
                <p className="text-xs text-[#6B7280]">
                  While live, use <strong>ESP32</strong> or <strong>Photo</strong> above to let the assistant see a product label and read its date aloud.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
