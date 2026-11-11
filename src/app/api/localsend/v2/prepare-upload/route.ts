import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = Math.random().toString(36).substring(2, 12);
    const files = (body.files as Record<string, { id: string }>) || {};
    const tokens: Record<string, string> = {};

    Object.keys(files).forEach((fileId) => {
      tokens[fileId] = `token-${Math.random().toString(36).substring(2, 8)}`;
    });

    return NextResponse.json(
      {
        sessionId,
        files: tokens,
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
