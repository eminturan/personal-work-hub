import { AgoUnits } from "./logic";
import { SectionKey } from "./types";

export type Lang = "tr" | "en";

/** Azure DevOps kullanıcı dili (örn. "tr-TR") → desteklenen dil. Türkçe dışındaki her dil İngilizce görür. */
export function pickLang(culture: string | undefined | null): Lang {
  return (culture ?? "").toLowerCase().startsWith("tr") ? "tr" : "en";
}

/**
 * Dil kaynaklarını sırayla dener; hata fırlatanı ya da boş döneni atlar.
 * Azure DevOps Server 2022'de SDK.getPageContext() hata fırlattığı için gerekir.
 */
export function firstCulture(sources: Array<() => string | undefined | null>): string | undefined {
  for (const read of sources) {
    try {
      const value = read();
      if (value) return value;
    } catch {
      // bu kaynak kullanılamıyor, sıradakine geç
    }
  }
  return undefined;
}

export interface Strings {
  locale: string;
  units: AgoUnits;
  title: string;
  lastUpdated: (time: string) => string;
  demoData: string;
  refresh: string;
  refreshing: string;
  loading: string;
  loadError: (detail: string) => string;
  sectionError: (detail: string) => string;
  truncated: string;
  empty: string;
  noMatches: string;
  search: string;
  includeClosed: string;
  includeCompletedPrs: string;
  completed: string;
  groups: { workItems: string; prs: string; pipelines: string };
  tabs: Record<SectionKey, string>;
  col: {
    id: string;
    title: string;
    type: string;
    state: string;
    project: string;
    assignedTo: string;
    createdBy: string;
    changed: string;
    repo: string;
    branches: string;
    myVote: string;
    assignedVia: string;
    created: string;
    pipeline: string;
    run: string;
    branch: string;
    status: string;
    stages: string;
    when: string;
  };
  draft: string;
  direct: string;
  unassigned: string;
  votes: Record<string, string>;
  /** Ben oy vermedim ama üyesi olduğum grup adına başka biri oy verdi. */
  groupVotes: Record<string, string>;
  all: string;
  clearFilters: string;
  /** Sunucunun döndürdüğü durum adı (küçük harf) → görünen metin; yoksa ham ad gösterilir. */
  status: Record<string, string>;
  diagnostics: string;
}

const tr: Strings = {
  locale: "tr-TR",
  units: { now: "az önce", m: "dk önce", h: "sa önce", d: "g önce" },
  title: "İşlerim",
  lastUpdated: (time) => `Son güncelleme ${time}`,
  demoData: "Örnek veri gösteriliyor (Azure DevOps dışında açıldı).",
  refresh: "Yenile",
  refreshing: "Yenileniyor…",
  loading: "Yükleniyor…",
  loadError: (d) => `Veriler okunamadı (${d}).`,
  sectionError: (d) => `Bu liste okunamadı (${d}).`,
  truncated: "Liste sunucu sınırına ulaştı; daha eski kayıtlar gösterilmiyor olabilir.",
  empty: "Burada gösterilecek bir şey yok.",
  noMatches: "Aramayla eşleşen kayıt yok.",
  search: "Ara: başlık, proje, durum…",
  includeClosed: "Tamamlandı, Closed ve İptal olanları da göster",
  includeCompletedPrs: "Tamamlanan PR'ları da göster",
  completed: "Tamamlandı",
  groups: { workItems: "Work Item'lar", prs: "Pull Request'ler", pipelines: "Pipeline'lar" },
  tabs: {
    assigned: "Bana atananlar",
    created: "Açtıklarım",
    myPrs: "Açtıklarım",
    reviewPrs: "Review'ına atandıklarım",
    builds: "Build",
    releases: "Release",
  },
  col: {
    id: "ID",
    title: "Başlık",
    type: "Tür",
    state: "Durum",
    project: "Proje",
    assignedTo: "Atanan",
    createdBy: "Açan",
    changed: "Değişiklik",
    repo: "Repo",
    branches: "Dallar",
    myVote: "Oyum",
    assignedVia: "Atama",
    created: "Açılış",
    pipeline: "Pipeline",
    run: "Çalıştırma",
    branch: "Dal",
    status: "Durum",
    stages: "Aşamalar",
    when: "Zaman",
  },
  draft: "Taslak",
  direct: "Doğrudan",
  unassigned: "Atanmamış",
  votes: {
    "10": "Onayladım",
    "5": "Önerilerle onayladım",
    "0": "Oy vermedim",
    "-5": "Yazarı bekliyorum",
    "-10": "Reddettim",
  },
  groupVotes: {
    "10": "Grup onayladı",
    "5": "Grup önerilerle onayladı",
    "-5": "Grup yazarı bekliyor",
    "-10": "Grup reddetti",
  },
  all: "Tümü",
  clearFilters: "Filtreleri temizle",
  status: {
    succeeded: "Başarılı",
    failed: "Başarısız",
    partiallysucceeded: "Kısmen başarılı",
    canceled: "İptal edildi",
    cancelling: "İptal ediliyor",
    inprogress: "Çalışıyor",
    notstarted: "Başlamadı",
    queued: "Sırada",
    postponed: "Ertelendi",
    rejected: "Reddedildi",
    active: "Etkin",
    abandoned: "Bırakıldı",
    draft: "Taslak",
    scheduled: "Zamanlandı",
    completed: "Tamamlandı",
  },
  diagnostics: "Tanılama bilgisi",
};

