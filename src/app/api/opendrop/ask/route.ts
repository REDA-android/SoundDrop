import { NextRequest, NextResponse } from 'next/server';
import { OpenDropAskRequest, OpenDropAskResponse } from '@/lib/opendrop/opendrop-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ManagedAskRecord extends OpenDropAskRequest {
  acknowledgedByReceiver?: boolean;
}

const globalForOpenDropAsk = globalThis as unknown as {
  __SOUNDDROP_OPENDROP_ASK__?: Map<string, ManagedAskRecord>;
};

if (!globalForOpenDropAsk.__SOUNDDROP_OPENDROP_ASK__) {
  globalForOpenDropAsk.__SOUNDDROP_OPENDROP_ASK__ = new Map<string, ManagedAskRecord>();
}

const pendingTransfers = globalForOpenDropAsk.__SOUNDDROP_OPENDROP_ASK__;

function purgeStaleTransfers() {
  const now = Date.now();
  pendingTransfers.forEach((req, id) => {
    if (now - req.timestamp > 300000) {
      pendingTransfers.delete(id);
    }
  });
}

export async function GET(req: NextRequest) {
  purgeStaleTransfers();
  const url = new URL(req.url);
  const nodeId = url.searchParams.get('nodeId') || url.searchParams.get('receiverId');
  const transferId = url.searchParams.get('transferId');

  if (transferId) {
    const item = pendingTransfers.get(transferId);
    if (!item) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }
    return NextResponse.json(item, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    });
  }

  if (nodeId) {
    const incoming: OpenDropAskRequest[] = [];
    pendingTransfers.forEach((item) => {
      if (
        (item.targetNodeId === nodeId || !item.targetNodeId) &&
        item.senderId !== nodeId &&
        !item.acknowledgedByReceiver &&
        item.status !== 'DECLINED'
      ) {
        incoming.push(item);
      }
    });
    return NextResponse.json(
      { incoming },
      {
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      }
    );
  }

  const all: OpenDropAskRequest[] = [];
  pendingTransfers.forEach((item) => all.push(item));
  return NextResponse.json(
    { transfers: all },
    {
      headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    }
  );
}

export async function POST(req: NextRequest) {
  purgeStaleTransfers();
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    const rawText = await req.text();
    let body: Record<string, unknown> = {};

    try {
      body = JSON.parse(rawText);
    } catch {
      body = {
        senderComputerName: req.headers.get('x-airdrop-sender') || 'OpenDrop-Peer',
      };
    }

    if (action === 'respond') {
      const transferId = (body.transferId as string) || '';
      const accepted = body.accepted === true;
      const record = pendingTransfers.get(transferId);

      if (record) {
        record.status = accepted ? 'ACCEPTED' : 'DECLINED';
        record.acknowledgedByReceiver = true;
        return NextResponse.json(
          { success: true, status: record.status },
          {
            headers: { 'Access-Control-Allow-Origin': '*' },
          }
        );
      }
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    const transferId = Math.random().toString(36).substring(2, 10).toUpperCase();
    const askRecord: ManagedAskRecord = {
      transferId,
      senderId:
        (body.senderId as string) || (body.senderComputerName as string) || 'OpenDrop-Sender',
      targetNodeId:
        (body.targetNodeId as string) || (body.receiverId as string) || undefined,
      senderComputerName: (body.senderComputerName as string) || 'OpenDrop Peer',
      senderModelName: (body.senderModelName as string) || 'AirDrop Device',
      bundleId: (body.bundleId as string) || undefined,
      files: Array.isArray(body.files) ? (body.files as OpenDropAskRequest['files']) : [],
      totalBytes: typeof body.totalBytes === 'number' ? body.totalBytes : 0,
      timestamp: Date.now(),
      status: 'ACCEPTED',
      acknowledgedByReceiver: false,
    };

    pendingTransfers.set(transferId, askRecord);

    const askResponse: OpenDropAskResponse = {
      accepted: true,
      transferId,
      receiverComputerName: 'SoundDrop Station',
      receiverModelName: 'AirDrop-PWA',
      status: 'ACCEPTED',
    };

    return NextResponse.json(
      {
        ...askResponse,
        protocol: 'AirDrop/2.0 (seemoo-lab/opendrop compatible)',
      },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-AirDrop-Transfer-Id': transferId,
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
