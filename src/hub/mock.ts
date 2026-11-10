import { mergeReviewPrs, toBuildRun, toPullRequest, toReleaseRun, toWorkItems } from "./logic";
import { DataSource, RawPullRequest, RawWorkItem } from "./types";

// `npm run dev` ile Azure DevOps dışında açıldığında kullanılan örnek veri.

const BASE = "https://ornek.invalid/tfs/DefaultCollection/";
const ME = "11111111-1111-1111-1111-111111111111";
const TEAM = "22222222-2222-2222-2222-222222222222";
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
const H = 3600;
const DAY = 86400;

const wi = (
  id: number,
  type: string,
  title: string,
  state: string,
  project: string,
  changed: number,
  assignedTo = "Emin Turan",
  createdBy = "Emin Turan",
): RawWorkItem => ({
  id,
  fields: {
    "System.Title": title,
    "System.WorkItemType": type,
    "System.State": state,
    "System.TeamProject": project,
    "System.AssignedTo": assignedTo ? { displayName: assignedTo } : undefined,
    "System.CreatedBy": { displayName: createdBy },
    "System.ChangedDate": ago(changed),
  },
});

const assigned = [
  wi(4812, "Bug", "Havale ekranında IBAN doğrulaması boşlukları kabul etmiyor", "Active", "MobilSube", 2 * H, "Emin Turan", "Ayşe Demir"),
  wi(4790, "Task", "Kart limit servisi için timeout değerlerini güncelle", "Active", "KartServisleri", 5 * H),
  wi(4755, "User Story", "Müşteri, katılım hesabı açılışını mobilden tamamlayabilir", "New", "MobilSube", DAY, "Emin Turan", "Mehmet Kaya"),
  wi(4701, "Task", "Pipeline'da SonarQube adımını zorunlu yap", "Resolved", "Platform", 3 * DAY),
];
const closedAssigned = [
  wi(4650, "Bug", "Login sonrası boş sayfa", "Closed", "MobilSube", 9 * DAY),
  wi(4644, "Test", "Test - Satınalma talep onay", "Tamamlandı", "Platform", 12 * DAY),
  wi(4630, "Analiz", "Analiz - Komisyon reeskont raporu", "iptal", "KartServisleri", 15 * DAY),
];
const created = [
  wi(4820, "Bug", "Release notlarında sürüm numarası yanlış", "New", "Platform", 1 * H, "Ali Yıldız"),
  wi(4790, "Task", "Kart limit servisi için timeout değerlerini güncelle", "Active", "KartServisleri", 5 * H),
  wi(4733, "Feature", "Agent havuzu izleme panosu", "Active", "Platform", 2 * DAY, ""),
];
const closedCreated = [wi(4600, "Task", "Eski build tanımlarını temizle", "Done", "Platform", 20 * DAY)];

const pr = (
  id: number,
  title: string,
  project: string,
  repo: string,
  creator: { id: string; displayName: string },
  source: string,
  target: string,
  created: number,
  reviewers: RawPullRequest["reviewers"],
  isDraft = false,
  status = "active",
): RawPullRequest => ({
  pullRequestId: id,
  title,
  createdBy: creator,
  creationDate: ago(created),
  sourceRefName: `refs/heads/${source}`,
  targetRefName: `refs/heads/${target}`,
  isDraft,
  status,
  closedDate: status === "completed" ? ago(created) : undefined,
  repository: { name: repo, project: { name: project } },
  reviewers,
});
const me = { id: ME, displayName: "Emin Turan" };

const myPrs = [
  pr(912, "IBAN doğrulamasında boşlukları temizle", "MobilSube", "mobil-api", me, "bugfix/4812-iban", "develop", 3 * H, []),
  pr(905, "Timeout ayarlarını konfigürasyona taşı", "KartServisleri", "kart-limit", me, "feature/4790-timeout", "main", 2 * DAY, [], true),
];
const completedMyPrs = [
  pr(880, "Health endpoint'ine sürüm bilgisi ekle", "MobilSube", "mobil-api", me, "feature/health-version", "develop", 6 * DAY, [], false, "completed"),
];
const completedReviewPrs = [
  pr(872, "Docker imajını distroless'a taşı", "Platform", "pipeline-templates", { id: "b", displayName: "Mehmet Kaya" }, "feature/distroless", "main", 8 * DAY, [
    { id: ME, displayName: "Emin Turan", vote: 10 },
  ], false, "completed"),
];
const reviewPrs = [
  pr(915, "Hesap açılış akışına kimlik doğrulama adımı", "MobilSube", "mobil-api", { id: "a", displayName: "Ayşe Demir" }, "feature/4755-kyc", "develop", 1 * H, [
    { id: ME, displayName: "Emin Turan", vote: 0 },
  ]),
  pr(910, "Sonar kalite kapısı şablonu", "Platform", "pipeline-templates", { id: "b", displayName: "Mehmet Kaya" }, "feature/sonar-gate", "main", 6 * H, [
    { id: TEAM, displayName: "[Platform]\\DevOps Takımı", isContainer: true, vote: 10 },
    { id: "d", displayName: "Zeynep Ak", vote: 10 },
  ]),
  pr(898, "Log formatını JSON'a çevir", "KartServisleri", "kart-limit", { id: "c", displayName: "Ali Yıldız" }, "feature/json-log", "main", 4 * DAY, [
    { id: TEAM, displayName: "[Platform]\\DevOps Takımı", isContainer: true, vote: 0 },
    { id: ME, displayName: "Emin Turan", vote: -5 },
  ]),
];

