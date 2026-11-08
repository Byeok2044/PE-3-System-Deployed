import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight,
  Database, Download, FileCheck2, Filter, Search, SlidersHorizontal,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import BrandLogo from '../components/BrandLogo';
import '../styles/DatasetTransparency.css';

const VIEW_LABELS = { raw: 'Original data', cleaned: 'Cleaned data', excluded: 'Excluded records', risk: 'Model inputs', grade: 'Model inputs' };
const OUTCOMES = ['Dropout', 'Enrolled', 'Graduate', 'Unknown'];
const DEFAULT_COLUMNS = [
  'Source row', 'Preparation status', 'Exclusion reason',
  'Curricular units 1st sem (enrolled)', 'Curricular units 1st sem (approved)',
  'Semester 1 completion rate', 'Curricular units 1st sem (grade)',
  'Curricular units 2nd sem (grade)', 'Target',
];
const LABELS = {
  'Curricular units 1st sem (enrolled)': 'Sem 1 units enrolled',
  'Curricular units 1st sem (approved)': 'Sem 1 units approved',
  'Curricular units 1st sem (grade)': 'Sem 1 grade',
  'Curricular units 2nd sem (grade)': 'Sem 2 grade',
  'Semester 1 completion rate': 'Completion rate',
  Target: 'Historical outcome',
};
const labelFor = (column) => LABELS[column] || column.replace(/^numeric__/, 'Scaled · ').replace(/^study_schedule__/, 'Encoded · ');
const integer = (value) => Number(value).toLocaleString('en-US');
const number = (value, digits = 3) => value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
const valueFor = (value, column) => {
  if (value == null) return '—';
  if (column === 'Semester 1 completion rate') return `${number(value * 100, 2)}%`;
  return typeof value === 'number' ? number(value, 6) : String(value);
};
const makeQuery = (view, outcome, search) => new URLSearchParams({ view, outcome, search });

async function readJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.detail || 'The dataset could not be loaded.');
  return body;
}

