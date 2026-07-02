import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requireAuth } from '@/lib/shared/api-auth';

const execAsync = promisify(exec);

// Default recipient from env or config
const defaultTo = process.env.WHATSAPP_DEFAULT_NUMBER || '+919373111709';

export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { message, to } = body;

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Use provided 'to' number or fall back to default
    const recipientNumber = to || defaultTo;

    // Send WhatsApp message using OpenClaw CLI
    const command = `openclaw message send --channel whatsapp --target "${recipientNumber}" --message "${message.replace(/"/g, '\\"')}"`;

    const { stdout, stderr } = await execAsync(command);

    // Check if message was sent successfully
    if (stdout.includes('Sent via gateway') || stdout.includes('Message ID')) {
      // Extract message ID if present
      const messageIdMatch = stdout.match(/Message ID: ([A-Z0-9]+)/);
      const messageSid = messageIdMatch ? messageIdMatch[1] : 'sent';

      return NextResponse.json({
        success: true,
        messageSid,
        status: 'sent',
        to: recipientNumber,
        message: 'WhatsApp message sent successfully via OpenClaw',
        output: stdout.trim()
      });
    } else {
      throw new Error(stderr || stdout || 'Failed to send message');
    }

  } catch (error: any) {
    console.error('WhatsApp send error:', error);

    // Check for specific error messages
    if (error.message?.includes('No active WhatsApp Web listener')) {
      return NextResponse.json(
        {
          error: 'WhatsApp listener not active',
          details: 'Run: openclaw channels login --channel whatsapp --account default',
          solution: 'Restart the OpenClaw gateway or reconnect WhatsApp'
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to send WhatsApp message',
        details: error.message,
        stderr: error.stderr
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check WhatsApp configuration status
export async function GET() {
  try {
    // Check OpenClaw WhatsApp status using doctor command
    const { stdout } = await execAsync('openclaw doctor 2>&1 | grep -A 2 "WhatsApp:"');

    const isLinked = stdout.includes('linked');
    const hasPhone = stdout.match(/\+\d{12,15}/);

    return NextResponse.json({
      configured: isLinked,
      status: isLinked ? 'connected' : 'disconnected',
      phone: hasPhone ? hasPhone[0] : null,
      message: isLinked
        ? `WhatsApp is connected via OpenClaw (${hasPhone?.[0] || 'phone detected'})`
        : 'WhatsApp is not connected. Run: openclaw channels login --channel whatsapp',
      method: 'OpenClaw CLI'
    });

  } catch (error: any) {
    return NextResponse.json({
      configured: false,
      error: 'Failed to check WhatsApp status',
      details: error.message,
      message: 'Could not determine WhatsApp connection status'
    });
  }
}