const link = (path: string) => ({ web: { href: BASE + path } });
const builds = [
  { id: 7301, buildNumber: "20261110.4", status: "inProgress", queueTime: ago(300), startTime: ago(240), sourceBranch: "refs/heads/bugfix/4812-iban", definition: { name: "mobil-api-ci" }, project: { name: "MobilSube" }, _links: link("MobilSube/_build/results?buildId=7301") },
  { id: 7288, buildNumber: "20261110.2", status: "completed", result: "failed", finishTime: ago(3 * H), sourceBranch: "refs/heads/bugfix/4812-iban", definition: { name: "mobil-api-ci" }, project: { name: "MobilSube" }, _links: link("MobilSube/_build/results?buildId=7288") },
  { id: 7240, buildNumber: "20261109.7", status: "completed", result: "succeeded", finishTime: ago(DAY), sourceBranch: "refs/heads/feature/4790-timeout", definition: { name: "kart-limit-ci" }, project: { name: "KartServisleri" }, _links: link("KartServisleri/_build/results?buildId=7240") },
  { id: 7199, buildNumber: "20261108.1", status: "completed", result: "partiallySucceeded", finishTime: ago(2 * DAY), sourceBranch: "refs/heads/main", definition: { name: "pipeline-templates-validate" }, project: { name: "Platform" }, _links: link("Platform/_build/results?buildId=7199") },
];
const releases = [
  { id: 410, name: "Release-58", status: "active", createdOn: ago(2 * H), releaseDefinition: { name: "mobil-api-cd" }, projectReference: { name: "MobilSube" }, environments: [{ name: "DEV", status: "succeeded" }, { name: "TEST", status: "inProgress" }, { name: "PROD", status: "notStarted" }], _links: link("MobilSube/_releaseProgress?releaseId=410") },
  { id: 398, name: "Release-21", status: "active", createdOn: ago(DAY), releaseDefinition: { name: "kart-limit-cd" }, projectReference: { name: "KartServisleri" }, environments: [{ name: "DEV", status: "succeeded" }, { name: "TEST", status: "rejected" }, { name: "PROD", status: "notStarted" }], _links: link("KartServisleri/_releaseProgress?releaseId=398") },
  { id: 380, name: "Release-57", status: "active", createdOn: ago(5 * DAY), releaseDefinition: { name: "mobil-api-cd" }, projectReference: { name: "MobilSube" }, environments: [{ name: "DEV", status: "succeeded" }, { name: "TEST", status: "succeeded" }, { name: "PROD", status: "succeeded" }], _links: link("MobilSube/_releaseProgress?releaseId=380") },
];

const items = (raw: RawWorkItem[]) =>
  toWorkItems(
    raw,
    raw.map((r) => r.id),
    BASE,
  );

export const mockSource: DataSource = {
  async load({ includeClosed, includeCompletedPrs }) {
    await new Promise((r) => setTimeout(r, 300));
    return {
      assigned: { items: items(includeClosed ? [...assigned, ...closedAssigned] : assigned) },
      created: { items: items(includeClosed ? [...created, ...closedCreated] : created) },
      myPrs: { items: (includeCompletedPrs ? [...myPrs, ...completedMyPrs] : myPrs).map((p) => toPullRequest(p, ME, new Set(), BASE)) },
      reviewPrs: { items: mergeReviewPrs([reviewPrs, includeCompletedPrs ? completedReviewPrs : []], ME, new Set([TEAM]), BASE) },
      builds: { items: builds.map(toBuildRun) },
      releases: { items: releases.map(toReleaseRun) },
    };
  },
};
