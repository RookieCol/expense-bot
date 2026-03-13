import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3, Auth } from 'googleapis';
import { Readable } from 'stream';
import { GOOGLE_AUTH } from './google-auth.provider';

@Injectable()
export class DriveService implements OnModuleInit {
  private readonly logger = new Logger(DriveService.name);
  private drive: drive_v3.Drive;
  private readonly folderId: string | undefined;

  constructor(
    @Inject(GOOGLE_AUTH) private readonly auth: Auth.GoogleAuth,
    private readonly config: ConfigService,
  ) {
    this.folderId = this.config.get<string>('GOOGLE_DRIVE_FOLDER_ID');
  }

  async onModuleInit() {
    this.drive = google.drive({ version: 'v3', auth: this.auth });
  }

  async uploadImage(buffer: Buffer, filename: string): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: {
        name: filename,
        parents: this.folderId ? [this.folderId] : [],
      },
      media: { mimeType: 'image/jpeg', body: Readable.from(buffer) },
      fields: 'id, webViewLink',
    });
    await this.drive.permissions.create({
      fileId: res.data.id!,
      requestBody: { role: 'reader', type: 'anyone' },
    });
    return (
      res.data.webViewLink ||
      `https://drive.google.com/file/d/${res.data.id}/view`
    );
  }
}
