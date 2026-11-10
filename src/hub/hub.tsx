import "azure-devops-ui/Core/override.css";
import "./hub.css";

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, ILocationService } from "azure-devops-extension-api/Common/CommonServices";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Page } from "azure-devops-ui/Page";

import { createRestSource } from "./api";
import { firstCulture, pickLang, Strings, STRINGS } from "./i18n";
import { ago, matches, stateTone } from "./logic";
import { mockSource } from "./mock";
import { DataSource, MyWorkData, PullRequest, Run, RunTone, Section, SectionKey, WorkItem } from "./types";

const REFRESH_MS = 5 * 60_000;
/** Üç ana başlık; her birinin altında iki liste var. */
const GROUPS: { key: keyof Strings["groups"]; tabs: SectionKey[] }[] = [
  { key: "workItems", tabs: ["assigned", "created"] },
  { key: "prs", tabs: ["myPrs", "reviewPrs"] },
  { key: "pipelines", tabs: ["builds", "releases"] },
];

const I18n = React.createContext<Strings>(STRINGS.en);
const useStrings = () => React.useContext(I18n);

interface Column<T> {
  header: string;
  /** Hücrede görünen içerik. */
  cell: (row: T) => React.ReactNode;
  /** Aramada kullanılan metin. */
  text?: (row: T) => string | number | undefined;
  /** Bu sütun için açılır filtreler; seçenekler listedeki değerlerden üretilir. */
  filters?: { label: string; value: (row: T) => string | undefined }[];
  className?: string;
}

