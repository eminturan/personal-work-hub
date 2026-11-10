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
  /** PR'ın reviewer'ları ve oyları; açan kişi kimde beklediğini buradan görür. */
  reviewers: { name: string; vote: number; required: boolean }[];
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

/** Onay bekleyen bir release aşaması. */
export interface Approval {
  id: number;
  /** Release tanımının adı. */
  name: string;
  /** Release adı, örn. Release-58. */
  release: string;
  project: string;
  stage: string;
  /** preDeploy | postDeploy */
  type: string;
  /** Onayın atandığı kişi ya da grup. */
  approver: string;
  time?: string;
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
  approvals: Section<Approval>;
}

export type SectionKey = keyof MyWorkData;

/** Kişi seçicide bulunan kullanıcı. */
export interface Person {
  /** Kimlik id'si; PR, build ve release sorgularında kullanılır. */
  id: string;
  name: string;
  /** DOMAIN\\hesap; yoksa boş. */
  account: string;
}

export interface LoadOptions {
  /** Başkasının işlerine bakılıyorsa o kişi; verilmezse oturum açan kullanıcı. */
  person?: Person;
  /** Kapalı/tamamlanmış work item'ları da getir. */
  includeClosed: boolean;
  /** Tamamlanmış (complete edilmiş) PR'ları da getir. */
  includeCompletedPrs: boolean;
  /** Tarih aralığı, YYYY-AA-GG (tarih alanının değeri); boş uç sınırsızdır. İki uç da dahildir. */
  from: string;
  to: string;
}

export interface DataSource {
  /** Sunucudan ne okunabildiğinin özeti; sorun giderme için sayfanın altında gösterilir. */
  diagnostics?(): Record<string, unknown>;
  load(options: LoadOptions): Promise<MyWorkData>;
  /** Yalnızca iki work item listesini yeniden okur; tarih ya da kapalı seçeneği değişince kullanılır. */
  loadWorkItems(options: LoadOptions): Promise<Pick<MyWorkData, "assigned" | "created">>;
  /** Ada ya da hesap adına göre kullanıcı arar. */
  searchPeople(query: string): Promise<Person[]>;
}

// --- Sunucunun döndürdüğü ham biçimler (yalnızca kullanılan alanlar) ---

export interface RawIdentityRef {
  id?: string;
  displayName?: string;
  isContainer?: boolean;
  isRequired?: boolean;
  vote?: number;
}

/** `_apis/identities` yanıtındaki kimlik. */
export interface RawIdentity {
  id?: string;
  providerDisplayName?: string;
  customDisplayName?: string;
  isContainer?: boolean;
  isActive?: boolean;
  properties?: Record<string, { $value?: unknown } | undefined>;
}

/** Azure DevOps kişi seçicisinin (IdentityPicker) döndürdüğü kimlik. */
export interface RawPickerIdentity {
  entityType?: string;
  /** Collection'daki kimlik id'si; kişi collection'a hiç girmediyse boştur. */
  localId?: string | null;
  displayName?: string | null;
  /** Domain adı. */
  scopeName?: string | null;
  samAccountName?: string | null;
  signInAddress?: string | null;
  mail?: string | null;
  active?: boolean | null;
}

/** Ada, hesap adına ya da e-postaya göre önekle arama yapan kaynak. */
export type PeopleSearch = (query: string) => Promise<RawPickerIdentity[]>;

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

export interface RawApproval {
  id: number;
  approvalType?: string;
  createdOn?: string;
  approver?: RawIdentityRef;
  release?: { id?: number; name?: string; _links?: { web?: { href?: string } } };
  releaseDefinition?: { name?: string };
  releaseEnvironment?: { name?: string };
  /** Proje proje sorulduğunda eklenen proje adı; yanıtta proje bilgisi yoktur. */
  __project?: string;
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
