import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface SharedClipboardItem {
  id: string;
  senderName: string;
  payload: string;
  timestamp: number;
  encrypted?: boolean;
}

export interface RoomRecord {
  roomId: string;
  offer: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit;
  initiatorCandidates: RTCIceCandidateInit[];
  receiverCandidates: RTCIceCandidateInit[];
  clipboardMessages: SharedClipboardItem[];
  pakePhrase?: string;
  warpinatorPinHash?: string;
  createdAt: number;
  updatedAt: number;
}

interface GlobalSignalStore {
  roomRegistry: Map<string, RoomRecord>;
  globalClipboardFeed: SharedClipboardItem[];
}

const globalForSignal = globalThis as unknown as {
  __SOUNDDROP_SIGNAL_STORE__?: GlobalSignalStore;
};

if (!globalForSignal.__SOUNDDROP_SIGNAL_STORE__) {
  globalForSignal.__SOUNDDROP_SIGNAL_STORE__ = {
    roomRegistry: new Map<string, RoomRecord>(),
    globalClipboardFeed: [],
  };
}

const roomRegistry = globalForSignal.__SOUNDDROP_SIGNAL_STORE__.roomRegistry;
const globalClipboardFeed = globalForSignal.__SOUNDDROP_SIGNAL_STORE__.globalClipboardFeed;

function cleanExpiredRooms() {
  const now = Date.now();
  roomRegistry.forEach((room, id) => {
    if (now - room.updatedAt > 600000) {
      roomRegistry.delete(id);
    }
  });
  while (globalClipboardFeed.length > 30) {
    globalClipboardFeed.shift();
  }
}

