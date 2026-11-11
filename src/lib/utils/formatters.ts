/**
 * Utility formatters for metrics, transfer calculations, and data formatting.
 */

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeIndex = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(dm))} ${sizes[safeIndex]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(mins)}:${pad(secs)}`;
}

export function calculateEta(bytesSent: number, totalBytes: number, bytesPerSec: number): string {
  if (bytesPerSec <= 0 || bytesSent >= totalBytes) return '00:00';
  const remainingBytes = totalBytes - bytesSent;
  const remainingSeconds = remainingBytes / bytesPerSec;
  return formatDuration(remainingSeconds);
}

export function formatFrequency(hz: number): string {
  if (hz >= 1000) {
    return `${(hz / 1000).toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

export function formatDecibels(db: number): string {
  if (isNaN(db) || !isFinite(db)) return '-∞ dB';
  return `${db.toFixed(1)} dB`;
}
