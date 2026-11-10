import "azure-devops-ui/Core/override.css";
import "./hub.css";

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import { CommonServiceIds, ILocationService } from "azure-devops-extension-api/Common/CommonServices";
import { IdentityServiceIds, IVssIdentityService } from "azure-devops-extension-api/Identities/IdentityService";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { Page } from "azure-devops-ui/Page";

import { createRestSource } from "./api";
import { firstCulture, pickLang, Strings, STRINGS } from "./i18n";
import { ago, filterByRange, matches, stateTone, toDateInput } from "./logic";
import { mockSource } from "./mock";
import { Approval, DataSource, MyWorkData, PeopleSearch, Person, PullRequest, RawPickerIdentity, Run, RunTone, Section, SectionKey, WorkItem } from "./types";

const REFRESH_MS = 5 * 60_000;
/** Tarih ya da seçenek değiştikten sonra yüklemeden önce beklenen süre. */
const OPTION_DELAY_MS = 500;
/** Azure DevOps'un kişi arama servisi bu sürede yanıt vermezse REST aramasına geçilir. */
const HOST_SEARCH_TIMEOUT_MS = 4000;
/** Kişi aramasında yazma durduktan sonra beklenen süre. */
const SEARCH_DELAY_MS = 300;
/** Sayfa açılışında tarih aralığı: son bu kadar gün. */
const DEFAULT_DAYS = 30;
/** Üç ana başlık ve altlarındaki listeler. */
const GROUPS: { key: keyof Strings["groups"]; tabs: SectionKey[] }[] = [
  { key: "workItems", tabs: ["assigned", "created"] },
  { key: "prs", tabs: ["myPrs", "reviewPrs"] },
  { key: "pipelines", tabs: ["builds", "releases", "approvals"] },
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

function prColumns(t: Strings, now: number, review: boolean, other: boolean): Column<PullRequest>[] {
  const voteTone = (v: number): RunTone => (v > 0 ? "ok" : v === -10 ? "failed" : v < 0 ? "warning" : "neutral");
  // Başkasının işlerine bakılırken oy üçüncü kişiyle yazılır ("Onayladı").
  const votes = other ? t.votesOther : t.votes;
  const voteHeader = other ? t.voteOther : t.col.myVote;
  // Kişinin kendi oyu yoksa ve grubu adına başka biri oy verdiyse o gösterilir.
  const voteLabel = (p: PullRequest) =>
    p.myVote !== 0 ? (votes[String(p.myVote)] ?? String(p.myVote)) : (t.groupVotes[String(p.groupVote)] ?? votes["0"]);
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
  if (!review) {
    // Açan kişi PR'ın kimde beklediğini görsün: her reviewer oyunun renginde bir rozet.
    columns.push({
      header: t.col.reviewers,
      cell: (p) => (
        <div className="mw-stages">
          {p.reviewers.map((r) => (
            <span
              key={r.name}
              className={`mw-badge mw-tone-${voteTone(r.vote)}`}
              title={`${t.votesOther[String(r.vote)] ?? r.vote}${r.required ? ` · ${t.required}` : ""}`}
            >
              {r.name}
            </span>
          ))}
        </div>
      ),
      text: (p) => p.reviewers.map((r) => `${r.name} ${t.votesOther[String(r.vote)] ?? ""}`).join(" "),
    });
  }
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
        header: voteHeader,
        cell: (p) => <Badge tone={voteTone(p.myVote || p.groupVote)}>{voteLabel(p)}</Badge>,
        text: voteLabel,
        filters: [{ label: voteHeader, value: voteLabel }],
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

function approvalColumns(t: Strings, now: number): Column<Approval>[] {
  const typeLabel = (a: Approval) => t.approvalTypes[a.type.toLowerCase()] ?? a.type;
  return [
    {
      header: t.col.pipeline,
      cell: (a) => (
        <>
          <div>{a.name}</div>
          <div className="mw-muted">{a.project}</div>
        </>
      ),
      text: (a) => `${a.name} ${a.project}`,
      filters: [{ label: t.col.pipeline, value: (a) => a.name }],
    },
    { header: t.col.release, cell: (a) => <Link href={a.url}>{a.release}</Link>, text: (a) => a.release, className: "mw-nowrap" },
    {
      header: t.col.stage,
      cell: (a) => <Badge tone="warning">{a.stage}</Badge>,
      text: (a) => a.stage,
      filters: [{ label: t.col.stage, value: (a) => a.stage }],
    },
    { header: t.col.approvalType, cell: typeLabel, text: typeLabel },
    // Onay kişiye doğrudan ya da üyesi olduğu bir gruba atanmış olabilir.
    { header: t.col.approver, cell: (a) => a.approver, text: (a) => a.approver, className: "mw-wide" },
    { header: t.col.waiting, cell: (a) => ago(a.time, now, t.units), className: "mw-nowrap mw-muted" },
  ];
}

function SectionView(props: { tab: SectionKey; data: MyWorkData; query: string; now: number; other: boolean }) {
  const { tab, data, query, now, other } = props;
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
          columns={prColumns(t, now, tab === "reviewPrs", other)}
          query={query}
          rowKey={(p) => `${p.project}/${p.repo}/${p.id}`}
        />
      );
    case "approvals":
      return (
        <Table
          key={tab}
          section={data[tab]}
          columns={approvalColumns(t, now)}
          query={query}
          rowKey={(a) => `${a.project}/${a.id}`}
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

/** Başka birinin işlerine bakmak için kişi arama kutusu; seçim yapılınca kişinin adı ve geri dönüş düğmesi görünür. */
function PersonPicker(props: { source: DataSource; person: Person | null; onChange: (person: Person | null) => void }) {
  const t = useStrings();
  const { source, person, onChange } = props;
  const [text, setText] = React.useState("");
  const [results, setResults] = React.useState<Person[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Yazma durduktan kısa süre sonra aranır; eski bir aramanın yanıtı yenisinin üzerine yazmaz.
  React.useEffect(() => {
    const query = text.trim();
    setError(null);
    if (query.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    let stale = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      source.searchPeople(query).then(
        (found) => {
          if (stale) return;
          setResults(found);
          setSearching(false);
        },
        (e) => {
          if (stale) return;
          setResults(null);
          setSearching(false);
          setError(e instanceof Error ? e.message : String(e));
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [text, source]);

  if (person) {
    return (
      <div className="mw-person">
        <span className="mw-person-chip">
          <span>{t.viewing(person.name)}</span>
          <button className="mw-clear" onClick={() => onChange(null)}>
            {t.backToMe}
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="mw-person">
      <span className="mw-muted">{t.person}</span>
      <div className="mw-person-box">
        <input
          className="mw-search mw-person-input"
          type="search"
          value={text}
          placeholder={t.personSearch}
          aria-label={t.personSearch}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setText("")}
        />
        {(searching || results || error) && (
          <div className="mw-person-list" role="listbox">
            {error && <div className="mw-person-note mw-count-error">{t.personError(error)}</div>}
            {searching && !results && <div className="mw-person-note">{t.personSearching}</div>}
            {results && results.length === 0 && <div className="mw-person-note">{t.personNone}</div>}
            {(results ?? []).map((p) => (
              <button
                key={p.id}
                role="option"
                aria-selected={false}
                className="mw-person-option"
                onClick={() => {
                  setText("");
                  onChange(p);
                }}
              >
                <span>{p.name}</span>
                {p.account && <span className="mw-muted">{p.account}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function App({ source, demo, extra }: { source: DataSource; demo: boolean; extra?: Record<string, unknown> }) {
  const t = useStrings();
  const [raw, setData] = React.useState<MyWorkData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [updated, setUpdated] = React.useState<Date | null>(null);
  const [selectedTab, setTab] = React.useState<SectionKey>("assigned");
  const [query, setQuery] = React.useState("");
  const [includeClosed, setIncludeClosed] = React.useState(false);
  const [includeCompletedPrs, setIncludeCompletedPrs] = React.useState(false);
  // Başkasının işlerine bakılıyorsa o kişi; null ise oturum açan kullanıcı.
  const [person, setPerson] = React.useState<Person | null>(null);
  // Tarih aralığı, tarih alanının biçiminde (YYYY-AA-GG); boş bırakılan uç sınırsızdır.
  const [from, setFrom] = React.useState(() => toDateInput(Date.now() - DEFAULT_DAYS * 86_400_000));
  const [to, setTo] = React.useState(() => toDateInput(Date.now()));
  // Yüklemeler seçeneklerin son halini buradan okur; seçenek değişince yükleme fonksiyonları yeniden kurulmaz.
  const current = { includeClosed, includeCompletedPrs, from, to, person: person ?? undefined };
  const opts = React.useRef(current);
  opts.current = current;
  // Eski bir yüklemenin yanıtı yenisinin üzerine yazmasın: tam yükleme ve work item yüklemesi ayrı sayılır.
  const fullId = React.useRef(0);
  const workItemsId = React.useRef(0);
  const pending = React.useRef(0);
  const lastFull = React.useRef(0);
  const hasData = React.useRef(false);
  hasData.current = raw !== null;

  const track = React.useCallback(async (run: () => Promise<void>) => {
    pending.current++;
    setLoading(true);
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (--pending.current === 0) setLoading(false);
    }
  }, []);

  /** Altı listeyi de yeniden okur. */
  const load = React.useCallback(
    (fresh = false) =>
      track(async () => {
        const id = ++fullId.current;
        const workItemsAtStart = workItemsId.current;
        lastFull.current = Date.now();
        const result = await source.load({ ...opts.current, fresh }).catch((e) => {
          if (id !== fullId.current) return null;
          throw e;
        });
        if (!result || id !== fullId.current) return;
        // Bu sırada work item'lar daha yeni seçeneklerle okunduysa onların sonucu korunur.
        setData((prev) =>
          prev && workItemsAtStart !== workItemsId.current
            ? { ...result, assigned: prev.assigned, created: prev.created }
            : result,
        );
        setError(null);
        setUpdated(new Date());
      }),
    [source, track],
  );

  /** Yalnızca iki work item listesini okur: tarih ve "kapalıları göster" sunucuda yalnızca onları etkiler. */
  const loadWorkItems = React.useCallback(
    () =>
      track(async () => {
        const id = ++workItemsId.current;
        const part = await source.loadWorkItems(opts.current).catch((e) => {
          if (id !== workItemsId.current) return null;
          throw e;
        });
        if (!part || id !== workItemsId.current) return;
        setData((prev) => (prev ? { ...prev, ...part } : prev));
      }),
    [source, track],
  );

  // Tam yükleme: açılışta, 5 dakikada bir, kişi ya da tamamlanan PR seçeneği değişince. Sekme arka plandayken
  // istek atılmaz; sekmeye dönüldüğünde veri eskidiyse bir kez yenilenir.
  React.useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastFull.current >= REFRESH_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, includeCompletedPrs, person]);

  // Tarih ya da "kapalıları göster" değişince yalnızca work item'lar yeniden okunur; tarih alanında
  // gezinirken her değişiklikte istek atılmasın diye kısa bir süre beklenir.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => (hasData.current ? loadWorkItems() : load()), OPTION_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [from, to, includeClosed, load, loadWorkItems]);

  const now = Date.now();
  // Sekme sayıları da tarih filtresini izlesin diye filtre veriye burada uygulanır.
  const data = raw && filterByRange(raw, from, to);
  // Sunucunun okutmadığı liste (ör. onaylar) sekmelerde hiç görünmez; seçiliyse başlığın ilk listesine dönülür.
  const selectedGroup = GROUPS.find((g) => g.tabs.includes(selectedTab)) ?? GROUPS[0];
  const tab = raw?.[selectedTab].unavailable ? selectedGroup.tabs[0] : selectedTab;
  const tabsOf = (g: (typeof GROUPS)[number]) => g.tabs.filter((k) => !raw?.[k].unavailable);
  const group = selectedGroup;
  // Tarih aralığının bu listede gizlediği kayıt sayısı; "0 kayıt" yanlış anlaşılmasın diye bildirilir.
  const hiddenByDate = raw && data ? raw[tab].items.length - data[tab].items.length : 0;
  const isWorkItems = group.key === "workItems";
  const isPrs = group.key === "prs";
  const tabNames = person ? t.tabsOther : t.tabs;
  const count = (k: SectionKey) => (data?.[k].error ? "!" : (data?.[k].items.length ?? 0));

  return (
    <Page className="mw-page">
      <Header
        title={person ? t.titleOf(person.name) : t.title}
        titleSize={TitleSize.Large}
        description={updated ? t.lastUpdated(updated.toLocaleTimeString(t.locale)) : undefined}
        commandBarItems={[
          {
            id: "refresh",
            text: loading ? t.refreshing : t.refresh,
            iconProps: { iconName: "Refresh" },
            disabled: loading,
            onActivate: () => {
              // Yenile düğmesi önbellekteki onay listesini de yeniden okutur.
              load(true);
            },
          },
        ]}
      />
      <div className="mw-content">
        {demo && <MessageCard severity={MessageCardSeverity.Info}>{t.demoData}</MessageCard>}
        <PersonPicker
          source={source}
          person={person}
          onChange={(p) => {
            // Önceki kişinin listeleri yeni başlığın altında görünmesin.
            setData(null);
            setError(null);
            setPerson(p);
          }}
        />
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
                    {tabsOf(g).map((k) => `${tabNames[k]} ${count(k)}`).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
            <div className="mw-subtabs" role="tablist">
              {tabsOf(group).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={`mw-subtab${tab === k ? " mw-subtab-active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {tabNames[k]}
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
              <div className="mw-range">
                <span className="mw-muted">{t.dateRange}</span>
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  aria-label={t.dateFrom}
                  title={t.dateFrom}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <span className="mw-muted">–</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  aria-label={t.dateTo}
                  title={t.dateTo}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
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
              {hiddenByDate > 0 && (
                <div className="mw-muted mw-hidden-note">
                  {t.hiddenByDate(hiddenByDate)}
                  <button className="mw-clear" onClick={() => setFrom("")}>
                    {t.showAllDates}
                  </button>
                </div>
              )}
              <SectionView tab={tab} data={data} query={query} now={now} other={!!person} />
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

/** Söz verilen süre içinde sonuçlanmazsa hata verir. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
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
    // Azure DevOps'un kendi kişi arama servisi: ada göre önekle arar. Servis bu sunucuda yoksa ya da
    // yanıt vermezse kaynak REST aramasına düşer.
    let identityService: Promise<IVssIdentityService> | undefined;
    const hostSearch: PeopleSearch = (query) =>
      withTimeout(
        (identityService ??= SDK.getService<IVssIdentityService>(IdentityServiceIds.IdentityService)).then(
          (service) => service.searchIdentitiesAsync(query, ["user"], ["ims"]) as Promise<RawPickerIdentity[]>,
        ),
        HOST_SEARCH_TIMEOUT_MS,
      );
    const source = createRestSource(baseUrl, () => SDK.getAccessToken(), userId, undefined, hostSearch);
    render(source, false, culture, { extensionVersion: SDK.getExtensionContext()?.version, culture: culture ?? null });
    await SDK.notifyLoadSucceeded();
  } catch (e) {
    await SDK.notifyLoadFailed(e instanceof Error ? e : String(e));
  }
}

start();
