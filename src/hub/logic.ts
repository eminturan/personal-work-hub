import {
  Approval,
  MyWorkData,
  Person,
  PullRequest,
  RawApproval,
  RawBuild,
  RawIdentity,
  RawPickerIdentity,
  RawPullRequest,
  RawRelease,
  RawWorkItem,
  Run,
  RunTone,
  Section,
  WorkItem,
} from "./types";

/** Yalnızca http(s) bağlantılarına izin verir; sunucudan gelen adres doğrudan href'e yazılmaz. */
export function safeHref(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export const withSlash = (url: string) => (url.endsWith("/") ? url : url + "/");

export const shortBranch = (ref: string | undefined) => (ref ?? "").replace(/^refs\/heads\//, "");

const sameId = (a: string | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** Tamamlanmış sayılan durumlar; "kapalıları göster" kapalıyken sorgudan çıkarılır. */
// "Tamamlandı" ve "İptal" kurumun süreç şablonundaki durum adlarıdır.
// "İptal" küçük i ile de yazılabiliyor; sunucunun harf eşlemesine güvenmemek için ikisi de listede.
export const CLOSED_STATES = [
  "Closed",
  "Kapalı",
  "Tamamlandı",
  "İptal",
  "iptal",
  "Cancelled",
  "Canceled",
  "Done",
  "Removed",
  "Completed",
];

const DONE_STATES = new Set(["tamamlandi", "closed", "kapali", "done", "completed"]);
const CANCELLED_STATES = new Set(["iptal", "cancelled", "canceled"]);

/** Work item durum rozetinin rengi: tamamlanan/kapalı yeşil, iptal kırmızı, diğerleri nötr. */
export function stateTone(state: string): RunTone {
  // İ/I/ı/i farkı ve büyük-küçük harf önemsenmez.
  const s = state.trim().toLocaleLowerCase("tr").replace(/ı/g, "i");
  return DONE_STATES.has(s) ? "ok" : CANCELLED_STATES.has(s) ? "failed" : "neutral";
}

const DAY_MS = 86_400_000;

/**
 * Kişiyi WIQL metin sabiti olarak yazar. Hesap adı biliniyorsa "Ad <DOMAIN\hesap>" biçimi kullanılır:
 * aynı adı taşıyan iki kişiyi ayırır. Tek tırnak iki kez yazılarak kaçırılır.
 */
export function wiqlPerson(person: Person): string {
  const text = person.account ? `${person.name} <${person.account}>` : person.name;
  return `'${text.replace(/'/g, "''")}'`;
}

/** Kişi seçici yanıtını kişi listesine çevirir: gruplar, etkin olmayanlar ve collection'da kimliği olmayanlar alınmaz. */
export function pickerToPeople(raw: RawPickerIdentity[], limit = 20): Person[] {
  const seen = new Set<string>();
  const people: Person[] = [];
  for (const i of raw) {
    const type = (i.entityType ?? "user").toLowerCase();
    if (!i.localId || !i.displayName || type !== "user" || i.active === false) continue;
    if (seen.has(i.localId.toLowerCase())) continue;
    seen.add(i.localId.toLowerCase());
    const sam = i.samAccountName ?? "";
    const account = i.signInAddress?.includes("\\")
      ? i.signInAddress
      : sam
        ? i.scopeName
          ? `${i.scopeName}\\${sam}`
          : sam
        : (i.signInAddress ?? i.mail ?? "");
    people.push({ id: i.localId, name: i.displayName, account });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, "tr")).slice(0, limit);
}

/** Arama yanıtındaki kimlikleri kişi listesine çevirir: gruplar ve etkin olmayanlar alınmaz. */
export function toPeople(raw: RawIdentity[], limit = 20): Person[] {
  const value = (i: RawIdentity, key: string) => {
    const v = i.properties?.[key]?.$value;
    return typeof v === "string" ? v : "";
  };
  const seen = new Set<string>();
  const people: Person[] = [];
  for (const i of raw) {
    const name = i.customDisplayName || i.providerDisplayName;
    if (!i.id || !name || i.isContainer || i.isActive === false || seen.has(i.id.toLowerCase())) continue;
    seen.add(i.id.toLowerCase());
    const account = value(i, "Account");
    const domain = value(i, "Domain");
    people.push({ id: i.id, name, account: account ? (domain ? `${domain}\\${account}` : account) : "" });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, "tr")).slice(0, limit);
}

/** Tarih alanının değeri (YYYY-AA-GG) → o günün yerel saatle başlangıcı; geçersizse NaN. */
const dayStart = (date: string) => new Date(`${date}T00:00:00`).getTime();

/** Yerel tarihi tarih alanının biçimine (YYYY-AA-GG) çevirir. */
export function toDateInput(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bugünden kaç gün önce (gelecekse negatif). */
const daysAgo = (date: string, now: number) => Math.round((dayStart(toDateInput(now)) - dayStart(date)) / DAY_MS);

/**
 * @param from,to Tarih aralığı (YYYY-AA-GG); boş uç sınırsızdır.
 */
export function wiql(
  field: "System.AssignedTo" | "System.CreatedBy",
  includeClosed: boolean,
  from = "",
  to = "",
  now = Date.now(),
  person?: Person,
): string {
  const who = person ? wiqlPerson(person) : "@Me";
  const closed = includeClosed
    ? ""
    : ` AND [System.State] NOT IN (${CLOSED_STATES.map((s) => `'${s}'`).join(", ")})`;
  // Tarih sınırı sunucuda da uygulanır ki 200 kayıt sınırı aralık dışındaki kayıtlarla dolmasın.
  // Tarih yazmak yerine @Today'e göre gün farkı kullanılır: sunucunun tarih biçimine bağlı kalmaz.
  // Saat dilimi farkı kayıt düşürmesin diye iki uçta birer gün pay bırakılır; kesin süzme tarayıcıdadır.
  let range = "";
  const fromAgo = daysAgo(from, now);
  const toAgo = daysAgo(to, now);
  if (from && !Number.isNaN(fromAgo)) range += ` AND [System.ChangedDate] >= @Today - ${fromAgo + 1}`;
  if (to && !Number.isNaN(toAgo) && toAgo > 1) range += ` AND [System.ChangedDate] <= @Today - ${toAgo - 1}`;
  return `SELECT [System.Id] FROM WorkItems WHERE [${field}] = ${who}${closed}${range} ORDER BY [System.ChangedDate] DESC`;
}

const personName = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.replace(/\s*<[^>]*>$/, "");
  if (v && typeof v === "object") return (v as { displayName?: string }).displayName;
  return undefined;
};

/** @param order WIQL'in döndürdüğü id sırası; batch yanıtı bu sıraya dizilir. */
export function toWorkItems(raw: (RawWorkItem | null)[], order: number[], baseUrl: string): WorkItem[] {
  const byId = new Map<number, RawWorkItem>();
  for (const r of raw) if (r) byId.set(r.id, r);
  const items: WorkItem[] = [];
  for (const id of order) {
    const r = byId.get(id);
    if (!r) continue;
    const f = r.fields ?? {};
    const project = String(f["System.TeamProject"] ?? "");
    items.push({
      id,
      title: String(f["System.Title"] ?? ""),
      type: String(f["System.WorkItemType"] ?? ""),
      state: String(f["System.State"] ?? ""),
      project,
      assignedTo: personName(f["System.AssignedTo"]),
      createdBy: personName(f["System.CreatedBy"]),
      changedDate: f["System.ChangedDate"] as string | undefined,
      url: safeHref(`${withSlash(baseUrl)}${encodeURIComponent(project)}/_workitems/edit/${id}`),
    });
  }
  return items;
}

export function toPullRequest(raw: RawPullRequest, userId: string, groupIds: Set<string>, baseUrl: string): PullRequest {
  const project = raw.repository?.project?.name ?? "";
  const repo = raw.repository?.name ?? "";
  const reviewers = raw.reviewers ?? [];
  const me = reviewers.find((r) => sameId(r.id, userId));
  return {
    id: raw.pullRequestId,
    title: raw.title ?? "",
    project,
    repo,
    creator: raw.createdBy?.displayName ?? "",
    // Tamamlanan PR'da anlamlı olan kapanış zamanıdır.
    createdDate: raw.closedDate ?? raw.creationDate,
    status: raw.status ?? "active",
    sourceBranch: shortBranch(raw.sourceRefName),
    targetBranch: shortBranch(raw.targetRefName),
    isDraft: !!raw.isDraft,
    reviewers: reviewers
      .filter((r) => r.displayName)
      .map((r) => ({ name: r.displayName!, vote: r.vote ?? 0, required: !!r.isRequired })),
    myVote: me?.vote ?? 0,
    groupVote: reviewers.find((r) => r.id && groupIds.has(r.id.toLowerCase()) && r.vote)?.vote ?? 0,
    direct: !!me,
    via: reviewers
      .filter((r) => r.id && groupIds.has(r.id.toLowerCase()))
      .map((r) => r.displayName ?? "")
      .filter(Boolean),
    url: safeHref(
      `${withSlash(baseUrl)}${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${raw.pullRequestId}`,
    ),
  };
}

/**
 * Review bekleyen PR'lar: kullanıcıya doğrudan ya da üyesi olduğu grup üzerinden atananlar.
 * Aynı PR birden çok sorguda dönebilir; bir kez alınır. Kullanıcının kendi açtığı PR'lar hariç.
 */
export function mergeReviewPrs(
  lists: RawPullRequest[][],
  userId: string,
  groupIds: Set<string>,
  baseUrl: string,
): PullRequest[] {
  const seen = new Set<string>();
  const out: PullRequest[] = [];
  for (const raw of lists.flat()) {
    const key = `${raw.repository?.project?.name}/${raw.repository?.name}/${raw.pullRequestId}`;
    if (seen.has(key) || sameId(raw.createdBy?.id, userId)) continue;
    // Listeler bütün aktif PR'ların taramasından da gelebilir; yalnızca bana ya da grubuma atananlar alınır.
    const mine = (raw.reviewers ?? []).some((r) => sameId(r.id, userId) || (!!r.id && groupIds.has(r.id.toLowerCase())));
    if (!mine) continue;
    seen.add(key);
    out.push(toPullRequest(raw, userId, groupIds, baseUrl));
  }
  return out.sort((a, b) => (b.createdDate ?? "").localeCompare(a.createdDate ?? ""));
}

export function runTone(status: string | undefined): RunTone {
  switch ((status ?? "").toLowerCase()) {
    case "succeeded":
      return "ok";
    case "failed":
    case "rejected":
      return "failed";
    case "partiallysucceeded":
    case "canceled":
    case "cancelling":
    case "abandoned":
      return "warning";
    case "inprogress":
    case "queued":
    case "postponed":
    case "active":
      return "running";
    default:
      return "neutral";
  }
}

export function toBuildRun(b: RawBuild): Run {
  // Tamamlanan build'de anlamlı olan sonuçtur (succeeded/failed); sürende durum (inProgress/notStarted).
  const status = b.status === "completed" ? (b.result ?? "completed") : (b.status ?? "");
  return {
    id: b.id,
    name: b.definition?.name ?? "",
    number: b.buildNumber ?? String(b.id),
    project: b.project?.name ?? "",
    status,
    tone: runTone(status),
    branch: shortBranch(b.sourceBranch),
    time: b.finishTime ?? b.startTime ?? b.queueTime,
    url: safeHref(b._links?.web?.href),
  };
}

export function toReleaseRun(r: RawRelease): Run {
  const stages = (r.environments ?? []).map((e) => ({
    name: e.name ?? "",
    status: e.status ?? "",
    tone: runTone(e.status),
  }));
  return {
    id: r.id,
    name: r.releaseDefinition?.name ?? "",
    number: r.name ?? String(r.id),
    project: r.projectReference?.name ?? "",
    status: r.status ?? "",
    // Release'in kendi durumu hep "active" kalır; rengi aşamalar belirler.
    tone: stages.some((s) => s.tone === "failed")
      ? "failed"
      : stages.some((s) => s.tone === "running")
        ? "running"
        : stages.length > 0 && stages.every((s) => s.tone === "ok")
          ? "ok"
          : "neutral",
    time: r.createdOn,
    stages,
    url: safeHref(r._links?.web?.href),
  };
}

/** Tarih aralığın içinde mi; iki uç da dahildir, boş uç sınırsızdır, tarihi olmayan kayıt elenmez. */
export function inRange(iso: string | undefined, from: string, to: string): boolean {
  if (!iso) return true;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return true;
  const start = from ? dayStart(from) : NaN;
  const end = to ? dayStart(to) + DAY_MS : NaN;
  return (Number.isNaN(start) || time >= start) && (Number.isNaN(end) || time < end);
}

/**
 * Bütün listelere tarih aralığını uygular: work item'da son değişiklik, PR'da açılış (tamamlananda
 * kapanış), build/release'de çalışma zamanı. Aktif PR'lar ve bekleyen onaylar her zaman kalır.
 */
export function filterByRange(data: MyWorkData, from: string, to: string): MyWorkData {
  const keep = <T>(s: Section<T>, time: (row: T) => string | undefined): Section<T> => ({
    ...s,
    items: s.items.filter((r) => inRange(time(r), from, to)),
  });
  return {
    assigned: keep(data.assigned, (w) => w.changedDate),
    created: keep(data.created, (w) => w.changedDate),
    // Aktif PR bekleyen iştir; ne kadar eski olursa olsun tarih aralığına takılmaz.
    myPrs: keep(data.myPrs, (p) => (p.status === "active" ? undefined : p.createdDate)),
    reviewPrs: keep(data.reviewPrs, (p) => (p.status === "active" ? undefined : p.createdDate)),
    builds: keep(data.builds, (r) => r.time),
    releases: keep(data.releases, (r) => r.time),
    // Bekleyen onaylar da tarih aralığına takılmaz.
    approvals: data.approvals,
  };
}

export function toApproval(a: RawApproval, baseUrl: string): Approval {
  const project = a.__project ?? "";
  return {
    id: a.id,
    name: a.releaseDefinition?.name ?? "",
    release: a.release?.name ?? "",
    project,
    stage: a.releaseEnvironment?.name ?? "",
    type: a.approvalType ?? "",
    approver: a.approver?.displayName ?? "",
    time: a.createdOn,
    url:
      safeHref(a.release?._links?.web?.href) ??
      (project && a.release?.id
        ? safeHref(`${withSlash(baseUrl)}${encodeURIComponent(project)}/_releaseProgress?releaseId=${a.release.id}`)
        : undefined),
  };
}

export const byTimeDesc = (a: Run, b: Run) => (b.time ?? "").localeCompare(a.time ?? "");

/** Serbest metin araması: satırın görünen bütün metinlerinde, büyük/küçük harf ayırmadan. */
export function matches(query: string, ...texts: (string | number | undefined)[]): boolean {
  const q = query.trim().toLocaleLowerCase("tr");
  if (!q) return true;
  return texts.some((t) => t !== undefined && String(t).toLocaleLowerCase("tr").includes(q));
}

export interface AgoUnits {
  now: string;
  m: string;
  h: string;
  d: string;
}

/** "3 sa", "2 g" gibi kısa geçen süre. */
export function ago(iso: string | undefined, now: number, u: AgoUnits): string {
  if (!iso) return "";
  const sec = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (Number.isNaN(sec)) return "";
  if (sec < 60) return u.now;
  if (sec < 3600) return `${Math.floor(sec / 60)} ${u.m}`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ${u.h}`;
  return `${Math.floor(sec / 86400)} ${u.d}`;
}

/** En fazla `limit` iş aynı anda çalışır; sonuçlar girdi sırasındadır. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
