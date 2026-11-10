import { describe, expect, it } from "vitest";
import { createRestSource } from "../src/hub/api";
import { ago, filterByRange, inRange, mapLimit, matches, mergeReviewPrs, pickerToPeople, safeHref, stateTone, toBuildRun, toReleaseRun, toWorkItems, toApproval, toDateInput, toPeople, wiql, wiqlPerson } from "../src/hub/logic";
import { RawPullRequest } from "../src/hub/types";

const BASE = "https://sunucu/tfs/Col/";
const ME = "AAAA-1";
const TEAM = "bbbb-2";
const pr = (id: number, creator: string, reviewers: RawPullRequest["reviewers"]): RawPullRequest => ({
  pullRequestId: id,
  title: `pr ${id}`,
  createdBy: { id: creator, displayName: creator },
  creationDate: `2026-11-0${id}T00:00:00Z`,
  sourceRefName: "refs/heads/feature/x",
  targetRefName: "refs/heads/main",
  repository: { name: "repo", project: { name: "Proje A" } },
  reviewers,
});

describe("wiql", () => {
  it("kapalı durumları varsayılan olarak dışlar", () => {
    const q = wiql("System.AssignedTo", false);
    expect(q).toContain("[System.State] NOT IN ('Closed', 'Kapalı', 'Tamamlandı', 'İptal', 'iptal', 'Cancelled',");
    expect(wiql("System.CreatedBy", true)).not.toContain("NOT IN");
    expect(wiql("System.CreatedBy", true)).toContain("[System.CreatedBy] = @Me");
    expect(wiql("System.CreatedBy", true)).not.toContain("@Today");
    // Bugünden 30 gün öncesi → bir gün payla @Today - 31; bitiş bugünse üst sınır yazılmaz.
    const now = new Date(2026, 10, 10, 15).getTime();
    expect(wiql("System.CreatedBy", true, "2026-10-11", "2026-11-10", now)).toMatch(
      /AND \[System\.ChangedDate\] >= @Today - 31 ORDER BY/,
    );
    expect(wiql("System.CreatedBy", true, "2026-09-01", "2026-10-01", now)).toContain(
      "[System.ChangedDate] >= @Today - 71 AND [System.ChangedDate] <= @Today - 39",
    );
    expect(wiql("System.CreatedBy", true, "bozuk", "", now)).not.toContain("@Today");
  });
});

describe("tarih aralığı", () => {
  // Yerel saatle kurulur ki test saat diliminden bağımsız olsun.
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
  it("toDateInput yerel tarihi YYYY-AA-GG verir", () => {
    expect(toDateInput(new Date(2026, 0, 5, 23, 30).getTime())).toBe("2026-01-05");
  });
  it("inRange: iki uç dahil, boş uç sınırsız, tarihsiz kayıt elenmez", () => {
    expect(inRange(at(2026, 10, 11, 0), "2026-10-11", "2026-11-10")).toBe(true);
    expect(inRange(at(2026, 11, 10, 23), "2026-10-11", "2026-11-10")).toBe(true);
    expect(inRange(at(2026, 10, 10, 23), "2026-10-11", "2026-11-10")).toBe(false);
    expect(inRange(at(2026, 11, 11, 0), "2026-10-11", "2026-11-10")).toBe(false);
    expect(inRange(at(2020, 1, 1), "", "2026-11-10")).toBe(true);
    expect(inRange(at(2030, 1, 1), "2026-10-11", "")).toBe(true);
    expect(inRange(undefined, "2026-10-11", "2026-11-10")).toBe(true);
  });
  it("filterByRange her listeyi kendi tarihine göre süzer", () => {
    const empty = { items: [] };
    const wi = (id: number, changedDate: string) => ({ id, title: "", type: "", state: "", project: "", changedDate });
    const run = (id: number, time: string) => ({ id, name: "", number: "", project: "", status: "", tone: "ok" as const, time });
    const prAt = (id: number, status: string, createdDate: string) => ({
      ...mergeReviewPrs([[pr(id, "x", [{ id: ME }])]], ME, new Set(), BASE)[0],
      status,
      createdDate,
    });
    const out = filterByRange(
      {
        assigned: { items: [wi(1, at(2026, 11, 1)), wi(2, at(2026, 1, 1))], truncated: true },
        created: empty,
        myPrs: { items: [prAt(1, "active", at(2024, 1, 1)), prAt(2, "completed", at(2024, 1, 1)), prAt(3, "completed", at(2026, 11, 2))] },
        reviewPrs: empty,
        builds: { items: [run(1, at(2026, 11, 9)), run(2, at(2025, 11, 9))] },
        releases: empty,
        approvals: { items: [{ id: 7, name: "", release: "", project: "", stage: "", type: "", approver: "", time: at(2024, 1, 1) }] },
      },
      "2026-10-11",
      "2026-11-10",
    );
    expect(out.assigned.items.map((w) => w.id)).toEqual([1]);
    expect(out.assigned.truncated).toBe(true);
    expect(out.builds.items.map((r) => r.id)).toEqual([1]);
    // Aktif PR ve bekleyen onay eski de olsa kalır; tamamlanan PR tarihe göre süzülür.
    expect(out.myPrs.items.map((p) => p.id)).toEqual([1, 3]);
    expect(out.approvals.items.length).toBe(1);
  });
});

