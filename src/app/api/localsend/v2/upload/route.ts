import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LocalSendUploadSession {
  sessionId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  senderAlias: string;
  payload: Uint8Array;
  createdAt: number;
}

const globalForLocalSendUploads = globalThis as unknown as {
  __SOUNDDROP_LOCALSEND_UPLOADS__?: Map<string, LocalSendUploadSession>;
};

if (!globalForLocalSendUploads.__SOUNDDROP_LOCALSEND_UPLOADS__) {
  globalForLocalSendUploads.__SOUNDDROP_LOCALSEND_UPLOADS__ = new Map<
    string,
    LocalSendUploadSession
  >();
}

const localSendUploads = globalForLocalSendUploads.__SOUNDDROP_LOCALSEND_UPLOADS__;

function purgeExpiredSessions() {
  const now = Date.now();
  localSendUploads.forEach((item, key) => {
    if (now - item.createdAt > 300000) {
      localSendUploads.delete(key);
    }
  });
}

export async function POST(req: NextRequest) {
  purgeExpiredSessions();
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId') || 'ls-session';
    const fileId = searchParams.get('fileId') || 'ls-file';
    const fileName = decodeURIComponent(
      searchParams.get('fileName') || req.headers.get('x-localsend-filename') || 'localsend_file.bin'
    );
    const senderAlias =
      searchParams.get('sender') || req.headers.get('x-localsend-sender') || 'LocalSend Peer';
    const mimeType = req.headers.get('content-type') || 'application/octet-stream';

    const buf = await req.arrayBuffer();
    const bytes = new Uint8Array(buf);

    const key = `${sessionId}:${fileId}`;
    localSendUploads.set(key, {
      sessionId,
      fileId,
      fileName,
      mimeType,
      size: bytes.byteLength,
      senderAlias,
      payload: bytes,
      createdAt: Date.now(),
    });

    return NextResponse.json(
      {
        success: true,
        sessionId,
        fileId,
        fileName,
        size: bytes.byteLength,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  purgeExpiredSessions();
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const fileId = searchParams.get('fileId');

  if (sessionId && fileId) {
    const record = localSendUploads.get(`${sessionId}:${fileId}`);
    if (!record) {
      return NextResponse.json({ error: 'LocalSend file not found' }, { status: 404 });
    }
    return new NextResponse(record.payload.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': record.mimeType,
        'Content-Length': String(record.size),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(record.fileName)}"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const list = Array.from(localSendUploads.values()).map((u) => ({
    sessionId: u.sessionId,
    fileId: u.fileId,
    fileName: u.fileName,
    mimeType: u.mimeType,
    size: u.size,
    senderAlias: u.senderAlias,
    createdAt: u.createdAt,
  }));

  return NextResponse.json(
    { uploads: list },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    }
  );
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