function Link({ href, children }: { href?: string; children: React.ReactNode }) {
  return href ? (
    <a className="mw-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

function Badge({ tone, children }: { tone: RunTone; children: React.ReactNode }) {
  return <span className={`mw-badge mw-tone-${tone}`}>{children}</span>;
}

function Table<T>(props: { section: Section<T>; columns: Column<T>[]; query: string; rowKey: (row: T) => string }) {
  const t = useStrings();
  const { section, columns, query } = props;
  // Seçili filtre değerleri, filtre etiketine göre. Sekme değişince Table yeniden kurulur ve sıfırlanır.
  const [selected, setSelected] = React.useState<Record<string, string>>({});
  if (section.error) {
    return <MessageCard severity={MessageCardSeverity.Error}>{t.sectionError(section.error)}</MessageCard>;
  }
  if (section.items.length === 0) return <div className="mw-empty">{t.empty}</div>;
  const filters = columns.flatMap((c) => c.filters ?? []);
  const rows = section.items.filter(
    (r) =>
      matches(query, ...columns.map((c) => c.text?.(r))) &&
      filters.every((f) => !selected[f.label] || f.value(r) === selected[f.label]),
  );
  const options = (f: (typeof filters)[number]) =>
    [...new Set(section.items.map((r) => f.value(r)).filter((v): v is string => !!v))].sort((a, b) =>
      a.localeCompare(b, t.locale),
    );
  return (
    <>
      {section.truncated && <div className="mw-muted mw-note">{t.truncated}</div>}
      <div className="mw-filters">
        {filters.map((f) => (
          <label key={f.label} className="mw-filter">
            <span className="mw-muted">{f.label}</span>
            <select
              className={selected[f.label] ? "mw-filter-on" : undefined}
              value={selected[f.label] ?? ""}
              onChange={(e) => setSelected({ ...selected, [f.label]: e.target.value })}
            >
              <option value="">{t.all}</option>
              {options(f).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ))}
        {Object.values(selected).some(Boolean) && (
          <button className="mw-clear" onClick={() => setSelected({})}>
            {t.clearFilters}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="mw-empty">{t.noMatches}</div>
      ) : (
        <div className="mw-table-wrap">
          <table className="mw-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.header} className={c.className}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={props.rowKey(r)}>
                  {columns.map((c) => (
                    <td key={c.header} className={c.className}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function workItemColumns(t: Strings, now: number, person: "assignedTo" | "createdBy"): Column<WorkItem>[] {
  return [
    { header: t.col.id, cell: (w) => <Link href={w.url}>{w.id}</Link>, text: (w) => w.id, className: "mw-nowrap" },
    {
      header: t.col.type,
      cell: (w) => w.type,
      text: (w) => w.type,
      filters: [{ label: t.col.type, value: (w) => w.type }],
      className: "mw-nowrap",
    },
    { header: t.col.title, cell: (w) => <Link href={w.url}>{w.title}</Link>, text: (w) => w.title, className: "mw-wide" },
    {
      header: t.col.state,
      cell: (w) => <Badge tone={stateTone(w.state)}>{w.state}</Badge>,
      text: (w) => w.state,
      filters: [{ label: t.col.state, value: (w) => w.state }],
    },
    {
      header: t.col.project,
      cell: (w) => w.project,
      text: (w) => w.project,
      filters: [{ label: t.col.project, value: (w) => w.project }],
    },
    person === "assignedTo"
      ? {
          header: t.col.assignedTo,
          cell: (w) => w.assignedTo ?? <span className="mw-muted">{t.unassigned}</span>,
          text: (w) => w.assignedTo,
          filters: [{ label: t.col.assignedTo, value: (w) => w.assignedTo ?? t.unassigned }],
        }
      : {
          header: t.col.createdBy,
          cell: (w) => w.createdBy,
          text: (w) => w.createdBy,
          filters: [{ label: t.col.createdBy, value: (w) => w.createdBy }],
        },
    { header: t.col.changed, cell: (w) => ago(w.changedDate, now, t.units), className: "mw-nowrap mw-muted" },
  ];
}

function prColumns(t: Strings, now: number, review: boolean): Column<PullRequest>[] {
  const voteTone = (v: number): RunTone => (v > 0 ? "ok" : v === -10 ? "failed" : v < 0 ? "warning" : "neutral");
  // Kendi oyum yoksa ve grubum adına başka biri oy verdiyse o gösterilir.
  const voteLabel = (p: PullRequest) =>
    p.myVote !== 0
      ? (t.votes[String(p.myVote)] ?? String(p.myVote))
      : (t.groupVotes[String(p.groupVote)] ?? t.votes["0"]);
  const columns: Column<PullRequest>[] = [
    { header: t.col.id, cell: (p) => <Link href={p.url}>!{p.id}</Link>, text: (p) => p.id, className: "mw-nowrap" },
    {
      header: t.col.title,
      cell: (p) => (
        <>
          <Link href={p.url}>{p.title}</Link>
          {p.isDraft && <span className="mw-badge mw-tone-neutral mw-gap">{t.draft}</span>}
          {p.status === "completed" && <span className="mw-badge mw-tone-ok mw-gap">{t.completed}</span>}
        </>
      ),
      text: (p) => `${p.title} ${p.status === "completed" ? t.completed : ""}`,
      className: "mw-wide",
    },
    {
      header: t.col.repo,
      cell: (p) => (
        <>
          <div>{p.repo}</div>
          <div className="mw-muted">{p.project}</div>
        </>
      ),
      text: (p) => `${p.repo} ${p.project}`,
      filters: [
        { label: t.col.project, value: (p) => p.project },
        { label: t.col.repo, value: (p) => p.repo },
      ],
    },
    {
      header: t.col.branches,
      cell: (p) => (
        <span className="mw-mono">
          {p.sourceBranch} → {p.targetBranch}
        </span>
      ),
      text: (p) => `${p.sourceBranch} ${p.targetBranch}`,
    },
  ];
  if (review) {
    columns.push(
      {
        header: t.col.createdBy,
        cell: (p) => p.creator,
        text: (p) => p.creator,
        filters: [{ label: t.col.createdBy, value: (p) => p.creator }],
      },
      {
        header: t.col.assignedVia,
        // Hem doğrudan hem grup üzerinden atanmış olabilir; ikisi de gösterilir.
        cell: (p) => [...(p.direct ? [t.direct] : []), ...p.via].join(", "),
        text: (p) => p.via.join(" "),
      },
      {
        header: t.col.myVote,
        cell: (p) => <Badge tone={voteTone(p.myVote || p.groupVote)}>{voteLabel(p)}</Badge>,
        text: voteLabel,
        filters: [{ label: t.col.myVote, value: voteLabel }],
      },
    );
  }
  columns.push({ header: t.col.when, cell: (p) => ago(p.createdDate, now, t.units), className: "mw-nowrap mw-muted" });
  return columns;
}

function runColumns(t: Strings, now: number, release: boolean): Column<Run>[] {
  const label = (s: string) => t.status[s.toLowerCase()] ?? s;
  return [
    {
      header: t.col.pipeline,
      cell: (r) => (
        <>
          <div>{r.name}</div>
          <div className="mw-muted">{r.project}</div>
        </>
      ),
      text: (r) => `${r.name} ${r.project}`,
      filters: [
        { label: t.col.project, value: (r) => r.project },
        { label: t.col.pipeline, value: (r) => r.name },
      ],
    },
    { header: t.col.run, cell: (r) => <Link href={r.url}>{r.number}</Link>, text: (r) => r.number, className: "mw-nowrap" },
    release
      ? {
          header: t.col.stages,
          cell: (r) => (
            <div className="mw-stages">
              {(r.stages ?? []).map((s) => (
                <span key={s.name} className={`mw-badge mw-tone-${s.tone}`} title={label(s.status)}>
                  {s.name}
                </span>
              ))}
            </div>
          ),
          text: (r) => (r.stages ?? []).map((s) => `${s.name} ${label(s.status)}`).join(" "),
          className: "mw-wide",
        }
      : { header: t.col.branch, cell: (r) => <span className="mw-mono">{r.branch}</span>, text: (r) => r.branch, className: "mw-wide" },
    ...(release
      ? []
      : [
          {
            header: t.col.status,
            cell: (r: Run) => <Badge tone={r.tone}>{label(r.status)}</Badge>,
            text: (r: Run) => label(r.status),
            filters: [{ label: t.col.status, value: (r: Run) => label(r.status) }],
          },
        ]),
    { header: t.col.when, cell: (r) => ago(r.time, now, t.units), className: "mw-nowrap mw-muted" },
  ];
}

function SectionView({ tab, data, query, now }: { tab: SectionKey; data: MyWorkData; query: string; now: number }) {
  const t = useStrings();
  switch (tab) {
    case "assigned":
    case "created":
      return (
        <Table
          key={tab}
          section={data[tab]}
          columns={workItemColumns(t, now, tab === "assigned" ? "createdBy" : "assignedTo")}
          query={query}
          rowKey={(w) => String(w.id)}
        />
      );
    case "myPrs":
    case "reviewPrs":
      return (
        <Table
          key={tab}
          section={data[tab]}
          columns={prColumns(t, now, tab === "reviewPrs")}
          query={query}
          rowKey={(p) => `${p.project}/${p.repo}/${p.id}`}
        />
      );
    default:
      return (
        <Table
          key={tab}
          section={data[tab]}
          columns={runColumns(t, now, tab === "releases")}
          query={query}
          rowKey={(r) => `${r.project}/${r.id}`}
        />
      );
  }
}

function App({ source, demo, extra }: { source: DataSource; demo: boolean; extra?: Record<string, unknown> }) {
  const t = useStrings();
  const [data, setData] = React.useState<MyWorkData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [updated, setUpdated] = React.useState<Date | null>(null);
  const [tab, setTab] = React.useState<SectionKey>("assigned");
  const [query, setQuery] = React.useState("");
  const [includeClosed, setIncludeClosed] = React.useState(false);
  const [includeCompletedPrs, setIncludeCompletedPrs] = React.useState(false);
  // Eski bir yüklemenin yanıtı yenisinin üzerine yazmasın.
  const loadId = React.useRef(0);

  const load = React.useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true);
    try {
      const result = await source.load({ includeClosed, includeCompletedPrs });
      if (id !== loadId.current) return;
      setData(result);
      setError(null);
      setUpdated(new Date());
    } catch (e) {
      if (id !== loadId.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [source, includeClosed, includeCompletedPrs]);

  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const now = Date.now();
  const group = GROUPS.find((g) => g.tabs.includes(tab)) ?? GROUPS[0];
  const isWorkItems = group.key === "workItems";
  const isPrs = group.key === "prs";
  const count = (k: SectionKey) => (data?.[k].error ? "!" : (data?.[k].items.length ?? 0));

  return (
    <Page className="mw-page">
      <Header
        title={t.title}
        titleSize={TitleSize.Large}
        description={updated ? t.lastUpdated(updated.toLocaleTimeString(t.locale)) : undefined}
        commandBarItems={[
          {
            id: "refresh",
            text: loading ? t.refreshing : t.refresh,
            iconProps: { iconName: "Refresh" },
            disabled: loading,
            onActivate: () => {
              load();
            },
          },
        ]}
      />
      <div className="mw-content">
        {demo && <MessageCard severity={MessageCardSeverity.Info}>{t.demoData}</MessageCard>}
        {error && <MessageCard severity={MessageCardSeverity.Error}>{t.loadError(error)}</MessageCard>}
        {!data && !error && <div className="mw-empty">{t.loading}</div>}
        {data && (
          <>
            <div className="mw-tabs" role="tablist">
              {GROUPS.map((g) => (
                <button
                  key={g.key}
                  role="tab"
                  aria-selected={group === g}
                  className={`mw-tab${group === g ? " mw-tab-active" : ""}`}
                  onClick={() => group !== g && setTab(g.tabs[0])}
                >
                  <span className="mw-tab-title">{t.groups[g.key]}</span>
                  <span className="mw-tab-label">
                    {g.tabs.map((k) => `${t.tabs[k]} ${count(k)}`).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
            <div className="mw-subtabs" role="tablist">
              {group.tabs.map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={`mw-subtab${tab === k ? " mw-subtab-active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {t.tabs[k]}
                  <span className={`mw-subtab-count${data[k].error ? " mw-count-error" : ""}`}>{count(k)}</span>
                </button>
              ))}
            </div>
            <div className="mw-toolbar">
              <input
                className="mw-search"
                type="search"
                value={query}
                placeholder={t.search}
                aria-label={t.search}
                onChange={(e) => setQuery(e.target.value)}
              />
              {isWorkItems && (
                <label className="mw-check">
                  <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
                  {t.includeClosed}
                </label>
              )}
              {isPrs && (
                <label className="mw-check">
                  <input
                    type="checkbox"
                    checked={includeCompletedPrs}
                    onChange={(e) => setIncludeCompletedPrs(e.target.checked)}
                  />
                  {t.includeCompletedPrs}
                </label>
              )}
            </div>
            <div className="mw-panel" role="tabpanel">
              <SectionView tab={tab} data={data} query={query} now={now} />
            </div>
            {source.diagnostics && (
              <details className="mw-diag">
                <summary>{t.diagnostics}</summary>
                <pre>{JSON.stringify({ ...source.diagnostics(), language: t.locale, ...extra }, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </Page>
  );
}

function render(source: DataSource, demo: boolean, culture: string | null | undefined, extra?: Record<string, unknown>) {
  const strings = STRINGS[pickLang(culture)];
  document.documentElement.lang = strings.locale.slice(0, 2);
  ReactDOM.render(
    <I18n.Provider value={strings}>
      <App source={source} demo={demo} extra={extra} />
    </I18n.Provider>,
    document.getElementById("root"),
  );
}

async function start() {
  // Azure DevOps dışında (npm run dev) açıldıysa örnek veriyle çalış; dil ?lang=tr|en ile seçilebilir.
  if (window.self === window.top) {
    render(mockSource, true, new URLSearchParams(window.location.search).get("lang") ?? navigator.language);
    return;
  }
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();
  try {
    const location = await SDK.getService<ILocationService>(CommonServiceIds.LocationService);
    const baseUrl = await location.getServiceLocation();
    // Azure DevOps Server 2022'de getPageContext() hata fırlatır; sırayla sayfa diline ve tarayıcı diline düşülür.
    const culture = firstCulture([
      () => SDK.getPageContext().globalization.culture,
      () => window.parent.document.documentElement.lang,
      () => navigator.language,
    ]);
    // Kullanıcı id'si SDK'dan gelmezse kaynak bunu sunucudan (connectionData) sorar.
    const userId = firstCulture([() => SDK.getUser().id]);
    const source = createRestSource(baseUrl, () => SDK.getAccessToken(), userId);
    render(source, false, culture, { extensionVersion: SDK.getExtensionContext()?.version, culture: culture ?? null });
    await SDK.notifyLoadSucceeded();
  } catch (e) {
    await SDK.notifyLoadFailed(e instanceof Error ? e : String(e));
  }
}

start();