describe("başkasının işleri", () => {
  it("wiqlPerson hesap adını ekler ve tek tırnağı kaçırır", () => {
    expect(wiqlPerson({ id: "1", name: "Ayşe Demir", account: "ORNEK\\ayse" })).toBe("'Ayşe Demir <ORNEK\\ayse>'");
    expect(wiqlPerson({ id: "1", name: "O'Brien' OR 1=1 --", account: "" })).toBe("'O''Brien'' OR 1=1 --'");
  });
  it("wiql @Me yerine seçilen kişiyi yazar", () => {
    const q = wiql("System.AssignedTo", true, "", "", Date.now(), { id: "1", name: "Ayşe Demir", account: "" });
    expect(q).toContain("[System.AssignedTo] = 'Ayşe Demir' ORDER BY");
    expect(q).not.toContain("@Me");
  });
  it("pickerToPeople: grup, etkin olmayan ve collection'da kimliği olmayan alınmaz", () => {
    expect(
      pickerToPeople([
        { entityType: "User", localId: "2", displayName: "Mehmet Kaya", signInAddress: "ORNEK\\mehmet", samAccountName: "mehmet" },
        { entityType: "User", localId: "1", displayName: "Ayşe Demir", scopeName: "ORNEK", samAccountName: "ayse" },
        { entityType: "User", localId: "3", displayName: "Bulut Kullanıcı", signInAddress: "bulut@ornek.invalid" },
        { entityType: "Group", localId: "4", displayName: "Takım" },
        { entityType: "User", localId: null, displayName: "Collection'da Yok" },
        { entityType: "User", localId: "5", displayName: "Eski", active: false },
        { entityType: "User", localId: "1", displayName: "Ayşe (tekrar)" },
      ]),
    ).toEqual([
      { id: "1", name: "Ayşe Demir", account: "ORNEK\\ayse" },
      { id: "3", name: "Bulut Kullanıcı", account: "bulut@ornek.invalid" },
      { id: "2", name: "Mehmet Kaya", account: "ORNEK\\mehmet" },
    ]);
  });
  it("toPeople grupları, etkin olmayanları ve tekrarları atar; hesap adını kurar", () => {
    const people = toPeople([
      { id: "2", providerDisplayName: "Mehmet Kaya", properties: { Account: { $value: "mehmet" }, Domain: { $value: "ORNEK" } } },
      { id: "1", providerDisplayName: "ayse", customDisplayName: "Ayşe Demir", properties: { Account: { $value: "ayse" } } },
      { id: "1", providerDisplayName: "Ayşe (tekrar)" },
      { id: "3", providerDisplayName: "[P]\\Takım", isContainer: true },
      { id: "4", providerDisplayName: "Eski Kullanıcı", isActive: false },
      { providerDisplayName: "Kimliksiz" },
    ]);
    expect(people).toEqual([
      { id: "1", name: "Ayşe Demir", account: "ayse" },
      { id: "2", name: "Mehmet Kaya", account: "ORNEK\\mehmet" },
    ]);
  });
});

describe("stateTone", () => {
  it("tamamlanan yeşil, iptal kırmızı; harf büyüklüğü ve İ/i fark etmez", () => {
    for (const s of ["Tamamlandı", "Closed", "Kapalı", "KAPALI", "closed"]) expect(stateTone(s)).toBe("ok");
    for (const s of ["İptal", "iptal", "Iptal", "IPTAL", "Cancelled", "canceled"]) expect(stateTone(s)).toBe("failed");
    for (const s of ["Active", "Design", "New"]) expect(stateTone(s)).toBe("neutral");
  });
});