const en: Strings = {
  locale: "en-US",
  units: { now: "just now", m: "min ago", h: "h ago", d: "d ago" },
  title: "My Work",
  lastUpdated: (time) => `Last updated ${time}`,
  demoData: "Showing sample data (opened outside Azure DevOps).",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  loading: "Loading…",
  loadError: (d) => `Could not load data (${d}).`,
  sectionError: (d) => `Could not load this list (${d}).`,
  truncated: "The list hit the server limit; older entries may be missing.",
  empty: "Nothing to show here.",
  noMatches: "No entries match the search.",
  search: "Search: title, project, state…",
  includeClosed: "Include Tamamlandı, Closed and İptal items",
  includeCompletedPrs: "Include completed PRs",
  completed: "Completed",
  groups: { workItems: "Work Items", prs: "Pull Requests", pipelines: "Pipelines" },
  tabs: {
    assigned: "Assigned to me",
    created: "Created by me",
    myPrs: "Created by me",
    reviewPrs: "Assigned to me for review",
    builds: "Build",
    releases: "Release",
  },
  col: {
    id: "ID",
    title: "Title",
    type: "Type",
    state: "State",
    project: "Project",
    assignedTo: "Assigned to",
    createdBy: "Created by",
    changed: "Changed",
    repo: "Repo",
    branches: "Branches",
    myVote: "My vote",
    assignedVia: "Assigned via",
    created: "Created",
    pipeline: "Pipeline",
    run: "Run",
    branch: "Branch",
    status: "Status",
    stages: "Stages",
    when: "When",
  },
  draft: "Draft",
  direct: "Directly",
  unassigned: "Unassigned",
  votes: {
    "10": "Approved",
    "5": "Approved with suggestions",
    "0": "No vote",
    "-5": "Waiting for author",
    "-10": "Rejected",
  },
  groupVotes: {
    "10": "Group approved",
    "5": "Group approved with suggestions",
    "-5": "Group waiting for author",
    "-10": "Group rejected",
  },
  all: "All",
  clearFilters: "Clear filters",
  status: {
    succeeded: "Succeeded",
    failed: "Failed",
    partiallysucceeded: "Partially succeeded",
    canceled: "Canceled",
    cancelling: "Canceling",
    inprogress: "In progress",
    notstarted: "Not started",
    queued: "Queued",
    postponed: "Postponed",
    rejected: "Rejected",
    active: "Active",
    abandoned: "Abandoned",
    draft: "Draft",
    scheduled: "Scheduled",
    completed: "Completed",
  },
  diagnostics: "Diagnostics",
};

export const STRINGS: Record<Lang, Strings> = { tr, en };
