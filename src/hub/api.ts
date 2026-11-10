import {
  byTimeDesc,
  chunk,
  mapLimit,
  mergeReviewPrs,
  toBuildRun,
  toPullRequest,
  toReleaseRun,
  toWorkItems,
  wiql,
  withSlash,
} from "./logic";
import {
  DataSource,
  LoadOptions,
  MyWorkData,
  PullRequest,
  RawBuild,
  RawPullRequest,
  RawRelease,
  RawWorkItem,
  Run,
  Section,
  WorkItem,
} from "./types";

// Server 2022 için 7.0.
const API = "api-version=7.0";
const WORK_ITEM_LIMIT = 200; // workitemsbatch tek istekte en fazla 200 id kabul eder
const PR_LIMIT = 100;
const RUN_LIMIT = 50;
/** Grup atamalarını bulmak için taranan aktif PR sayfası boyutu ve en fazla sayfa sayısı. */
const SCAN_PAGE = 1000;
const SCAN_PAGES = 5;
const PARALLEL = 6;

const WORK_ITEM_FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.TeamProject",
  "System.AssignedTo",
  "System.CreatedBy",
  "System.ChangedDate",
];

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Descriptor = string | { identityType?: string; identifier?: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * @param baseUrl Collection adresi, örn. https://sunucu/tfs/DefaultCollection/
 * @param getToken Extension'ın erişim token'ını döndürür.
 * @param knownUserId SDK'nın bildirdiği kullanıcı id'si; yoksa sunucudan sorulur.
 */
export function createRestSource(
  baseUrl: string,
  getToken: () => Promise<string>,
  knownUserId?: string,
  fetchFn: Fetch = (u, i) => fetch(u, i),
): DataSource {
  const base = withSlash(baseUrl);
  // Son yüklemede sunucudan ne okunabildiği. Yalnızca sayılar ve hata mesajları; iş ya da kişi adı içermez.
  const diag: Record<string, unknown> = {};

  async function call<T>(token: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res
        .json()
        .then((b) => (typeof b?.message === "string" ? `: ${b.message.slice(0, 300)}` : ""))
        .catch(() => "");
      throw new Error(`HTTP ${res.status}${detail}`);
    }
    return (await res.json()) as T;
  }
  const list = async <T>(token: string, path: string) => (await call<{ value: T[] }>(token, path)).value ?? [];

  /** Bir bölümün hatası diğerlerini etkilemesin diye her bölüm kendi hatasını taşır. */
  async function section<T>(name: string, run: () => Promise<Section<T>>): Promise<Section<T>> {
    try {
      const s = await run();
      diag[name] = s.items.length;
      return s;
    } catch (e) {
      diag[`${name}Error`] = message(e);
      return { items: [], error: message(e) };
    }
  }

  async function userId(token: string): Promise<string> {
    if (knownUserId) return knownUserId;
    const data = await call<{ authenticatedUser?: { id?: string } }>(token, `_apis/connectionData?${API}-preview`);
    const id = data.authenticatedUser?.id;
    if (!id) throw new Error("Kullanıcı kimliği okunamadı");
    return id;
  }

  async function workItems(token: string, field: Parameters<typeof wiql>[0], opts: LoadOptions) {
    const result = await call<{ workItems?: { id: number }[] }>(
      token,
      `_apis/wit/wiql?$top=${WORK_ITEM_LIMIT}&${API}`,
      { query: wiql(field, opts.includeClosed) },
    );
    const ids = (result.workItems ?? []).map((w) => w.id);
    if (ids.length === 0) return { items: [] as WorkItem[] };
    const batch = await call<{ value: (RawWorkItem | null)[] }>(token, `_apis/wit/workitemsbatch?${API}`, {
      ids,
      fields: WORK_ITEM_FIELDS,
      errorPolicy: "Omit",
    });
    return { items: toWorkItems(batch.value ?? [], ids, base), truncated: ids.length >= WORK_ITEM_LIMIT };
  }

  const pullRequests = (token: string, criteria: string, status = "active") =>
    list<RawPullRequest>(
      token,
      `_apis/git/pullrequests?searchCriteria.status=${status}&searchCriteria.${criteria}&$top=${PR_LIMIT}&${API}`,
    );

  /**
   * Kullanıcının üyesi olduğu takım ve grupların kimlik id'leri. İki kaynak birleştirilir, biri
   * başarısız olursa diğeriyle devam edilir: takımlar (teams?$mine) ve kimlik üyelikleri (identities).
   */
  async function groupIds(token: string, me: string): Promise<Set<string>> {
    const ids = new Set<string>();
    const teams = list<{ id: string }>(token, `_apis/teams?$mine=true&$top=500&${API}-preview.3`).then(
      (v) => {
        diag.myTeams = v.length;
        v.forEach((t) => ids.add(t.id.toLowerCase()));
      },
      (e) => {
        diag.myTeamsError = message(e);
      },
    );
    const membership = (async () => {
      const read = (mode: string) =>
        list<{ memberOf?: Descriptor[] }>(
          token,
          `_apis/identities?identityIds=${encodeURIComponent(me)}&queryMembership=${mode}&${API}`,
        );
      // Expanded iç içe grupları da verir; sunucu desteklemiyorsa doğrudan üyeliklerle yetinilir.
      const [identity] = await read("Expanded").catch(() => read("Direct"));
      const descriptors = (identity?.memberOf ?? [])
        .map((d) => (typeof d === "string" ? d : d.identityType && d.identifier ? `${d.identityType};${d.identifier}` : ""))
        .filter(Boolean);
      const groups = await mapLimit(chunk(descriptors, 15), PARALLEL, (part) =>
        list<{ id?: string }>(
          token,
          `_apis/identities?descriptors=${encodeURIComponent(part.join(","))}&${API}`,
        ),
      );
      const found = groups.flat().filter((g) => g?.id);
      diag.myGroups = found.length;
      for (const g of found) ids.add(g.id!.toLowerCase());
    })().catch((e) => {
      diag.myGroupsError = message(e);
    });
    await Promise.all([teams, membership]);
    ids.delete(me.toLowerCase());
    return ids;
  }

  async function reviewPrs(token: string, me: string, opts: LoadOptions): Promise<Section<PullRequest>> {
    // Kullanıcı yüzlerce grubun üyesi olabilir; grup başına sorgu yerine
    // aktif PR'lar bir kez taranır ve reviewer'ları kullanıcının gruplarıyla karşılaştırılır.
    let scanTruncated = false;
    const scan = async () => {
      const all: RawPullRequest[] = [];
      for (let page = 0; page < SCAN_PAGES; page++) {
        const part = await list<RawPullRequest>(
          token,
          `_apis/git/pullrequests?searchCriteria.status=active&$top=${SCAN_PAGE}&$skip=${page * SCAN_PAGE}&${API}`,
        );
        all.push(...part);
        if (part.length < SCAN_PAGE) return all;
      }
      scanTruncated = true;
      return all;
    };
    const [groups, direct, completed, scanned] = await Promise.all([
      groupIds(token, me),
      pullRequests(token, `reviewerId=${me}`),
      // Tamamlananlarda yalnızca bizzat reviewer olduklarım: oy veren kişi PR'a doğrudan eklenir.
      opts.includeCompletedPrs ? pullRequests(token, `reviewerId=${me}`, "completed") : Promise.resolve([]),
      scan().catch((e) => {
        diag.activePrScanError = message(e);
        scanTruncated = true;
        return [] as RawPullRequest[];
      }),
    ]);
    diag.activePrsScanned = scanned.length;
    return {
      items: mergeReviewPrs([direct, scanned, completed], me, groups, base),
      truncated: scanTruncated || direct.length >= PR_LIMIT || completed.length >= PR_LIMIT,
    };
  }

  /** Proje listesi bir yüklemede bir kez okunur; build ve release sorguları paylaşır. */
  let projectsOnce: Promise<{ name: string }[]> | undefined;
  const projects = (token: string) =>
    (projectsOnce ??= list<{ name: string }>(token, `_apis/projects?$top=1000&${API}`));

  /**
   * Proje proje sorar; okunamayan projeler atlanır. `tryCollection` verilirse önce collection
   * düzeyinde tek sorgu denenir ve sonuç döndüyse onunla yetinilir (boş ya da hatalıysa projelere düşülür).
   */
  async function acrossProjects<T>(token: string, name: string, path: string, tryCollection: boolean): Promise<T[]> {
    let firstError: string | undefined;
    if (tryCollection) {
      try {
        const found = await list<T>(token, path);
        if (found.length > 0) return found;
        diag[`${name}CollectionEmpty`] = true;
      } catch (e) {
        firstError = message(e);
        diag[`${name}CollectionError`] = firstError;
      }
    }
    const all = await projects(token);
    let failed = 0;
    const perProject = await mapLimit(all, PARALLEL, (p) =>
      list<T>(token, `${encodeURIComponent(p.name)}/${path}`).catch((e) => {
        failed++;
        firstError ??= message(e);
        return [] as T[];
      }),
    );
    diag[`${name}Projects`] = all.length;
    diag[`${name}ProjectsFailed`] = failed;
    if (failed > 0) diag[`${name}ProjectError`] = firstError;
    if (all.length > 0 && failed === all.length) throw new Error(firstError);
    return perProject.flat();
  }

  async function builds(token: string, me: string): Promise<Section<Run>> {
    const raw = await acrossProjects<RawBuild>(
      token,
      "builds",
      `_apis/build/builds?requestedFor=${encodeURIComponent(me)}&$top=${RUN_LIMIT}&queryOrder=queueTimeDescending&${API}`,
      // Server 2022 build listesini proje olmadan kabul etmiyor (HTTP 400, VS800075).
      false,
    );
    return { items: raw.map(toBuildRun).sort(byTimeDesc).slice(0, RUN_LIMIT) };
  }

  async function releases(token: string, me: string): Promise<Section<Run>> {
    const raw = await acrossProjects<RawRelease>(
      token,
      "releases",
      `_apis/release/releases?createdBy=${encodeURIComponent(me)}&$top=${RUN_LIMIT}&$expand=environments&queryOrder=descending&${API}`,
      true,
    );
    return { items: raw.map(toReleaseRun).sort(byTimeDesc).slice(0, RUN_LIMIT) };
  }

  return {
    diagnostics: () => ({ ...diag }),
    async load(opts: LoadOptions): Promise<MyWorkData> {
      for (const k of Object.keys(diag)) delete diag[k];
      projectsOnce = undefined;
      const token = await getToken();
      const me = await userId(token);
      diag.userIdFromSdk = !!knownUserId;
      const [assigned, created, myPrs, review, build, release] = await Promise.all([
        section("assigned", () => workItems(token, "System.AssignedTo", opts)),
        section("created", () => workItems(token, "System.CreatedBy", opts)),
        section("myPrs", async () => {
          const [active, completed] = await Promise.all([
            pullRequests(token, `creatorId=${me}`),
            opts.includeCompletedPrs ? pullRequests(token, `creatorId=${me}`, "completed") : Promise.resolve([]),
          ]);
          return {
            items: [...active, ...completed].map((r) => toPullRequest(r, me, new Set(), base)),
            truncated: active.length >= PR_LIMIT || completed.length >= PR_LIMIT,
          };
        }),
        section("reviewPrs", () => reviewPrs(token, me, opts)),
        section("builds", () => builds(token, me)),
        section("releases", () => releases(token, me)),
      ]);
      return { assigned, created, myPrs, reviewPrs: review, builds: build, releases: release };
    },
  };
}