describe("toWorkItems", () => {
  it("WIQL sırasını korur, eksik kayıtları atlar, adresi kurar", () => {
    const items = toWorkItems(
      [
        { id: 2, fields: { "System.Title": "iki", "System.TeamProject": "Proje A", "System.AssignedTo": { displayName: "Ali" } } },
        null,
        { id: 1, fields: { "System.Title": "bir", "System.TeamProject": "P", "System.AssignedTo": "Veli <DOMAIN\\veli>" } },
      ],
      [1, 3, 2],
      BASE,
    );
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    expect(items[0].assignedTo).toBe("Veli");
    expect(items[1].url).toBe("https://sunucu/tfs/Col/Proje%20A/_workitems/edit/2");
  });
});

describe("mergeReviewPrs", () => {
  it("tekrarları ve kendi PR'larımı çıkarır, grup atamasını ve oyumu işaretler", () => {
    const direct = [pr(1, "x", [{ id: "aaaa-1", vote: -5 }]), pr(3, ME, [{ id: TEAM }])];
    const viaTeam = [pr(1, "x", [{ id: "aaaa-1", vote: -5 }]), pr(2, "y", [{ id: "BBBB-2", displayName: "Takım", isContainer: true, vote: 10 }, { id: "baskasi", vote: 10 }])];
    const out = mergeReviewPrs([direct, viaTeam], ME, new Set([TEAM]), BASE);
    expect(out.map((p) => p.id)).toEqual([2, 1]);
    expect(out[0]).toMatchObject({ direct: false, via: ["Takım"], myVote: 0, groupVote: 10, sourceBranch: "feature/x" });
    expect(out[1]).toMatchObject({ direct: true, via: [], myVote: -5, groupVote: 0 });
    expect(out[0].url).toBe("https://sunucu/tfs/Col/Proje%20A/_git/repo/pullrequest/2");
  });
});

describe("onaylar ve reviewer'lar", () => {
  it("toApproval: bağlantı önce yanıttan, yoksa proje ve release id'sinden kurulur", () => {
    const raw = { id: 7, approvalType: "preDeploy", approver: { displayName: "Takım" }, release: { id: 41, name: "Release-41" }, releaseDefinition: { name: "cd" }, releaseEnvironment: { name: "PROD" } };
    expect(toApproval({ ...raw, __project: "Proje A" }, BASE)).toMatchObject({
      name: "cd",
      release: "Release-41",
      stage: "PROD",
      type: "preDeploy",
      approver: "Takım",
      project: "Proje A",
      url: "https://sunucu/tfs/Col/Proje%20A/_releaseProgress?releaseId=41",
    });
    expect(toApproval(raw, BASE).url).toBeUndefined();
    const linked = { ...raw, release: { ...raw.release, _links: { web: { href: "https://sunucu/x" } } } };
    expect(toApproval(linked, BASE).url).toBe("https://sunucu/x");
  });
  it("PR reviewer'ları oylarıyla taşınır", () => {
    const [p] = mergeReviewPrs(
      [[pr(1, "x", [{ id: ME, displayName: "Ben", vote: 10, isRequired: true }, { id: "g", displayName: "Takım" }, { id: "adsiz" }])]],
      ME,
      new Set(),
      BASE,
    );
    expect(p.reviewers).toEqual([
      { name: "Ben", vote: 10, required: true },
      { name: "Takım", vote: 0, required: false },
    ]);
  });
});

describe("runs", () => {
  it("build: tamamlananda sonuç, sürende durum gösterilir", () => {
    expect(toBuildRun({ id: 1, status: "completed", result: "failed" })).toMatchObject({ status: "failed", tone: "failed" });
    expect(toBuildRun({ id: 1, status: "inProgress" })).toMatchObject({ status: "inProgress", tone: "running" });
    expect(toBuildRun({ id: 1, _links: { web: { href: "javascript:alert(1)" } } }).url).toBeUndefined();
  });
  it("release rengi aşamalardan gelir", () => {
    const tone = (...s: string[]) => toReleaseRun({ id: 1, environments: s.map((status, i) => ({ name: `e${i}`, status })) }).tone;
    expect(tone("succeeded", "rejected", "notStarted")).toBe("failed");
    expect(tone("succeeded", "inProgress", "notStarted")).toBe("running");
    expect(tone("succeeded", "succeeded")).toBe("ok");
    expect(tone("succeeded", "notStarted")).toBe("neutral");
  });
});

