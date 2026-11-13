import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function required(name) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
}

async function download() {
    const parts = required('SOURCE_FILE').split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part))) {
        throw new Error('Enter a filename or a path relative to OneDrive My files.');
    }
    const tenant = encodeURIComponent(required('AZURE_TENANT_ID'));
    const user = encodeURIComponent(required('ONEDRIVE_USER_ID'));
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: 'POST',
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: required('AZURE_CLIENT_ID'),
            client_secret: required('AZURE_CLIENT_SECRET'),
            scope: 'https://graph.microsoft.com/.default',
        }),
    });
    if (!tokenResponse.ok) throw new Error(`Microsoft sign-in failed (HTTP ${tokenResponse.status}).`);
    const { access_token: token } = await tokenResponse.json();
    const path = parts.map(encodeURIComponent).join('/');
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${user}/drive/root:/${path}:/content`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404) throw new Error('File not found. Check the exact filename and folder in OneDrive My files.');
    if (!response.ok || !response.body) throw new Error(`OneDrive download failed (HTTP ${response.status}).`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(process.argv[2], { flags: 'wx' }));
}

try {
    await download();
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