export default function DatasetTransparency() {
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [reload, setReload] = useState(0);
  const [view, setView] = useState('cleaned');
  const [model, setModel] = useState('risk');
  const [outcome, setOutcome] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState(null);
  const [rowsError, setRowsError] = useState('');
  const [loadingRows, setLoadingRows] = useState(false);
  const [columnsByView, setColumnsByView] = useState({});
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const isModel = view === 'risk' || view === 'grade';

  useEffect(() => {
    const controller = new AbortController();
    setSummaryError('');
    fetch('/api/dataset/summary', { signal: controller.signal })
      .then(readJson).then(setSummary)
      .catch((error) => { if (error.name !== 'AbortError') setSummaryError(error.message); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!summary) return undefined;
    const controller = new AbortController();
    setLoadingRows(true);
    setData(null);
    setRowsError('');
    setDownloadError('');
    const query = makeQuery(view, outcome, search);
    query.set('page', page);
    query.set('pageSize', pageSize);
    fetch(`/api/dataset/rows?${query}`, { signal: controller.signal })
      .then(readJson)
      .then((body) => {
        if (controller.signal.aborted) return;
        // If a filter or source refresh shrinks the result set, return to its
        // last valid page rather than leaving a misleading empty table.
        const last = Math.max(1, Math.ceil(body.total / pageSize));
        if (page > last) setPage(last);
        else setData(body);
      })
      .catch((error) => { if (error.name !== 'AbortError') setRowsError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingRows(false); });
    return () => controller.abort();
  }, [summary, view, outcome, search, page, pageSize]);

  const allColumns = summary?.views[view]?.columns || [];
  const visibleColumns = columnsByView[view] || (isModel ? allColumns : allColumns.filter((col) => DEFAULT_COLUMNS.includes(col)));
  const counts = summary?.counts;
  const outcomeChart = useMemo(() => summary ? OUTCOMES.filter((label) => summary.outcomes.raw[label] || summary.outcomes.cleaned[label]).map((name) => ({
    name, Original: summary.outcomes.raw[name], Cleaned: summary.outcomes.cleaned[name],
  })) : [], [summary]);
  const ruleChart = useMemo(() => summary ? summary.rules.filter((rule) => rule.count > 0).map((rule) => ({ name: rule.id === 'enrollment' ? 'Zero / invalid enrollment' : rule.label, Records: rule.count })) : [], [summary]);
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  function chooseView(next) {
    setView(next);
    setPage(1);
    setSearchInput('');
    setSearch('');
  }

  function toggleColumn(column) {
    const current = visibleColumns;
    if (current.includes(column) && current.length === 1) return;
    setColumnsByView((previous) => ({
      ...previous,
      [view]: current.includes(column) ? current.filter((col) => col !== column) : allColumns.filter((col) => current.includes(col) || col === column),
    }));
  }

  async function download() {
    setDownloading(true);
    setDownloadError('');
    try {
      const response = await fetch(`/api/dataset/download?${makeQuery(view, outcome, search)}`);
      if (!response.ok) await readJson(response);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `retainify-dataset-${view}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setDownloadError(error.message || 'The download could not be completed.'); }
    finally { setDownloading(false); }
  }

  return (
    <div className="dataset-page">
      <header className="dataset-header">
        <BrandLogo />
        <span className="dataset-readonly"><FileCheck2 size={15} /> Dataset transparency</span>
        <Link to="/" className="dataset-home"><ArrowLeft size={16} /> Home</Link>
      </header>
      <main className="dataset-main">
        <section className="dataset-intro">
          <div className="dataset-eyebrow"><Database size={16} /> Historical research data</div>
          <h1>From source records to model inputs.</h1>
          <p>Explore the dataset behind Retainify, see which records pass the preparation rules, and inspect the values used by the forecasting models.</p>
          <div className="dataset-context"><CheckCircle2 size={18} /><span>Read-only access to the historical training dataset. Student accounts, messages, and submitted academic records are not included.</span></div>
        </section>

        {summaryError ? <section className="dataset-message" role="alert"><h2>The dataset is unavailable</h2><p>{summaryError}</p><button onClick={() => setReload((value) => value + 1)}>Try again</button></section> : !summary ? <p className="dataset-message" role="status">Preparing the dataset report…</p> : <>
          <section className="dataset-stats" aria-label="Dataset preparation summary">
            {[
              ['Original records', integer(counts.original), 'Before eligibility checks'],
              ['Cleaned records', integer(counts.cleaned), 'Retained for analysis'],
              ['Excluded records', integer(counts.excluded), 'Reasons available below'],
              ['Retention rate', `${number(counts.retentionRate * 100, 2)}%`, 'Share of original records'],
              ['Exact duplicates', integer(counts.duplicates), 'Full-row duplicate check'],
              ['Missing cells', integer(counts.missingCells), 'Across original columns'],
            ].map(([label, value, detail]) => <article key={label}><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>)}
          </section>

          <section className="dataset-charts" aria-label="Dataset preparation charts">
            <article className="dataset-panel"><div className="dataset-panel-heading"><h2>Historical outcomes</h2><p>Original and retained records by observed outcome.</p></div>
              <div className="dataset-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={outcomeChart} accessibilityLayer margin={{ left: 0, right: 10, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5ebf1" /><XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={45} /><Tooltip formatter={(value) => integer(value)} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="Original" fill="#b3c8df" radius={[3, 3, 0, 0]} /><Bar dataKey="Cleaned" fill="#1463b8" radius={[3, 3, 0, 0]} />
              </BarChart></ResponsiveContainer></div>
              <p className="dataset-footnote">Dropout, Enrolled, and Graduate are recorded outcomes, distinct from low, medium, and high forecast-risk tiers.</p>
            </article>
            <article className="dataset-panel"><div className="dataset-panel-heading"><h2>Why records are excluded</h2><p>Counts for preparation rules that flagged records.</p></div>
              {ruleChart.length ? <div className="dataset-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={ruleChart} accessibilityLayer margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5ebf1" /><XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={45} fontSize={12} /><Tooltip formatter={(value) => integer(value)} /><Bar dataKey="Records" fill="#d39732" radius={[3, 3, 0, 0]} />
              </BarChart></ResponsiveContainer></div> : <p className="dataset-message">No records failed the preparation rules.</p>}
              <p className="dataset-footnote">A record may fail more than one rule. Zero enrollment means ineligible for the current completion-rate calculation, not necessarily an incorrect source record.</p>
            </article>
          </section>

          <section className="dataset-panel dataset-explorer" aria-labelledby="dataset-explorer-title">
            <div className="dataset-explorer-heading"><div><p className="dataset-eyebrow">Trace the preparation</p><h2 id="dataset-explorer-title">Explore the records</h2></div><button className="dataset-download" onClick={download} disabled={downloading || !summary.views[view]}><Download size={16} />{downloading ? 'Downloading…' : 'Download CSV'}</button></div>
            <div className="dataset-tabs" role="group" aria-label="Dataset stage">
              {['raw', 'cleaned', 'excluded', 'risk'].map((stage, index) => <button key={stage} aria-pressed={stage === 'risk' ? isModel : view === stage} onClick={() => chooseView(stage === 'risk' ? model : stage)}><span>{index + 1}</span>{VIEW_LABELS[stage]}{index < 3 && <ArrowRight size={14} className="dataset-stage-arrow" />}</button>)}
            </div>
            <div className="dataset-view-description">
              {view === 'raw' && <p>Source records before cleaning. Source row IDs stay consistent across all views. Showing selected columns from {counts.originalColumns} original columns.</p>}
              {view === 'cleaned' && <p>Retained records after label normalization and academic checks. Completion rate = approved units ÷ enrolled units. Source grades remain on the 0–20 scale.</p>}
              {view === 'excluded' && <p>Each excluded source record includes its reason. A zero grade or zero approved units alone does not exclude a record.</p>}
              {isModel && <><label className="dataset-model-select">Model<select value={model} onChange={(event) => { setModel(event.target.value); chooseView(event.target.value); }}><option value="risk">Random Forest · attrition classification</option><option value="grade">Linear Regression · grade forecasting</option></select></label><p>Numeric values use the saved scaler; study schedule is one-hot encoded for the risk model. Outcome and grade targets are labels, not predictor inputs. Values are rounded for display; the CSV preserves numeric precision.</p></>}
            </div>
            <div className="dataset-toolbar">
              <label className="dataset-search"><Search size={16} /><span className="dataset-sr-only">Search records</span><input type="search" maxLength={80} placeholder="Search a value or source row…" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></label>
              <label className="dataset-filter"><Filter size={15} /><span className="dataset-sr-only">Historical outcome</span><select value={outcome} onChange={(event) => { setOutcome(event.target.value); setPage(1); }}><option value="all">All outcomes</option>{OUTCOMES.filter((label) => label !== 'Unknown' || summary.outcomes.raw.Unknown).map((label) => <option key={label}>{label}</option>)}</select></label>
              <details className="dataset-columns"><summary><SlidersHorizontal size={15} /> Columns ({visibleColumns.length})</summary><div><button onClick={() => setColumnsByView((previous) => ({ ...previous, [view]: allColumns }))}>Show all columns</button>{allColumns.map((column) => <label key={column}><input type="checkbox" checked={visibleColumns.includes(column)} disabled={visibleColumns.length === 1 && visibleColumns.includes(column)} onChange={() => toggleColumn(column)} />{labelFor(column)}</label>)}</div></details>
            </div>
            <div role="status" className="dataset-results-label">{loadingRows ? 'Loading records…' : data ? `${integer(data.total)} matching records · ${VIEW_LABELS[view]}${isModel ? ` · ${model === 'risk' ? 'Random Forest' : 'Linear Regression'}` : ''}` : ''}</div>
            {rowsError ? <p className="dataset-message dataset-error" role="alert">{rowsError}</p> : <div className="dataset-table-scroll" tabIndex={0} aria-label="Scrollable dataset records"><table className="dataset-table" aria-busy={loadingRows}><thead><tr>{visibleColumns.map((column) => <th scope="col" key={column} title={column}>{labelFor(column)}</th>)}</tr></thead><tbody>{data?.rows.map((row) => <tr key={row['Source row']}>{visibleColumns.map((column) => <td key={column} className={column === 'Exclusion reason' ? 'dataset-reason' : ''}>{column === 'Preparation status' ? <span className={`dataset-status dataset-status--${row[column].toLowerCase()}`}>{row[column]}</span> : valueFor(row[column], column)}</td>)}</tr>)}{!loadingRows && data?.rows.length === 0 && <tr><td colSpan={Math.max(1, visibleColumns.length)} className="dataset-empty">{view === 'excluded' && !counts.excluded ? 'No excluded records.' : 'No records match these filters.'}</td></tr>}</tbody></table></div>}
            {downloadError && <p role="alert" className="dataset-error">{downloadError}</p>}
            <div className="dataset-pagination"><label>Rows per page<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[25, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label><span>{data?.total ? `${integer((page - 1) * pageSize + 1)}–${integer(Math.min(page * pageSize, data.total))} of ${integer(data.total)}` : '0 records'}</span><div><button aria-label="Previous page" disabled={loadingRows || page <= 1 || !data} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={18} /></button><span>Page {page} of {pages}</span><button aria-label="Next page" disabled={loadingRows || page >= pages || !data} onClick={() => setPage((value) => value + 1)}><ChevronRight size={18} /></button></div></div>
            <p className="dataset-footnote">CSV downloads include all columns and all matching records in the selected view, with the current search and outcome filter.</p>
          </section>

          <section className="dataset-detail-grid">
            <article className="dataset-panel"><div className="dataset-panel-heading"><h2>Preparation checks</h2><p>Observed results, including rules that changed no records.</p></div><div className="dataset-table-scroll"><table className="dataset-table dataset-checks"><thead><tr><th scope="col">Check</th><th scope="col">Flagged records</th></tr></thead><tbody>{summary.rules.map((rule) => <tr key={rule.id}><td>{rule.label}</td><td>{integer(rule.count)}</td></tr>)}</tbody></table></div><p className="dataset-footnote">The current source has {integer(counts.missingCells)} missing cells. A configured imputer does not imply values were filled. Rule counts can overlap.</p></article>
            <article className="dataset-panel"><div className="dataset-panel-heading"><h2>After cleaning</h2><p>Academic variables before scaling.</p></div><div className="dataset-table-scroll"><table className="dataset-table dataset-checks"><thead><tr><th scope="col">Variable</th><th scope="col">Mean</th><th scope="col">Range</th></tr></thead><tbody>{summary.statistics.map((item) => <tr key={item.column}><td>{labelFor(item.column)}</td><td>{valueFor(item.mean, item.column)}</td><td>{valueFor(item.minimum, item.column)}–{valueFor(item.maximum, item.column)}</td></tr>)}</tbody></table></div></article>
          </section>

          <section className="dataset-panel dataset-source"><h2>Source and preparation notes</h2><p>{summary.metadata.sourceDescription} <a href={summary.metadata.referenceUrl} target="_blank" rel="noreferrer">Original dataset reference ↗</a></p><p>{summary.metadata.sourceNote}</p><ul>{summary.notes.map((note) => <li key={note}>{note}</li>)}</ul><dl><div><dt>Source file</dt><dd>{summary.metadata.fileName}</dd></div><div><dt>Source updated</dt><dd>{new Date(summary.metadata.sourceUpdatedAt).toLocaleString()}</dd></div><div><dt>Report prepared</dt><dd>{new Date(summary.metadata.generatedAt).toLocaleString()}</dd></div><div className="dataset-fingerprint"><dt>Dataset SHA-256</dt><dd><code>{summary.metadata.sha256}</code></dd></div></dl></section>
        </>}
        <footer className="dataset-footer">Retainify · Historical dataset transparency · Read-only</footer>
      </main>
    </div>
  );
}
