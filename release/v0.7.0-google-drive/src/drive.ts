import { decryptBackupText, encryptBackupText } from './security.js';
import type { AppData } from './types.js';
import { GOOGLE_OAUTH_CLIENT_ID } from './google-config.js';

export const GOOGLE_DRIVE_BACKUP_FOLDER_NAME = 'FragileFit Backups';
export const GOOGLE_DRIVE_BACKUP_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_BACKUP_FORMAT = 'FRAGILEFIT-GOOGLE-DRIVE-BACKUP';
const DRIVE_BACKUP_VERSION = 1;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};
type GoogleTokenClient = { requestAccessToken(options?: { prompt?: string }): void };
type GoogleDriveFile = {
  id: string; name: string; mimeType?: string; createdTime?: string;
  modifiedTime?: string; size?: string;
};
type GoogleDriveList = { files?: GoogleDriveFile[]; nextPageToken?: string };
type GoogleIdentity = {
  accounts?: {
    oauth2?: {
      initTokenClient(config: {
        client_id: string; scope: string; include_granted_scopes: boolean;
        callback(response: GoogleTokenResponse): void;
        error_callback?(error: { type?: string; message?: string }): void;
      }): GoogleTokenClient;
      revoke?(token: string, callback?: () => void): void;
    };
  };
};
declare global { interface Window { google?: GoogleIdentity; } }

export interface GoogleDrivePreparationStatus {
  configured: boolean; connected: boolean; libraryReady: boolean; message: string;
}
export interface DriveBackupMetadata { id: string; name: string; createdTime: string; size?: string; }

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let gisLoadPromise: Promise<void> | null = null;

function identityApi() {
  return typeof window !== 'undefined' ? window.google?.accounts?.oauth2 : undefined;
}

export function getGoogleDrivePreparationStatus(): GoogleDrivePreparationStatus {
  const configured = Boolean(GOOGLE_OAUTH_CLIENT_ID.trim());
  const connected = Boolean(accessToken && accessTokenExpiresAt > Date.now() + 5000);
  const libraryReady = Boolean(identityApi());
  return {
    configured, connected, libraryReady,
    message: !configured ? 'Google OAuth client ID is not configured.'
      : !libraryReady ? 'Google authorization library is not ready.'
      : connected ? 'Connected for this browser session.'
      : 'Not connected. Authorize your Google account to continue.'
  };
}

/** Load Google's maintained authorization library directly from Google. */
export function preloadGoogleIdentityServices(): Promise<void> {
  if (!GOOGLE_OAUTH_CLIENT_ID.trim()) return Promise.resolve();
  if (identityApi()) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  if (typeof document === 'undefined') return Promise.reject(new Error('Google authorization is available only in a browser.'));
  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-fragilefit-google-identity]');
    const script = existing ?? document.createElement('script');
    const loaded = (): void => identityApi()
      ? resolve()
      : reject(new Error('Google authorization library loaded but its API was unavailable.'));
    const failed = (): void => reject(new Error('Could not load Google authorization. Check your internet connection and try again.'));
    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.fragilefitGoogleIdentity = 'true';
      document.head.append(script);
    } else if (identityApi()) resolve();
  }).catch(error => {
    gisLoadPromise = null;
    throw error;
  });
  return gisLoadPromise;
}

/**
 * Call from a user click after GIS is loaded. Tokens are memory-only and short-lived;
 * the browser-only token flow intentionally does not save refresh tokens.
 */
export function connectGoogleDrive(): Promise<void> {
  if (!GOOGLE_OAUTH_CLIENT_ID.trim()) {
    return Promise.reject(new Error('Google Drive is not enabled yet. The site owner must add the public OAuth client ID to src/google-config.ts first.'));
  }
  const oauth = identityApi();
  if (!oauth) return Promise.reject(new Error('Google authorization is still loading. Reload after it finishes, then try Connect again.'));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve();
    };
    try {
      const client = oauth.initTokenClient({
        client_id: GOOGLE_OAUTH_CLIENT_ID.trim(),
        scope: GOOGLE_DRIVE_BACKUP_SCOPE,
        include_granted_scopes: true,
        callback: (response: GoogleTokenResponse) => {
          if (response.error || !response.access_token) {
            accessToken = null; accessTokenExpiresAt = 0;
            finish(new Error(response.error_description || response.error || 'Google did not return an access token.'));
            return;
          }
          accessToken = response.access_token;
          accessTokenExpiresAt = Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000;
          finish();
        },
        error_callback: error => finish(new Error(error.message || 'Google authorization popup could not be completed.'))
      });
      client.requestAccessToken({ prompt: 'consent' });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function disconnectGoogleDrive(): Promise<void> {
  const token = accessToken;
  accessToken = null; accessTokenExpiresAt = 0;
  const revoke = identityApi()?.revoke;
  if (!token || !revoke) return;
  await new Promise<void>(resolve => {
    try { revoke(token, resolve); } catch { resolve(); }
  });
}

function requireAccessToken(): string {
  if (!accessToken || accessTokenExpiresAt <= Date.now() + 5000) {
    accessToken = null; accessTokenExpiresAt = 0;
    throw new Error('Your Google Drive session has expired. Connect Google Drive again and retry.');
  }
  return accessToken;
}

async function driveRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = requireAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer ' + token);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    if (response.status === 401) { accessToken = null; accessTokenExpiresAt = 0; }
    let reason = '';
    try {
      const body = await response.json() as { error?: { message?: string } };
      reason = body.error?.message ?? '';
    } catch { /* Ignore non-JSON error bodies. */ }
    if (response.status === 401) throw new Error('Google Drive authorization expired or was revoked. Connect again and retry.');
    throw new Error('Google Drive request failed (' + response.status + ')' + (reason ? ': ' + reason : '') + '.');
  }
  return await response.json() as T;
}

