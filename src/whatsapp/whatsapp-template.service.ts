import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import {
  WHATSAPP_TEMPLATES,
  MenuType,
  TwilioTemplateDef,
} from './whatsapp-templates';

@Injectable()
export class WhatsAppTemplateService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppTemplateService.name);
  private readonly sids = new Map<MenuType, string>();
  private client!: ReturnType<typeof Twilio>;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (!accountSid || !authToken) {
      this.logger.warn(
        'Twilio credentials missing — skipping template registration',
      );
      return;
    }
    this.client = Twilio(accountSid, authToken);

    try {
      const existing = await this.fetchExisting();
      for (const [menuType, def] of Object.entries(WHATSAPP_TEMPLATES) as [
        MenuType,
        TwilioTemplateDef,
      ][]) {
        const existingSid = existing.get(def.friendlyName);
        if (existingSid) {
          this.sids.set(menuType, existingSid);
          this.logger.log(`Template ${menuType} reused: ${existingSid}`);
        } else {
          const sid = await this.create(def);
          this.sids.set(menuType, sid);
          this.logger.log(`Template ${menuType} created: ${sid}`);
        }
      }
    } catch (err) {
      this.logger.error('Failed to register WhatsApp templates', err);
    }
  }

  getSid(menuType: MenuType): string | undefined {
    return this.sids.get(menuType);
  }

  private async fetchExisting(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const list = await this.client.content.v1.contents.list({ limit: 200 });
    for (const c of list) {
      if (c.friendlyName && c.sid) map.set(c.friendlyName, c.sid);
    }
    return map;
  }

  private async create(def: TwilioTemplateDef): Promise<string> {
    const types: Record<string, unknown> = {};
    if (def.type === 'twilio/quick-reply') {
      types['twilio/quick-reply'] = {
        body: def.body,
        actions: def.actions,
      };
    } else {
      types['twilio/list-picker'] = {
        body: def.body,
        button: def.button,
        items: def.items,
      };
    }
    const created = await (
      this.client.content.v1.contents.create as unknown as (
        params: Record<string, unknown>,
      ) => Promise<{ sid: string }>
    )({
      friendlyName: def.friendlyName,
      language: 'es',
      types,
    });
    return created.sid;
  }
}
