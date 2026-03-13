import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';

@Injectable()
export class DriveService implements OnModuleInit {
  private readonly logger = new Logger(DriveService.name);
  private drive: drive_v3.Drive;
  private readonly folderId: string | undefined;

  constructor(private config: ConfigService) {
    this.folderId = this.config.get<string>('GOOGLE_DRIVE_FOLDER_ID');
  }

  async onModuleInit() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: this.config.get<string>('GOOGLE_CLIENT_EMAIL'),
        private_key: this.config
          .get<string>('GOOGLE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    this.drive = google.drive({ version: 'v3', auth });
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
