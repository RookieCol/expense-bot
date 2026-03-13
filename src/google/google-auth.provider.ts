import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, Auth } from 'googleapis';

export const GOOGLE_AUTH = 'GOOGLE_AUTH';
export type GoogleAuthClient = Auth.GoogleAuth;

export const GoogleAuthProvider: Provider<GoogleAuthClient> = {
  provide: GOOGLE_AUTH,
  useFactory: (config: ConfigService): GoogleAuthClient => {
    const clientEmail = config.get<string>('GOOGLE_CLIENT_EMAIL');
    const privateKey = config.get<string>('GOOGLE_PRIVATE_KEY')?.replace(
      /\\n/g,
      '\n',
    );

    return new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
  },
  inject: [ConfigService],
};