async function findOrCreateBackupFolder(): Promise<string> {
  const query = new URLSearchParams({
    q: "name = '" + GOOGLE_DRIVE_BACKUP_FOLDER_NAME + "' and mimeType = '" + FOLDER_MIME + "' and trashed = false",
    pageSize: '50', orderBy: 'createdTime', fields: 'files(id,name,mimeType,createdTime)'
  });
  const found = await driveRequest<GoogleDriveList>(DRIVE_API + '/files?' + query.toString());
  const existing = found.files?.find(file => file.mimeType === FOLDER_MIME);
  if (existing?.id) return existing.id;
  const created = await driveRequest<GoogleDriveFile>(DRIVE_API + '/files?fields=id,name,mimeType', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: GOOGLE_DRIVE_BACKUP_FOLDER_NAME,
      mimeType: FOLDER_MIME,
      appProperties: { fragilefitFolder: 'true', app: 'FragileFit' }
    })
  });
  if (!created.id) throw new Error('Google Drive created the folder but did not return its ID.');
  return created.id;
}

function validateAppData(data: unknown): asserts data is AppData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('This Google Drive backup does not contain a valid FragileFit workspace.');
  }
  const record = data as Record<string, unknown>;
  for (const key of ['products', 'packaging', 'orders', 'shipments', 'couriers']) {
    if (!Array.isArray(record[key])) throw new Error('This backup is incomplete: ' + key + ' records are missing.');
  }
  if (!record.settings || typeof record.settings !== 'object' || Array.isArray(record.settings)) {
    throw new Error('This backup is incomplete: workspace settings are missing.');
  }
}

export async function createDriveEncryptedBackupText(data: AppData, password: string): Promise<string> {
  validateAppData(data);
  const payload = JSON.stringify({
    format: DRIVE_BACKUP_FORMAT, version: DRIVE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(), data
  });
  return await encryptBackupText(payload, password);
}

export async function parseDriveEncryptedBackupText(encryptedText: string, password: string): Promise<AppData> {
  const plaintext = await decryptBackupText(encryptedText, password);
  let decoded: unknown;
  try { decoded = JSON.parse(plaintext); }
  catch { throw new Error('The decrypted Drive backup is not valid JSON.'); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('This is not a valid FragileFit Google Drive backup.');
  }
  const payload = decoded as Record<string, unknown>;
  if (payload.format !== DRIVE_BACKUP_FORMAT || payload.version !== DRIVE_BACKUP_VERSION) {
    throw new Error('This file is not a supported FragileFit Google Drive backup.');
  }
  validateAppData(payload.data);
  return payload.data;
}

export async function uploadEncryptedDriveBackup(data: AppData, password: string): Promise<DriveBackupMetadata> {
  const encryptedText = await createDriveEncryptedBackupText(data, password);
  const folderId = await findOrCreateBackupFolder();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const unique = crypto.randomUUID().slice(0, 8);
  const name = 'FragileFit-Backup-' + stamp + '-' + unique + '.fragilefit.enc';
  const metadata = {
    name, mimeType: 'application/octet-stream', parents: [folderId],
    appProperties: { fragilefitBackup: 'true', backupVersion: String(DRIVE_BACKUP_VERSION) }
  };
  const boundary = 'fragilefit_' + crypto.randomUUID().replace(/-/g, '');
  const body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n',
    encryptedText,
    '\r\n--' + boundary + '--'
  ], { type: 'multipart/related; boundary=' + boundary });
  const url = DRIVE_UPLOAD_API + '/files?uploadType=multipart&fields=id,name,createdTime,size';
  const created = await driveRequest<GoogleDriveFile>(url, {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
  });
  if (!created.id || !created.name) throw new Error('Google Drive upload did not return a backup file ID.');
  return { id: created.id, name: created.name, createdTime: created.createdTime || new Date().toISOString(), size: created.size };
}

export async function listEncryptedDriveBackups(): Promise<DriveBackupMetadata[]> {
  const folderId = await findOrCreateBackupFolder();
  const files: GoogleDriveFile[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      q: "'" + folderId + "' in parents and trashed = false",
      pageSize: '100', orderBy: 'createdTime desc',
      fields: 'nextPageToken,files(id,name,mimeType,createdTime,size)'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveRequest<GoogleDriveList>(DRIVE_API + '/files?' + params.toString());
    files.push(...(response.files ?? []));
    pageToken = response.nextPageToken;
    pages++;
  } while (pageToken && pages < 5);
  return files
    .filter(file => file.id && file.name?.startsWith('FragileFit-Backup-') && file.name.endsWith('.fragilefit.enc'))
    .map(file => ({ id: file.id, name: file.name, createdTime: file.createdTime || '', size: file.size }))
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
}

export async function downloadEncryptedDriveBackup(fileId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) throw new Error('The selected Google Drive file ID is invalid.');
  const token = requireAccessToken();
  const response = await fetch(DRIVE_API + '/files/' + encodeURIComponent(fileId) + '?alt=media', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/octet-stream' }
  });
  if (!response.ok) {
    if (response.status === 401) { accessToken = null; accessTokenExpiresAt = 0; }
    if (response.status === 401) throw new Error('Google Drive authorization expired or was revoked. Connect again and retry.');
    throw new Error('Could not download the selected Google Drive backup (HTTP ' + response.status + ').');
  }
  const encryptedText = await response.text();
  if (!encryptedText || encryptedText.length < 50) throw new Error('The selected Google Drive backup is empty or incomplete.');
  return encryptedText;
}
