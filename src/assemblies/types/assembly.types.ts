export interface QuestionStats {
  totalVoted: number;
  totalPending: number;
  yesCount: number;
  noCount: number;
  blankCount: number;
}

export interface QuestionPayload {
  id: string;
  assemblyId: string;
  text: string;
  order: number;
  status: 'pending' | 'active' | 'closed';
  activatedAt: string | null;
  closedAt: string | null;
  stats: QuestionStats;
}

export interface AssemblyPayload {
  id: string;
  publicId: string;
  title: string;
  description: string | null;
  scheduledDate: string;
  status: 'draft' | 'active' | 'finished';
  startedAt: string | null;
  finishedAt: string | null;
  createdByEmployeeId: string;
  questions: QuestionPayload[];
  createdAt: string;
}

export interface VoteStatsPayload {
  assemblyId: string;
  questionId: string;
  totalVoted: number;
  totalPending: number;
  yesCount: number;
  noCount: number;
  blankCount: number;
}

export interface PublicStatsPayload {
  assemblyId: string;
  title: string;
  description: string | null;
  status: 'draft' | 'active' | 'finished';
  scheduledDate: string;
  questions: (QuestionPayload & { stats: QuestionStats })[];
}

export interface VoteSyncResult {
  questionId: string;
  accepted: boolean;
  reason?: string;
}
