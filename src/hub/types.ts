export interface WorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  project: string;
  assignedTo?: string;
  createdBy?: string;
  changedDate?: string;
  url?: string;
}

export interface PullRequest {
  id: number;
  title: string;
  project: string;
  repo: string;
  creator: string;
  createdDate?: string;
  sourceBranch: string;
  targetBranch: string;
  isDraft: boolean;
  /** active | completed */
  status: string;
  /** Kullanıcının kendi oyu; hiç oy vermediyse 0. */
  myVote: number;
  /** Üyesi olduğum reviewer grubunun oyu (grup adına başka bir üye oy verdiyse); yoksa 0. */
  groupVote: number;
  /** Kullanıcının üyesi olduğu ve bu PR'a reviewer atanmış grup/takım adları. Doğrudan atandıysa boş. */
  via: string[];
  /** Kullanıcı reviewer listesinde bizzat var mı. */
  direct: boolean;
  url?: string;
}

export type RunTone = "ok" | "failed" | "warning" | "running" | "neutral";

export interface Run {
  id: number;
  /** Pipeline / release tanımının adı. */
  name: string;
  /** Build numarası ya da release adı. */
  number: string;
  project: string;
  /** Sunucunun döndürdüğü ham durum: build için result ?? status, release için status. */
  status: string;
  tone: RunTone;
  branch?: string;
  time?: string;
  /** Release aşamaları. */
  stages?: { name: string; status: string; tone: RunTone }[];
  url?: string;
}

export interface Section<T> {
  items: T[];
  /** Bölüm okunamadıysa hata metni; diğer bölümler etkilenmez. */
  error?: string;
  /** Sunucu sınırına takıldı, liste eksik olabilir. */
  truncated?: boolean;
}

export interface MyWorkData {
  assigned: Section<WorkItem>;
  created: Section<WorkItem>;
  myPrs: Section<PullRequest>;
  reviewPrs: Section<PullRequest>;
  builds: Section<Run>;
  releases: Section<Run>;
}

export type SectionKey = keyof MyWorkData;

export interface LoadOptions {
  /** Kapalı/tamamlanmış work item'ları da getir. */
  includeClosed: boolean;
  /** Tamamlanmış (complete edilmiş) PR'ları da getir. */
  includeCompletedPrs: boolean;
}

export interface DataSource {
  /** Sunucudan ne okunabildiğinin özeti; sorun giderme için sayfanın altında gösterilir. */
  diagnostics?(): Record<string, unknown>;
  load(options: LoadOptions): Promise<MyWorkData>;
}

// --- Sunucunun döndürdüğü ham biçimler (yalnızca kullanılan alanlar) ---

export interface RawIdentityRef {
  id?: string;
  displayName?: string;
  isContainer?: boolean;
  vote?: number;
}

export interface RawPullRequest {
  pullRequestId: number;
  title?: string;
  createdBy?: RawIdentityRef;
  creationDate?: string;
  sourceRefName?: string;
  targetRefName?: string;
  isDraft?: boolean;
  status?: string;
  closedDate?: string;
  repository?: { name?: string; project?: { name?: string } };
  reviewers?: RawIdentityRef[];
}

export interface RawWorkItem {
  id: number;
  fields?: Record<string, unknown>;
}

export interface RawBuild {
  id: number;
  buildNumber?: string;
  status?: string;
  result?: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  sourceBranch?: string;
  definition?: { name?: string };
  project?: { name?: string };
  _links?: { web?: { href?: string } };
}

export interface RawRelease {
  id: number;
  name?: string;
  status?: string;
  createdOn?: string;
  releaseDefinition?: { name?: string };
  projectReference?: { name?: string };
  environments?: { name?: string; status?: string }[];
  _links?: { web?: { href?: string } };
}
