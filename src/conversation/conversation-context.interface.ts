import { ConversationState } from './conversation-state.enum';
import { Expense } from '../shared/interfaces/expense.interface';

export interface ConversationContext {
  state: ConversationState;
  pendingExpense: Partial<Expense>;
  lastImageBuffer?: Buffer;
  editingField?: string;
  userName?: string;
  lastBotMessageId?: string;
  editStepMessageId?: string;
  manualStepIds: string[];
  userMessageIds: string[];
  pendingMenuOptions?: string[];
  /**
   * Rolling transcript of the last N turns used by ConversationAgent
   * to keep multi-turn context. Trimmed to a bounded size before each
   * flush so the Redis blob stays small.
   */
  history?: ConversationTurn[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}
