import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * OpenDrop / Apple AirDrop /Discover protocol handler
 * Corresponds to OpenDrop server.py handle_discover()
 */
export async function POST(req: NextRequest) {
  try {
    const userAgent = req.headers.get('user-agent') || 'OpenDrop-Client';

    const responsePayload = {
      ReceiverComputerName: 'SoundDrop Station',
      ReceiverModelName: 'MacBookPro18,1',
      ReceiverMediaCapabilities: {
        Version: 1,
        Vendor: {
          'com.apple': {
            OSVersion: [14, 4, 1],
            OSBuildVersion: '23E224',
          },
        },
      },
      Protocol: 'AirDrop/2.0 (seemoo-lab/opendrop compatible)',
      ClientAgent: userAgent,
      Timestamp: Date.now(),
    };

    return NextResponse.json(responsePayload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-AirDrop-Version': '2.0',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST(new NextRequest('https://localhost/api/opendrop/discover', { method: 'POST' }));
}
