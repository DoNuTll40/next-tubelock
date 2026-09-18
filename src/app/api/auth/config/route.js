import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    clientId: process.env.AZURE_CLIENT_ID || 'e7b7cf60-63af-4151-b44c-3472c5268c11',
    tenantId: process.env.AZURE_TENANT_ID || 'organizations',
  });
}
