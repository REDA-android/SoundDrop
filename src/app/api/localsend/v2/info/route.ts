import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface RegisteredLocalSendNode {
  id: string;
  alias: string;
  version: string;
  deviceModel: string;
  deviceType: 'mobile' | 'desktop' | 'web' | 'headless';
  fingerprint: string;
  port: number;
  protocol: 'http' | 'https';
  download: boolean;
  lastSeen: number;
}

const globalForLocalSendNodes = globalThis as unknown as {
  __SOUNDDROP_LOCALSEND_NODES__?: Map<string, RegisteredLocalSendNode>;
};

if (!globalForLocalSendNodes.__SOUNDDROP_LOCALSEND_NODES__) {
  globalForLocalSendNodes.__SOUNDDROP_LOCALSEND_NODES__ = new Map<
    string,
    RegisteredLocalSendNode
  >();
}

const localSendNodes = globalForLocalSendNodes.__SOUNDDROP_LOCALSEND_NODES__;

function purgeExpiredNodes() {
  const now = Date.now();
  localSendNodes.forEach((node, id) => {
    if (now - node.lastSeen > 90000) {
      localSendNodes.delete(id);
    }
  });
}

export async function GET(req: NextRequest) {
  purgeExpiredNodes();
  const { searchParams } = new URL(req.url);
  const excludeId = searchParams.get('excludeId');

  const peers = Array.from(localSendNodes.values()).filter(
    (peer) => !excludeId || peer.id !== excludeId
  );

  return NextResponse.json(
    {
      alias: 'SoundDrop Web Node',
      version: '2.1',
      deviceModel: 'SoundDrop Multi-Protocol Engine',
      deviceType: 'web',
      fingerprint: 'SHA256-SOUNDDROP-TLS-FINGERPRINT-V2',
      port: 53317,
      protocol: 'https',
      download: true,
      announcement: true,
      peers,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function POST(req: NextRequest) {
  purgeExpiredNodes();
  try {
    const body = await req.json().catch(() => ({}));
    const id = (body.id as string) || (body.fingerprint as string) || `ls-${Date.now()}`;
    const peerRecord: RegisteredLocalSendNode = {
      id,
      alias: (body.alias as string) || 'LocalSend Peer',
      version: '2.1',
      deviceModel: (body.deviceModel as string) || 'Browser / LocalSend Client',
      deviceType: (body.deviceType as RegisteredLocalSendNode['deviceType']) || 'web',
      fingerprint: (body.fingerprint as string) || id,
      port: typeof body.port === 'number' ? body.port : 53317,
      protocol: 'https',
      download: true,
      lastSeen: Date.now(),
    };

    localSendNodes.set(id, peerRecord);

    const peers = Array.from(localSendNodes.values()).filter((p) => p.id !== id);

    return NextResponse.json(
      {
        status: 'REGISTERED',
        node: peerRecord,
        peers,
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
