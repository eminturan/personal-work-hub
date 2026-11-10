import {
  PullRequest,
  RawBuild,
  RawPullRequest,
  RawRelease,
  RawWorkItem,
  Run,
  RunTone,
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

export function wiql(field: "System.AssignedTo" | "System.CreatedBy", includeClosed: boolean): string {
  const closed = includeClosed
    ? ""
    : ` AND [System.State] NOT IN (${CLOSED_STATES.map((s) => `'${s}'`).join(", ")})`;
  return `SELECT [System.Id] FROM WorkItems WHERE [${field}] = @Me${closed} ORDER BY [System.ChangedDate] DESC`;
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
