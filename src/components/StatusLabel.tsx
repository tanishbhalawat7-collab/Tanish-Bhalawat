import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { ExpiryStatus } from '../types';

export function ExpiryStatusIndicator({
  status,
  daysRemaining,
}: {
  status: ExpiryStatus;
  daysRemaining: number | null;
}) {
  if (status === 'fresh') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#059669] tabular-nums whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>Fresh ({daysRemaining}d left)</span>
      </span>
    );
  }
  if (status === 'expiring_soon') {
    const label =
      daysRemaining === 0
        ? 'Expires today'
        : daysRemaining === 1
          ? 'Expires tomorrow'
          : `Expiring in ${daysRemaining}d`;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D97706] tabular-nums whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === 'expired') {
    const daysAgo = daysRemaining !== null ? Math.abs(daysRemaining) : 0;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#DC2626] tabular-nums whitespace-nowrap">
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        <span>Expired ({daysAgo}d ago)</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] whitespace-nowrap">
      <HelpCircle className="h-3.5 w-3.5 shrink-0" />
      <span>Unknown expiry</span>
    </span>
  );
}

export function ProductImageFrame({
  src,
  alt,
  className = 'h-12 w-12',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        className={`${className} rounded-lg object-cover border border-[#E5EAE7] bg-[#F3F6F4] shrink-0`}
      />
    );
  }

  return (
    <div
      aria-label={alt}
      className={`${className} rounded-lg border border-[#E5EAE7] bg-gradient-to-br from-[#ECFDF5] to-[#E5EAE7] flex items-center justify-center text-[#0D2E22]/60 font-display font-semibold text-xs shrink-0`}
    >
      {alt.slice(0, 2).toUpperCase()}
    </div>
  );
}
