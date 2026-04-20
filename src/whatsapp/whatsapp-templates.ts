import { CATEGORIES } from '../shared/categories';

export type TwilioTemplateType = 'twilio/quick-reply' | 'twilio/list-picker';

export interface TemplateAction { id: string; title: string; }
export interface TemplateItem   { id: string; item: string; description?: string; }

export interface TwilioTemplateDef {
  friendlyName: string;
  type: TwilioTemplateType;
  body: string;
  button?: string;                 // list-picker only
  actions?: TemplateAction[];      // quick-reply only
  items?: TemplateItem[];          // list-picker only
}

export type MenuType = 'MAIN_MENU' | 'METHOD_MENU' | 'CATEGORY_MENU' | 'CONFIRM_MENU' | 'EDIT_MENU';

export const WHATSAPP_TEMPLATES: Record<MenuType, TwilioTemplateDef> = {
  MAIN_MENU: {
    friendlyName: 'expense_bot_main_menu_v1',
    type: 'twilio/quick-reply',
    body: '{{1}}',
    actions: [
      { id: 'cmd_gasto',  title: 'Registrar gasto' },
      { id: 'cmd_gastos', title: 'Gastos recientes' },
      { id: 'cmd_mes',    title: 'Resumen del mes' },
    ],
  },
  METHOD_MENU: {
    friendlyName: 'expense_bot_method_menu_v1',
    type: 'twilio/list-picker',
    body: '{{1}}',
    button: 'Elegir método',
    items: [
      { id: 'method_receipt', item: '📸 Foto del recibo' },
      { id: 'method_dictate', item: '🎙️ Dictar por voz' },
      { id: 'method_manual',  item: '✍️ Escribir manual' },
      { id: 'back_menu',      item: '⬅️ Volver al menú' },
    ],
  },
  CATEGORY_MENU: {
    friendlyName: 'expense_bot_category_menu_v1',
    type: 'twilio/list-picker',
    body: '{{1}}',
    button: 'Ver categorías',
    items: CATEGORIES.map((c) => ({ id: `cat_${c.value}`, item: c.label })),
  },
  CONFIRM_MENU: {
    friendlyName: 'expense_bot_confirm_menu_v1',
    type: 'twilio/quick-reply',
    body: '{{1}}',
    actions: [
      { id: 'confirm_yes', title: '✅ Confirmar' },
      { id: 'confirm_no',  title: '❌ Cancelar' },
      { id: 'edit_menu',   title: '✏️ Editar' },
    ],
  },
  EDIT_MENU: {
    friendlyName: 'expense_bot_edit_menu_v1',
    type: 'twilio/list-picker',
    body: '{{1}}',
    button: 'Elegir campo',
    items: [
      { id: 'edit_amount',      item: '💵 Monto' },
      { id: 'edit_provider',    item: '🏪 Proveedor' },
      { id: 'edit_category',    item: '🏷️ Categoría' },
      { id: 'edit_description', item: '📝 Descripción' },
    ],
  },
};
