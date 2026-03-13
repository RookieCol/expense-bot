import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

export const GOOGLE_AUTH = 'GOOGLE_AUTH';

export const GoogleAuthProvider = {
  provide: GOOGLE_AUTH,
  useFactory: (config: ConfigService) =>
    new google.auth.GoogleAuth({
      credentials: {
        client_email: config.get<string>('GOOGLE_CLIENT_EMAIL'),
        private_key: config
          .get<string>('GOOGLE_PRIVATE_KEY')
          ?.replace(/\\n/g, '\n'),
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    }),
  inject: [ConfigService],
};
