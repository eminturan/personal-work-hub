import { describe, expect, it } from "vitest";
import { createRestSource } from "../src/hub/api";
import { ago, mapLimit, matches, mergeReviewPrs, safeHref, stateTone, toBuildRun, toReleaseRun, toWorkItems, wiql } from "../src/hub/logic";
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
    });
    const source = createRestSource(BASE, async () => "t", ME, fetchFn);
    const data = await source.load({ includeClosed: false, includeCompletedPrs: false });
    expect(data.assigned).toEqual({ items: [] });
    expect(data.myPrs.items.map((p) => p.id)).toEqual([3]);
    expect(data.reviewPrs.items.map((p) => [p.id, p.via])).toEqual([[4, ["Reviewers"]], [2, ["Takım"]]]);
    // Grup başına sorgu yapılmaz; build collection düzeyinde hiç denenmez.
    expect(calls.filter((c) => c.includes("reviewerId=")).length).toBe(1);
    expect(calls.some((c) => c.includes("/Col/_apis/build/builds"))).toBe(false);
    expect(calls.filter((c) => c.includes("_apis/projects")).length).toBe(1);
    expect(data.builds.items[0]).toMatchObject({ name: "ci", tone: "ok" });
    expect(data.releases.items.map((r) => r.number)).toEqual(["Release-5"]);
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
    const off = await source.load({ includeClosed: false, includeCompletedPrs: false });
    expect(off.reviewPrs.items).toEqual([]);
    expect(off.myPrs.items).toEqual([]);
    const on = await source.load({ includeClosed: false, includeCompletedPrs: true });
    expect(on.reviewPrs.items[0]).toMatchObject({ id: 7, status: "completed", myVote: 10, direct: true });
    expect(on.myPrs.items[0]).toMatchObject({ id: 8, status: "completed" });
  });

  it("bölüm hatasını bölümde taşır", async () => {
    const { fetchFn } = server({});
    const data = await createRestSource(BASE, async () => "t", ME, fetchFn).load({ includeClosed: false, includeCompletedPrs: false });
    expect(data.assigned.error).toBe("HTTP 404: yok");
    expect(data.builds.error).toContain("404");
    expect(data.reviewPrs.error).toContain("404");
  });
});
