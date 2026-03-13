import { ConversationState } from './conversation-state.enum';
import { Expense } from '../shared/interfaces/expense.interface';

export interface ConversationContext {
  state: ConversationState;
  pendingExpense: Partial<Expense>;
  lastImageBuffer?: Buffer;
  editingField?: string;
}
