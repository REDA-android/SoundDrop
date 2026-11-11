/**
 * LocalSend Protocol Specification (v2.1)
 * Derived from localsend/localsend open-source specification.
 * Includes real peer registration, discovery, prepare-upload, and binary upload/download.
 */

const ADJECTIVES = [
  'Swift', 'Silent', 'Golden', 'Brave', 'Gentle', 'Clever', 'Agile', 'Bright',
  'Calm', 'Eager', 'Fierce', 'Grand', 'Happy', 'Jolly', 'Keen', 'Lively',
  'Mighty', 'Noble', 'Quick', 'Radiant', 'Sturdy', 'Vivid', 'Warm', 'Zealous',
];

const NOUNS = [
  'Falcon', 'Comet', 'Otter', 'Badger', 'Dolphin', 'Eagle', 'Fox', 'Hawk',
  'Jaguar', 'Koala', 'Lion', 'Lynx', 'Panda', 'Raven', 'Tiger', 'Wolf',
  'Orion', 'Polaris', 'Sirius', 'Vega', 'Beacon', 'Pebble', 'Stream', 'Nova',
];

export function generateLocalSendAlias(seed?: string): string {
  let hash = 0;
  if (seed) {
    for (let i = 0; i < seed.length; i++) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
  } else {
    hash = Math.floor(Math.random() * 1000000);
  }
  const adjIndex = Math.abs(hash) % ADJECTIVES.length;
  const nounIndex = Math.abs(hash >> 3) % NOUNS.length;
  return `${ADJECTIVES[adjIndex]} ${NOUNS[nounIndex]}`;
}

export interface LocalSendDevice {
  alias: string;
  version: '2.1';
  deviceModel: string;
  deviceType: 'web' | 'desktop' | 'mobile';
  fingerprint: string;
  port: number;
  protocol: 'https' | 'http';
  download: boolean;
  lastSeen?: number;
}

export interface LocalSendFileDto {
  id: string;
  fileName: string;
  size: number;
  fileType: string;
  sha256?: string;
  preview?: string;
}

export interface LocalSendPrepareUploadRequest {
  info: LocalSendDevice;
  files: Record<string, LocalSendFileDto>;
}

export interface LocalSendPrepareUploadResponse {
  sessionId: string;
  files: Record<string, string>; // fileId -> token
}

export interface LocalSendUploadedItem {
  sessionId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  senderAlias: string;
  createdAt: number;
}

export async function registerAndFetchLocalSendPeers(
  device: LocalSendDevice
): Promise<LocalSendDevice[]> {
  try {
    const res = await fetch('/api/localsend/v2/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(device),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { peers?: LocalSendDevice[] };
    return (data.peers || []).filter((p) => p.fingerprint !== device.fingerprint);
  } catch {
    return [];
  }
}

export async function uploadFileViaLocalSend(
  sender: LocalSendDevice,
  file: File,
  sha256?: string
): Promise<{ sessionId: string; fileId: string }> {
  const fileId = `file-${Date.now()}`;
  const prepRes = await fetch('/api/localsend/v2/prepare-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      info: sender,
      files: {
        [fileId]: {
          id: fileId,
          fileName: file.name,
          size: file.size,
          fileType: file.type || 'application/octet-stream',
          sha256,
        },
      },
    } satisfies LocalSendPrepareUploadRequest),
  });

  if (!prepRes.ok) {
    throw new Error(`Erreur LocalSend prepare-upload (${prepRes.status})`);
  }

  const prepData = (await prepRes.json()) as LocalSendPrepareUploadResponse;
  const token = prepData.files[fileId] || 'token';

  const buf = await file.arrayBuffer();
  const uploadUrl = `/api/localsend/v2/upload?sessionId=${encodeURIComponent(
    prepData.sessionId
  )}&fileId=${encodeURIComponent(fileId)}&token=${encodeURIComponent(
    token
  )}&fileName=${encodeURIComponent(file.name)}&sender=${encodeURIComponent(sender.alias)}`;

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-LocalSend-Filename': encodeURIComponent(file.name),
      'X-LocalSend-Sender': sender.alias,
    },
    body: buf,
  });

  if (!upRes.ok) {
    throw new Error(`Erreur LocalSend upload (${upRes.status})`);
  }

  return { sessionId: prepData.sessionId, fileId };
}

export async function fetchAvailableLocalSendFiles(): Promise<LocalSendUploadedItem[]> {
  try {
    const res = await fetch('/api/localsend/v2/upload', {
      headers: { 'Cache-Control': 'no-store' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { uploads?: LocalSendUploadedItem[] };
    return data.uploads || [];
  } catch {
    return [];
  }
}
