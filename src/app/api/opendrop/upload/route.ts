import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StoredUploadBuffer {
  transferId: string;
  fileName: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  chunks: Map<number, Uint8Array>;
  createdAt: number;
  completed: boolean;
}

const globalForOpenDropUploads = globalThis as unknown as {
  __SOUNDDROP_OPENDROP_UPLOADS__?: Map<string, StoredUploadBuffer>;
};

if (!globalForOpenDropUploads.__SOUNDDROP_OPENDROP_UPLOADS__) {
  globalForOpenDropUploads.__SOUNDDROP_OPENDROP_UPLOADS__ = new Map<string, StoredUploadBuffer>();
}

const uploadStore = globalForOpenDropUploads.__SOUNDDROP_OPENDROP_UPLOADS__;

function purgeExpiredUploads() {
  const now = Date.now();
  uploadStore.forEach((record, id) => {
    if (now - record.createdAt > 300000) {
      uploadStore.delete(id);
    }
  });
}

export async function POST(req: NextRequest) {
  purgeExpiredUploads();

  try {
    const transferId =
      req.headers.get('x-airdrop-transfer-id') ||
      new URL(req.url).searchParams.get('transferId') ||
      'default-transfer';
    const rawFileName = req.headers.get('x-airdrop-filename') || 'airdrop_payload.bin';
    const fileName = decodeURIComponent(rawFileName);
    const mimeType = req.headers.get('content-type') || 'application/octet-stream';
    const contentRange = req.headers.get('content-range');

    const arrayBuffer = await req.arrayBuffer();
    const chunkBytes = new Uint8Array(arrayBuffer);

    let offset = 0;
    let totalBytes = chunkBytes.byteLength;

    if (contentRange) {
      const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
      if (match) {
        offset = parseInt(match[1], 10);
        totalBytes = parseInt(match[3], 10);
      }
    }

    let record = uploadStore.get(transferId);
    if (!record) {
      record = {
        transferId,
        fileName,
        mimeType,
        totalBytes,
        receivedBytes: 0,
        chunks: new Map<number, Uint8Array>(),
        createdAt: Date.now(),
        completed: false,
      };
      uploadStore.set(transferId, record);
    }

    if (!record.chunks.has(offset)) {
      record.chunks.set(offset, chunkBytes);
      record.receivedBytes += chunkBytes.byteLength;
    }

    if (record.receivedBytes >= record.totalBytes) {
      record.completed = true;
    }

    return NextResponse.json(
      {
        success: true,
        transferId,
        receivedBytes: record.receivedBytes,
        totalBytes: record.totalBytes,
        completed: record.completed,
      },
      {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      }
    );
  }
}

export async function GET(req: NextRequest) {
  purgeExpiredUploads();
  const { searchParams } = new URL(req.url);
  const transferId = searchParams.get('transferId');
  const checkOnly = searchParams.get('meta') === '1';

  if (!transferId) {
    return NextResponse.json({ error: 'Missing transferId' }, { status: 400 });
  }

  const record = uploadStore.get(transferId);
  if (!record) {
    return NextResponse.json({ error: 'Upload payload not found or expired' }, { status: 404 });
  }

  if (checkOnly) {
    return NextResponse.json(
      {
        transferId: record.transferId,
        fileName: record.fileName,
        mimeType: record.mimeType,
        totalBytes: record.totalBytes,
        receivedBytes: record.receivedBytes,
        completed: record.completed,
      },
      {
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      }
    );
  }

  const sortedOffsets = Array.from(record.chunks.keys()).sort((a, b) => a - b);
  const fullBuffer = new Uint8Array(record.receivedBytes);
  let writeCursor = 0;

  for (const off of sortedOffsets) {
    const part = record.chunks.get(off);
    if (part) {
      fullBuffer.set(part, writeCursor);
      writeCursor += part.byteLength;
    }
  }

  return new NextResponse(fullBuffer.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': record.mimeType || 'application/octet-stream',
      'Content-Length': String(fullBuffer.byteLength),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(record.fileName)}"`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