function getOrCreateRoom(roomId: string): RoomRecord {
  const cleanId = roomId.trim().toUpperCase();
  let room = roomRegistry.get(cleanId);
  if (!room) {
    room = {
      roomId: cleanId,
      offer: null,
      initiatorCandidates: [],
      receiverCandidates: [],
      clipboardMessages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    roomRegistry.set(cleanId, room);
  }
  room.updatedAt = Date.now();
  return room;
}

function mergeUniqueCandidates(
  target: RTCIceCandidateInit[],
  incoming: RTCIceCandidateInit[]
): void {
  const existingKeys = new Set(target.map((c) => JSON.stringify(c)));
  for (const cand of incoming) {
    if (!cand) continue;
    const key = JSON.stringify(cand);
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      target.push(cand);
    }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { action: string[] } }
) {
  cleanExpiredRooms();
  const action = params.action ? params.action[0] : '';

  try {
    const body = await req.json().catch(() => ({}));
    const {
      roomId,
      offer,
      answer,
      candidate,
      candidates,
      role,
      senderName,
      payload,
      encrypted,
      pakePhrase,
      keepAlive,
    } = body;

    // 1. ACTION: create (or room) — also supports keepAlive heartbeat from Sender
    if (action === 'create' || action === 'room') {
      if (!roomId || !offer) {
        return NextResponse.json(
          { error: 'Missing roomId or offer parameter' },
          { status: 400 }
        );
      }

      const room = getOrCreateRoom(roomId);
      room.offer = offer;
      if (!keepAlive) {
        room.answer = undefined;
      }
      if (pakePhrase) {
        room.pakePhrase = pakePhrase;
      }
      if (Array.isArray(candidates)) {
        mergeUniqueCandidates(room.initiatorCandidates, candidates);
      }

      return NextResponse.json(
        {
          success: true,
          roomId: room.roomId,
          answer: room.answer || null,
          receiverCandidates: room.receiverCandidates,
          initiatorCandidatesCount: room.initiatorCandidates.length,
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // 2. ACTION: join (or answer)
    if (action === 'join' || action === 'answer') {
      if (!roomId) {
        return NextResponse.json({ error: 'Missing roomId parameter' }, { status: 400 });
      }

      const room = getOrCreateRoom(roomId);

      if (answer) {
        room.answer = answer;
      }

      if (candidate) {
        if (role === 'initiator' || role === 'sender') {
          mergeUniqueCandidates(room.initiatorCandidates, [candidate]);
        } else {
          mergeUniqueCandidates(room.receiverCandidates, [candidate]);
        }
      }

      if (Array.isArray(candidates)) {
        if (role === 'initiator' || role === 'sender') {
          mergeUniqueCandidates(room.initiatorCandidates, candidates);
        } else {
          mergeUniqueCandidates(room.receiverCandidates, candidates);
        }
      }

      return NextResponse.json(
        {
          success: true,
          roomId: room.roomId,
          offer: room.offer,
          initiatorCandidates: room.initiatorCandidates,
          timestamp: Date.now(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // 3. ACTION: candidate
    if (action === 'candidate') {
      if (!roomId || !candidate) {
        return NextResponse.json(
          { error: 'Missing roomId or candidate' },
          { status: 400 }
        );
      }

      const room = getOrCreateRoom(roomId);

      if (role === 'initiator' || role === 'sender') {
        mergeUniqueCandidates(room.initiatorCandidates, [candidate]);
      } else {
        mergeUniqueCandidates(room.receiverCandidates, [candidate]);
      }

      return NextResponse.json({ success: true });
    }

    // 4. ACTION: clipboard
    if (action === 'clipboard') {
      if (!payload || typeof payload !== 'string') {
        return NextResponse.json({ error: 'Missing clipboard payload' }, { status: 400 });
      }

      const item: SharedClipboardItem = {
        id: `clip-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        senderName: senderName || 'SoundDrop Peer',
        payload: payload.slice(0, 16384),
        timestamp: Date.now(),
        encrypted: Boolean(encrypted),
      };

      globalClipboardFeed.push(item);

      if (roomId) {
        const room = getOrCreateRoom(roomId);
        room.clipboardMessages.push(item);
      }

      return NextResponse.json({ success: true, item });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { action: string[] } }
) {
  cleanExpiredRooms();
  const action = params.action ? params.action[0] : '';
  const { searchParams } = new URL(req.url);
  const roomId = searchParams.get('roomId')?.trim().toUpperCase();

  // 0. ACTION: clipboard
  if (action === 'clipboard') {
    const items = roomId
      ? roomRegistry.get(roomId)?.clipboardMessages || globalClipboardFeed
      : globalClipboardFeed;
    return NextResponse.json(
      { items: items.slice(-20).reverse() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // 0b. ACTION: rooms
  if (action === 'rooms') {
    const activeRooms = Array.from(roomRegistry.values())
      .filter((r) => r.offer !== null)
      .map((r) => ({
        roomId: r.roomId,
        pakePhrase: r.pakePhrase,
        hasAnswer: Boolean(r.answer),
        createdAt: r.createdAt,
      }));
    return NextResponse.json(
      { rooms: activeRooms },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!roomId) {
    return NextResponse.json({ error: 'Missing roomId parameter' }, { status: 400 });
  }

  // 1. ACTION: join (Retrieve Offer and current room state)
  if (action === 'join' || action === 'room') {
    const room = roomRegistry.get(roomId);
    if (!room) {
      return NextResponse.json(
        {
          roomId,
          offer: null,
          answer: null,
          candidates: [],
          initiatorCandidates: [],
          clipboardMessages: [],
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        roomId: room.roomId,
        offer: room.offer,
        answer: room.answer || null,
        candidates: room.receiverCandidates,
        initiatorCandidates: room.initiatorCandidates,
        clipboardMessages: room.clipboardMessages,
        pakePhrase: room.pakePhrase,
        createdAt: room.createdAt,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // 2. ACTION: stream (Server-Sent Events)
  if (action === 'stream') {
    const role = searchParams.get('role') || 'initiator';
    const encoder = new TextEncoder();
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let candidateIndex = 0;
    let answerDispatched = false;
    let offerDispatched = false;

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: ping\ndata: ${JSON.stringify({ connected: true })}\n\n`)
        );

        intervalId = setInterval(() => {
          const room = roomRegistry.get(roomId);
          if (!room) {
            controller.enqueue(encoder.encode(`: waiting-for-room\n\n`));
            return;
          }

          if (role === 'receiver' && room.offer && !offerDispatched) {
            offerDispatched = true;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'offer', offer: room.offer })}\n\n`
              )
            );
          }

          if (role === 'initiator' && room.answer && !answerDispatched) {
            answerDispatched = true;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'answer', answer: room.answer })}\n\n`
              )
            );
          }

          const targetCandidates =
            role === 'initiator' ? room.receiverCandidates : room.initiatorCandidates;

          while (candidateIndex < targetCandidates.length) {
            const cand = targetCandidates[candidateIndex++];
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'candidate', candidate: cand })}\n\n`)
            );
          }

          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        }, 350);
      },
      cancel() {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
