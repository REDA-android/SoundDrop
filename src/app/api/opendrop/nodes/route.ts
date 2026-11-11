import { NextRequest, NextResponse } from 'next/server';
import { OpenDropDevice } from '@/lib/opendrop/opendrop-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const globalForOpenDropNodes = globalThis as unknown as {
  __SOUNDDROP_OPENDROP_NODES__?: Map<string, OpenDropDevice>;
};

if (!globalForOpenDropNodes.__SOUNDDROP_OPENDROP_NODES__) {
  globalForOpenDropNodes.__SOUNDDROP_OPENDROP_NODES__ = new Map<string, OpenDropDevice>();
}

const activeNodes = globalForOpenDropNodes.__SOUNDDROP_OPENDROP_NODES__;

function purgeStaleNodes() {
  const now = Date.now();
  activeNodes.forEach((node, id) => {
    if (now - node.lastSeen > 90000) {
      activeNodes.delete(id);
    }
  });
}

export async function GET() {
  purgeStaleNodes();
  const list: OpenDropDevice[] = [];
  activeNodes.forEach((node) => {
    list.push(node);
  });
  return NextResponse.json(
    {
      nodes: list,
      protocol: 'AirDrop/2.0 (seemoo-lab/opendrop compatible)',
      timestamp: Date.now(),
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

export async function POST(req: NextRequest) {
  purgeStaleNodes();
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<OpenDropDevice>;
    if (!body.id || !body.computerName) {
      return NextResponse.json(
        { error: 'Missing id or computerName' },
        { status: 400 }
      );
    }

    const device: OpenDropDevice = {
      id: body.id,
      computerName: body.computerName,
      modelName: body.modelName || 'AirDrop-PWA',
      address: body.address || 'AirDrop 2.0 (P2P)',
      port: body.port,
      capabilities: {
        version: 1,
        heifSupported: true,
        airdropVersion: '2.0',
      },
      lastSeen: Date.now(),
      status: body.status || 'ONLINE',
    };

    activeNodes.set(device.id, device);

    return NextResponse.json(
      { success: true, node: device },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
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
