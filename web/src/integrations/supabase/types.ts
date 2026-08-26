// Tipos do banco do ZapWallet. Reflete supabase/migrations/0001_schema.sql.
// Em produção, regenere com: supabase gen types typescript --project-id <ref>
//
// IMPORTANTE: os Row são `type` (não `interface`) de propósito — apenas type
// aliases de objeto são atribuíveis a Record<string, unknown>, requisito do
// supabase-js para inferir Row/Insert/Update (senão tudo vira `never`).

export type TxType = "expense" | "income";

export type Profile = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  premium_until: string | null;
  plan: string | null;
  is_admin: boolean;
  ai_online: boolean;
  messages_this_month: number;
  message_limit: number;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type Transaction = {
  id: string;
  user_id: string;
  type: TxType;
  amount: number;
  title: string | null;
  category: string | null;
  description: string | null;
  location: string | null;
  occurred_on: string;
  occurred_at: string | null;
  source: "whatsapp" | "panel" | "recurring";
  recurring_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export type RecurringTransaction = {
  id: string;
  user_id: string;
  type: TxType;
  title: string;
  description: string | null;
  amount: number;
  category: string | null;
  location: string | null;
  frequency: Frequency;
  day_of_month: number | null;
  day_of_week: number | null;
  month_of_year: number | null;
  active: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  user_id: string | null;
  name: string;
  type: "expense" | "income" | "both";
  emoji: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type Goal = {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  deadline: string | null;
  status: "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
};

export type SpendingLimit = {
  id: string;
  user_id: string;
  category: string;
  period: "monthly" | "weekly";
  limit_amount: number;
  created_at: string;
  updated_at: string;
};

export type Plan = {
  id: string;
  name: string;
  price: number;
  duration_days: number;
  message_limit: number;
  cakto_offer_id: string | null;
  active: boolean;
  created_at: string;
};

export type MessageRow = {
  id: string;
  user_id: string | null;
  chat: string;
  message: string;
  is_outgoing: boolean;
  ai_generated: boolean;
  created_at: string;
};

// Cada tabela conforma com o GenericTable do supabase-js (Row/Insert/Update/Relationships).
type Table<T> = { Row: T; Insert: Partial<T>; Update: Partial<T>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      transactions: Table<Transaction>;
      categories: Table<Category>;
      goals: Table<Goal>;
      spending_limits: Table<SpendingLimit>;
      recurring_transactions: Table<RecurringTransaction>;
      plans: Table<Plan>;
      messages: Table<MessageRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
