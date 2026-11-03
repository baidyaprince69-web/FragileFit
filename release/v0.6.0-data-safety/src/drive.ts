/**
 * Google Drive backup integration boundary for FragileFit.
 * This release prepares the contract only: it does not authenticate, request
 * consent, read Drive files, or upload data.
 */
export const GOOGLE_DRIVE_BACKUP_FOLDER_NAME = 'FragileFit Backups';
export const GOOGLE_DRIVE_BACKUP_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleDrivePreparationStatus {
  configured: boolean;
  connected: boolean;
  message: string;
}

export function getGoogleDrivePreparationStatus(): GoogleDrivePreparationStatus {
  return {
    configured: false,
    connected: false,
    message: 'Google OAuth client configuration has not been added.'
  };
}
