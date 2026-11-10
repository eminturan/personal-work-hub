import {
  byTimeDesc,
  chunk,
  mapLimit,
  mergeReviewPrs,
  pickerToPeople,
  deploymentApprovals,
  pendingApprovalCount,
  releaseDeployments,
  toApproval,
  toBuildRun,
  toPeople,
  toPullRequest,
  toReleaseRun,
  toWorkItems,
  wiql,
  withSlash,
} from "./logic";
import {
  Approval,
  DataSource,
  LoadOptions,
  MyWorkData,
  PeopleSearch,
  Person,
  PullRequest,
  RawApproval,
  RawBuild,
  RawDeployment,
  RawIdentity,
  RawPickerIdentity,
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
/** Grup üyelikleri ve proje listesi bu süre boyunca yeniden okunmaz; dakikalar içinde değişmezler. */
const CACHE_MS = 30 * 60_000;

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
 * @param hostSearch Azure DevOps sayfasının kendi kişi arama servisi; varsa kişi aramasında önce o denenir.
 */
export function createRestSource(
  baseUrl: string,
  getToken: () => Promise<string>,
  knownUserId?: string,
  // credentials: "omit": kimlik yalnızca Bearer token'dır. Sunucu bir isteği 401 ile reddederse
  // tarayıcı kendi kullanıcı adı/parola penceresini açmaz; hata ilgili listede gösterilir.
  fetchFn: Fetch = (u, i) => fetch(u, { ...i, credentials: "omit" }),
  hostSearch?: PeopleSearch,
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
      { query: wiql(field, opts.includeClosed, opts.from, opts.to, Date.now(), opts.person) },
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
  const groupCache = new Map<string, { at: number; ids: Set<string>; diag: Record<string, unknown> }>();
  /** @param self Oturum açan kullanıcı mı; `teams?$mine` yalnızca onun için sorulabilir. */
  async function groupIds(token: string, me: string, self: boolean): Promise<Set<string>> {
    const cached = groupCache.get(me.toLowerCase());
    if (cached && Date.now() - cached.at < CACHE_MS) {
      Object.assign(diag, cached.diag, { membershipCached: true });
      return cached.ids;
    }
    const ids = new Set<string>();
    const teams = (
      self ? list<{ id: string }>(token, `_apis/teams?$mine=true&$top=500&${API}-preview.3`) : Promise.resolve([])
    ).then(
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
    // Bir kaynak okunamadıysa önbelleğe alınmaz; sonraki yüklemede yeniden denenir.
    if (!diag.myTeamsError && !diag.myGroupsError) {
      groupCache.set(me.toLowerCase(), { at: Date.now(), ids, diag: { myTeams: diag.myTeams, myGroups: diag.myGroups } });
    }
    return ids;
  }

  async function reviewPrs(token: string, me: string, self: boolean, opts: LoadOptions): Promise<Section<PullRequest>> {
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
      groupIds(token, me, self),
      pullRequests(token, `reviewerId=${encodeURIComponent(me)}`),
      // Tamamlananlarda yalnızca bizzat reviewer olduklarım: oy veren kişi PR'a doğrudan eklenir.
      opts.includeCompletedPrs ? pullRequests(token, `reviewerId=${encodeURIComponent(me)}`, "completed") : Promise.resolve([]),
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

  /** Proje listesi build ve release sorgularınca paylaşılır ve bir süre önbellekte tutulur. */
  let projectCache: { at: number; list: Promise<{ name: string }[]> } | undefined;
  function projects(token: string) {
    if (!projectCache || Date.now() - projectCache.at >= CACHE_MS) {
      const mine = { at: Date.now(), list: list<{ name: string }>(token, `_apis/projects?$top=1000&${API}`) };
      projectCache = mine;
      // Okunamayan liste önbellekte kalmasın.
      mine.list.catch(() => {
        if (projectCache === mine) projectCache = undefined;
      });
    }
    return projectCache.list;
  }

  /** Release uç noktaları collection düzeyinde kayıt döndürdü mü; yalnızca release alanı `tryCollection` kullanır. */
  let releaseCollectionWorks = false;

  /**
   * Proje proje sorar; okunamayan projeler atlanır. `tryCollection` verilirse önce collection
   * düzeyinde tek sorgu denenir ve sonuç döndüyse onunla yetinilir (boş ya da hatalıysa projelere düşülür).
   * Proje proje gelen her kayda proje adı `__project` olarak eklenir.
   */
  async function acrossProjects<T>(token: string, name: string, path: string, tryCollection: boolean): Promise<T[]> {
    let firstError: string | undefined;
    if (tryCollection) {
      try {
        const found = await list<T>(token, path);
        if (found.length > 0) {
          releaseCollectionWorks = true;
          return found;
        }
        diag[`${name}CollectionEmpty`] = true;
        // Release uç noktalarının collection düzeyinde çalıştığı daha önce görüldüyse boş yanıt
        // gerçekten "kayıt yok" demektir; proje proje sormaya gerek kalmaz.
        if (releaseCollectionWorks) return [];
      } catch (e) {
        firstError = message(e);
        diag[`${name}CollectionError`] = firstError;
        // Yetki hatası proje proje sorunca da değişmez; her proje için yeniden denenmez.
        if (denied(e)) throw e;
      }
    }
    const all = await projects(token);
    let failed = 0;
    const perProject = await mapLimit(all, PARALLEL, (p) =>
      list<T>(token, `${encodeURIComponent(p.name)}/${path}`).then(
        (items) => items.map((item) => ({ ...item, __project: p.name })),
      ).catch((e) => {
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
      // Server 2022 release listesini proje olmadan hata vermeden boş döndürüyor; doğrudan proje proje sorulur.
      false,
    );
    return { items: raw.map(toReleaseRun).sort(byTimeDesc).slice(0, RUN_LIMIT) };
  }

  const denied = (e: unknown) => /^HTTP 40[13]\b/.test(message(e));
  let approvalsDenied: string | undefined;
  let deploymentsDenied: string | undefined;
  const approvalCache = new Map<string, { at: number; section: Section<Approval> }>();

  /**
   * Kişinin (ya da üyesi olduğu grubun) onayını bekleyen release aşamaları. İki yol vardır:
   * 1. Onay listesi uç noktası. Server 2022 bunu salt okunur izinlerle vermiyor (HTTP 401, TF400813).
   * 2. Onay bekleyen deployment'lar: release okuma izniyle açılır ve onayın kime atandığını içerir;
   *    atananlar kişinin kimliği ve gruplarıyla karşılaştırılır. Proje proje sorulduğu için pahalıdır.
   * İkisi de reddedilirse liste gizlenir; daha geniş izin (vso.release_execute) istenmez.
   * Sonuç bir süre önbellekte tutulur; `fresh` (Yenile düğmesi) önbelleği atlar.
   */
  async function approvals(token: string, me: string, self: boolean, fresh: boolean): Promise<Section<Approval>> {
    const key = me.toLowerCase();
    const cached = approvalCache.get(key);
    if (cached && !fresh && Date.now() - cached.at < CACHE_MS) {
      diag.approvalsCached = true;
      return cached.section;
    }
    const section = await readApprovals(token, me, self);
    approvalCache.set(key, { at: Date.now(), section });
    return section;
  }

  async function readApprovals(token: string, me: string, self: boolean): Promise<Section<Approval>> {
    const done = (raw: RawApproval[], limited: boolean): Section<Approval> => ({
      items: raw.map((a) => toApproval(a, base)).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")),
      truncated: limited,
    });
    if (!approvalsDenied) {
      try {
        const raw = await acrossProjects<RawApproval>(
          token,
          "approvals",
          `_apis/release/approvals?assignedToFilter=${encodeURIComponent(me)}&statusFilter=pending&includeMyGroupApprovals=true&$top=${PR_LIMIT}&${API}`,
          true,
        );
        diag.approvalsSource = "approvals";
        return done(raw, raw.length >= PR_LIMIT);
      } catch (e) {
        if (!denied(e)) throw e;
        approvalsDenied = message(e);
      }
    }
    diag.approvalsDenied = approvalsDenied;
    if (!deploymentsDenied) {
      try {
        const [groups, deployments] = await Promise.all([
          groupIds(token, me, self),
          acrossProjects<RawDeployment>(
            token,
            "pendingDeployments",
            `_apis/release/deployments?operationStatus=Pending&latestAttemptsOnly=true&queryOrder=descending&$top=${PR_LIMIT}&${API}`,
            false,
          ),
        ]);
        diag.approvalsSource = "deployments";
        diag.pendingDeployments = deployments.length;
        diag.pendingApprovalsAnyone = pendingApprovalCount(deployments);
        if (deployments.length > 0) return done(deploymentApprovals(deployments, me, groups), false);
        // Deployment sorgusu hiç kayıt döndürmediyse filtre bu sunucuda eşleşmiyor olabilir. Aynı bilgi
        // devam eden release'lerin aşamalarında da vardır; bir kez de oradan bakılır.
        const releases = await acrossProjects<RawRelease>(
          token,
          "inProgressReleases",
          `_apis/release/releases?environmentStatusFilter=2&$expand=environments,approvals&queryOrder=descending&$top=${RUN_LIMIT}&${API}`,
          false,
        ).catch((e) => {
          diag.inProgressReleasesError = message(e);
          return [] as RawRelease[];
        });
        const stages = releaseDeployments(releases);
        diag.inProgressReleases = releases.length;
        diag.pendingApprovalsInReleases = pendingApprovalCount(stages);
        if (releases.length > 0) diag.approvalsSource = "releases";
        return done(deploymentApprovals(stages, me, groups), false);
      } catch (e) {
        if (!denied(e)) throw e;
        deploymentsDenied = message(e);
      }
    }
    diag.deploymentsDenied = deploymentsDenied;
    return { items: [], unavailable: true };
  }

  return {
    diagnostics: () => ({ ...diag }),
    async load(opts: LoadOptions): Promise<MyWorkData> {
      for (const k of Object.keys(diag)) delete diag[k];
      const token = await getToken();
      // Başkasının işlerine bakılıyorsa bütün sorgular o kişinin kimliğiyle yapılır; yetki yine
      // oturum açan kullanıcınındır, yani yalnızca onun görebildiği kayıtlar döner.
      const me = opts.person?.id ?? (await userId(token));
      diag.userIdFromSdk = !!knownUserId;
      diag.viewingOther = !!opts.person;
      const [assigned, created, myPrs, review, build, release, approval] = await Promise.all([
        section("assigned", () => workItems(token, "System.AssignedTo", opts)),
        section("created", () => workItems(token, "System.CreatedBy", opts)),
        section("myPrs", async () => {
          const [active, completed] = await Promise.all([
            pullRequests(token, `creatorId=${encodeURIComponent(me)}`),
            opts.includeCompletedPrs ? pullRequests(token, `creatorId=${encodeURIComponent(me)}`, "completed") : Promise.resolve([]),
          ]);
          return {
            items: [...active, ...completed].map((r) => toPullRequest(r, me, new Set(), base)),
            truncated: active.length >= PR_LIMIT || completed.length >= PR_LIMIT,
          };
        }),
        section("reviewPrs", () => reviewPrs(token, me, !opts.person, opts)),
        section("builds", () => builds(token, me)),
        section("releases", () => releases(token, me)),
        section("approvals", () => approvals(token, me, !opts.person, !!opts.fresh)),
      ]);
      return { assigned, created, myPrs, reviewPrs: review, builds: build, releases: release, approvals: approval };
    },
    async loadWorkItems(opts: LoadOptions) {
      delete diag.assignedError;
      delete diag.createdError;
      const token = await getToken();
      const [assigned, created] = await Promise.all([
        section("assigned", () => workItems(token, "System.AssignedTo", opts)),
        section("created", () => workItems(token, "System.CreatedBy", opts)),
      ]);
      return { assigned, created };
    },
    /**
     * Kişi arar. Sırayla üç yol denenir ve sonuç veren ilki kullanılır:
     * 1. Azure DevOps sayfasının kendi kişi arama servisi (ad, hesap ya da e-posta öneki),
     * 2. aynı aramanın REST uç noktası (IdentityPicker),
     * 3. eski kimlik araması: yalnızca tam hesap adı ya da tam görünen ad eşleşir.
     */
    async searchPeople(query: string) {
      const text = query.trim();
      if (text.length < 2) return [];
      const token = await getToken();
      const ways: [string, () => Promise<Person[]>][] = [
        [
          "picker",
          async () =>
            pickerToPeople(
              (
                await call<{ results?: { identities?: RawPickerIdentity[] }[] }>(
                  token,
                  `_apis/IdentityPicker/Identities?${API}-preview.1`,
                  {
                    query: text,
                    identityTypes: ["user"],
                    operationScopes: ["ims"],
                    options: { MinResults: 5, MaxResults: 20 },
                    properties: ["DisplayName", "ScopeName", "SamAccountName", "Active", "SignInAddress", "Mail"],
                  },
                )
              ).results?.flatMap((r) => r.identities ?? []) ?? [],
            ),
        ],
        [
          "exact",
          async () =>
            toPeople(
              await list<RawIdentity>(
                token,
                `_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(text)}&queryMembership=None&${API}`,
              ),
            ),
        ],
      ];
      if (hostSearch) ways.unshift(["host", async () => pickerToPeople(await hostSearch(text))]);
      const errors: Record<string, string> = {};
      for (const [name, run] of ways) {
        try {
          const people = await run();
          if (people.length > 0) {
            diag.peopleSearch = name;
            diag.peopleSearchErrors = errors;
            return people;
          }
        } catch (e) {
          errors[name] = message(e);
        }
      }
      diag.peopleSearch = "none";
      diag.peopleSearchErrors = errors;
      // Hiçbir yol çalışmadıysa hata gösterilir; çalışıp sonuç bulamadıysa liste boştur.
      if (Object.keys(errors).length === ways.length) throw new Error(Object.values(errors)[0]);
      return [];
    },
  };
}