describe("yardımcılar", () => {
  it("safeHref yalnızca http(s) kabul eder", () => {
    expect(safeHref("https://a/b")).toBe("https://a/b");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
  it("matches Türkçe büyük/küçük harfle arar", () => {
    expect(matches("İBAN", "iban doğrulama")).toBe(true);
    expect(matches("", undefined)).toBe(true);
    expect(matches("x", "abc", 12)).toBe(false);
    expect(matches("12", "abc", 12)).toBe(true);
  });
  it("ago", () => {
    const u = { now: "şimdi", m: "dk", h: "sa", d: "g" };
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(ago("2026-11-10T11:59:30Z", now, u)).toBe("şimdi");
    expect(ago("2026-11-10T09:00:00Z", now, u)).toBe("3 sa");
    expect(ago("2026-11-07T12:00:00Z", now, u)).toBe("3 g");
    expect(ago(undefined, now, u)).toBe("");
  });
  it("mapLimit sırayı korur ve sınırı aşmaz", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe("createRestSource", () => {
  /** Adres parçasına göre yanıt veren sahte sunucu; eşleşmeyen her şey 404. */
  function server(routes: Record<string, unknown>) {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      return key
        ? new Response(JSON.stringify(routes[key]), { status: 200 })
        : new Response(JSON.stringify({ message: "yok" }), { status: 404 });
    };
    return { calls, fetchFn };
  }

  it("grup üzerinden atanan PR'ları bulur; bir bölümün hatası diğerlerini bozmaz", async () => {
    const { calls, fetchFn } = server({
      "_apis/wit/wiql": { workItems: [] },
      "_apis/teams": { value: [{ id: TEAM }] },
      "queryMembership=Expanded": { value: [{ memberOf: ["Microsoft.TeamFoundation.Identity;S-1"] }] },
      "_apis/identities?descriptors": { value: [{ id: "dddd-4" }] },
      [`reviewerId=${ME}`]: { value: [] },
      "creatorId=": { value: [pr(3, ME, [])] },
      // Bütün aktif PR'ların taraması: yalnızca gruplarıma atananlar alınmalı.
      "status=active&$top=1000&$skip=0": {
        value: [
          pr(2, "y", [{ id: TEAM, displayName: "Takım" }]),
          pr(4, "z", [{ id: "DDDD-4", displayName: "Reviewers" }]),
          pr(5, "z", [{ id: "baska-grup", displayName: "Başka" }]),
          pr(6, ME, [{ id: TEAM, displayName: "Takım" }]),
        ],
      },
      "P%201/_apis/build/builds": { value: [{ id: 9, status: "completed", result: "succeeded", definition: { name: "ci" } }] },
      "_apis/projects": { value: [{ name: "P 1" }] },
      // Release collection düzeyinde boş dönerse de proje proje sorulur.
      "/Col/_apis/release/releases": { value: [] },
      "P%201/_apis/release/releases": { value: [{ id: 5, name: "Release-5" }] },
      "P%201/_apis/release/approvals": { value: [{ id: 70, approver: { displayName: "Takım" }, release: { id: 5, name: "Release-5" }, releaseEnvironment: { name: "PROD" } }] },
    });
    const source = createRestSource(BASE, async () => "t", ME, fetchFn);
    const data = await source.load({ includeClosed: false, includeCompletedPrs: false, from: "", to: "" });
    expect(data.assigned).toEqual({ items: [] });
    expect(data.myPrs.items.map((p) => p.id)).toEqual([3]);
    expect(data.reviewPrs.items.map((p) => [p.id, p.via])).toEqual([[4, ["Reviewers"]], [2, ["Takım"]]]);
    // Grup başına sorgu yapılmaz; build collection düzeyinde hiç denenmez.
    expect(calls.filter((c) => c.includes("reviewerId=")).length).toBe(1);
    expect(calls.some((c) => c.includes("/Col/_apis/build/builds"))).toBe(false);
    expect(calls.filter((c) => c.includes("_apis/projects")).length).toBe(1);
    expect(data.builds.items[0]).toMatchObject({ name: "ci", tone: "ok" });
    expect(data.releases.items.map((r) => r.number)).toEqual(["Release-5"]);
    // Onaylar da proje proje sorulur ve proje adı eklenir.
    expect(data.approvals.items).toMatchObject([{ id: 70, stage: "PROD", project: "P 1", approver: "Takım" }]);
    expect(source.diagnostics!()).toMatchObject({ myTeams: 1, myGroups: 1, activePrsScanned: 4, releasesCollectionEmpty: true });
  });

  it("istenirse tamamlanan PR'ları da getirir", async () => {
    const done = { ...pr(7, "x", [{ id: ME, vote: 10 }]), status: "completed", closedDate: "2026-11-09T00:00:00Z" };
    const { fetchFn } = server({
      [`status=completed&searchCriteria.reviewerId=${ME}`]: { value: [done] },
      [`status=completed&searchCriteria.creatorId=${ME}`]: { value: [{ ...pr(8, ME, []), status: "completed" }] },
      "_apis/git/pullrequests": { value: [] },
    });
    const source = createRestSource(BASE, async () => "t", ME, fetchFn);
    const off = await source.load({ includeClosed: false, includeCompletedPrs: false, from: "", to: "" });
    expect(off.reviewPrs.items).toEqual([]);
    expect(off.myPrs.items).toEqual([]);
    const on = await source.load({ includeClosed: false, includeCompletedPrs: true, from: "", to: "" });
    expect(on.reviewPrs.items[0]).toMatchObject({ id: 7, status: "completed", myVote: 10, direct: true });
    expect(on.myPrs.items[0]).toMatchObject({ id: 8, status: "completed" });
  });

  it("üyelikleri ve proje listesini önbellekten kullanır; work item yüklemesi yalnızca iki sorgu atar", async () => {
    const { calls, fetchFn } = server({
      "_apis/wit/wiql": { workItems: [{ id: 1 }] },
      "_apis/wit/workitemsbatch": { value: [{ id: 1, fields: { "System.Title": "bir" } }] },
      "_apis/teams": { value: [{ id: TEAM }] },
      "queryMembership=Expanded": { value: [{ memberOf: ["Microsoft.TeamFoundation.Identity;S-1"] }] },
      "_apis/identities?descriptors": { value: [{ id: "dddd-4" }] },
      "_apis/git/pullrequests": { value: [] },
      "_apis/projects": { value: [{ name: "P" }] },
      "P/_apis/build/builds": { value: [] },
      "_apis/release/releases": { value: [] },
    });
    const source = createRestSource(BASE, async () => "t", ME, fetchFn);
    const options = { includeClosed: false, includeCompletedPrs: false, from: "", to: "" };
    const count = (part: string) => calls.filter((c) => c.includes(part)).length;
    await source.load(options);
    await source.load(options);
    expect(count("_apis/teams")).toBe(1);
    expect(count("_apis/identities")).toBe(2);
    expect(count("_apis/projects")).toBe(1);
    expect(source.diagnostics!()).toMatchObject({ myTeams: 1, myGroups: 1, membershipCached: true });

    const before = calls.length;
    const part = await source.loadWorkItems(options);
    expect(part.assigned.items.map((w) => w.title)).toEqual(["bir"]);
    expect(Object.keys(part)).toEqual(["assigned", "created"]);
    // İki liste × (wiql + workitemsbatch).
    expect(calls.length - before).toBe(4);
    expect(calls.slice(before).every((c) => c.includes("_apis/wit/"))).toBe(true);
  });

  it("üyelik okunamadıysa önbelleğe almaz", async () => {
    const { calls, fetchFn } = server({ "_apis/teams": { value: [] }, "_apis/git/pullrequests": { value: [] } });
    const source = createRestSource(BASE, async () => "t", ME, fetchFn);
    const options = { includeClosed: false, includeCompletedPrs: false, from: "", to: "" };
    await source.load(options);
    await source.load(options);
    expect(calls.filter((c) => c.includes("_apis/teams")).length).toBe(2);
    expect(source.diagnostics!().membershipCached).toBeUndefined();
  });

  it("kişi seçilince sorgular o kişinin kimliğiyle yapılır", async () => {
    const bodies: string[] = [];
    const routes: Record<string, unknown> = {
      "_apis/wit/wiql": { workItems: [] },
      "queryMembership=Expanded": { value: [{ memberOf: ["Microsoft.TeamFoundation.Identity;S-1"] }] },
      "_apis/identities?descriptors": { value: [{ id: "dddd-4" }] },
      "creatorId=kisi-9": { value: [pr(3, "kisi-9", [])] },
      "status=active&$top=1000&$skip=0": { value: [pr(4, "z", [{ id: "DDDD-4", displayName: "Reviewers" }, { id: "KISI-9", vote: 5 }])] },
      "_apis/git/pullrequests": { value: [] },
      "_apis/projects": { value: [{ name: "P" }] },
      "requestedFor=kisi-9": { value: [{ id: 9, status: "completed", result: "succeeded" }] },
      "createdBy=kisi-9": { value: [{ id: 5, name: "Release-5" }] },
    };
    const calls: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (typeof init?.body === "string") bodies.push(init.body);
      const key = Object.keys(routes).find((k) => url.includes(k));
      return key ? new Response(JSON.stringify(routes[key])) : new Response("{}", { status: 404 });
    };
    const source = createRestSource(BASE, async () => "t", ME, fetchFn);
    const person = { id: "kisi-9", name: "Ayşe Demir", account: "ORNEK\\ayse" };
    const data = await source.load({ includeClosed: true, includeCompletedPrs: false, from: "", to: "", person });
    expect(bodies.every((b) => b.includes("'Ayşe Demir <ORNEK\\\\ayse>'") && !b.includes("@Me"))).toBe(true);
    expect(data.myPrs.items.map((p) => p.id)).toEqual([3]);
    expect(data.reviewPrs.items[0]).toMatchObject({ id: 4, myVote: 5, direct: true, via: ["Reviewers"] });
    expect(data.builds.items.length).toBe(1);
    expect(data.releases.items.length).toBe(1);
    // Kendi kimliğimle sorgu yapılmaz; takımlarım ($mine) başkası için sorulmaz.
    expect(calls.some((c) => c.includes(ME))).toBe(false);
    expect(calls.some((c) => c.includes("_apis/teams"))).toBe(false);
    expect(calls.some((c) => c.includes("identityIds=kisi-9"))).toBe(true);
    expect(source.diagnostics!().viewingOther).toBe(true);
  });

  it("searchPeople: önce sayfanın servisi, sonra REST kişi seçici, en son tam eşleşme denenir", async () => {
    const picked = { entityType: "User", localId: "9", displayName: "Ayşe Demir", scopeName: "ORNEK", samAccountName: "ayse" };
    const exact = { "searchFilter=General": { value: [{ id: "1", providerDisplayName: "Tam Eşleşen" }] } };

    // 1. Sayfanın servisi sonuç verirse hiç istek atılmaz.
    const host = server(exact);
    const viaHost = createRestSource(BASE, async () => "t", ME, host.fetchFn, async () => [picked]);
    expect(await viaHost.searchPeople(" a ")).toEqual([]);
    expect(await viaHost.searchPeople("ayş")).toEqual([{ id: "9", name: "Ayşe Demir", account: "ORNEK\\ayse" }]);
    expect(host.calls.length).toBe(0);
    expect(viaHost.diagnostics!().peopleSearch).toBe("host");

    // 2. Servis hata verirse REST kişi seçiciye düşülür.
    const rest = server({ "_apis/IdentityPicker/Identities": { results: [{ identities: [picked] }] }, ...exact });
    const viaRest = createRestSource(BASE, async () => "t", ME, rest.fetchFn, async () => {
      throw new Error("servis yok");
    });
    expect((await viaRest.searchPeople("ayş")).map((p) => p.id)).toEqual(["9"]);
    expect(viaRest.diagnostics!()).toMatchObject({ peopleSearch: "picker", peopleSearchErrors: { host: "servis yok" } });

    // 3. İkisi de çalışmazsa tam eşleşme araması kullanılır ve metin kodlanır.
    const old = server(exact);
    const viaExact = createRestSource(BASE, async () => "t", ME, old.fetchFn);
    expect(await viaExact.searchPeople("ay&şe")).toEqual([{ id: "1", name: "Tam Eşleşen", account: "" }]);
    expect(old.calls.some((c) => c.includes("filterValue=ay%26%C5%9Fe&"))).toBe(true);
    expect(viaExact.diagnostics!().peopleSearch).toBe("exact");

    // Hiçbiri çalışmazsa hata, çalışıp bulamazsa boş liste.
    await expect(createRestSource(BASE, async () => "t", ME, server({}).fetchFn).searchPeople("ayş")).rejects.toThrow("404");
    const none = server({ "searchFilter=General": { value: [] } });
    expect(await createRestSource(BASE, async () => "t", ME, none.fetchFn).searchPeople("ayş")).toEqual([]);
  });

  it("bölüm hatasını bölümde taşır", async () => {
    const { fetchFn } = server({});
    const data = await createRestSource(BASE, async () => "t", ME, fetchFn).load({ includeClosed: false, includeCompletedPrs: false, from: "", to: "" });
    expect(data.assigned.error).toBe("HTTP 404: yok");
    expect(data.builds.error).toContain("404");
    expect(data.reviewPrs.error).toContain("404");
  });
});
