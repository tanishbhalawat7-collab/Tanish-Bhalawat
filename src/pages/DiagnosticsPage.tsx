import { CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DiagnosticsReport, NavSection } from '../types';

export function DiagnosticsPage({
  onNavigate,
}: {
  onNavigate: (section: NavSection) => void;
}) {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDiagnostics();
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diagnostics request failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const rows = report
    ? [
        {
          name: 'Frontend Application',
          ok: report.frontend.ok,
          detail: report.frontend.detail,
        },
        {
          name: 'Backend API Server',
          ok: report.backend.ok,
          detail: report.backend.detail,
        },
        {
          name: 'SQLite Database',
          ok: report.database.ok,
          detail: report.database.ok
            ? `${report.database.path} · ${report.database.productCount} products stored`
            : report.database.error || 'Database unreachable',
        },
        {
          name: 'ESP32-CAM Capture Health',
          ok: report.camera.connected,
          detail: report.camera.connected
            ? `${report.camera.message} (${report.camera.latencyMs}ms)`
            : report.camera.error || report.camera.message,
          actionLabel: 'Configure Camera',
          action: () => onNavigate('camera'),
        },
        {
          name: 'Barcode Scanner (ZXing)',
          ok: report.barcode.ok,
          detail: report.barcode.detail,
        },
        {
          name: 'OCR Engine (Tesseract.js)',
          ok: report.ocr.ok,
          detail: report.ocr.detail,
        },
        {
          name: `AI Product Recognition (${report.ai.model})`,
          ok: report.ai.ok,
          detail: report.ai.detail,
        },
      ]
    : [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-xl border border-[#E5EAE7] bg-white p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#111827]">Live System Diagnostics</h2>
          <p className="text-xs text-[#6B7280]">
            Real-time verification of Frontend, Backend, Database, ESP32-CAM (/capture JPEG),
            Barcode Decoder, OCR, and Gemini AI
          </p>
        </div>
        <button
          type="button"
          onClick={runDiagnostics}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-[#059669] px-4 py-2 text-xs font-medium text-white hover:bg-[#047857] disabled:opacity-60 self-start sm:self-center whitespace-nowrap"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          <span>{loading ? 'Running Checks...' : 'Re-run Diagnostics'}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs text-[#991B1B]">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-[#E5EAE7] bg-white divide-y divide-[#E5EAE7]">
        {loading && !report ? (
          <div className="p-8 text-center text-xs text-[#6B7280]">
            Verifying live connections across all subsystems...
          </div>
        ) : (
          rows.map((item) => (
            <div
              key={item.name}
              className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                {item.ok ? (
                  <CheckCircle2 className="h-5 w-5 text-[#059669] mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-[#DC2626] mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-semibold text-[#111827]">{item.name}</p>
                  <p className="text-xs text-[#4B5563] mt-0.5">{item.detail}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={`text-xs font-medium ${
                    item.ok ? 'text-[#059669]' : 'text-[#DC2626]'
                  }`}
                >
                  {item.ok ? 'Operational' : 'Unavailable'}
                </span>
                {item.action && (
                  <button
                    type="button"
                    onClick={item.action}
                    className="rounded-md border border-[#D1D5DB] px-2.5 py-1 text-xs font-medium text-[#111827] hover:bg-[#F6F9F7]"
                  >
                    {item.actionLabel}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {report && (
        <p className="text-xs font-mono text-[#6B7280] tabular-nums">
          Last verified at {new Date(report.timestamp).toLocaleString()}
        </p>
      )}
    </div>
  );
}
