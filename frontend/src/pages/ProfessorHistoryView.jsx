import { useState } from 'react';
import { ArrowLeftRight, BarChart3, CheckCircle2, ChevronDown, FileSpreadsheet, FilePenLine, History, RefreshCw, Search, UsersRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import useAdaptivePolling from '../hooks/useAdaptivePolling';
import '../styles/ProfessorHistory.css';

const TYPES = {
  csv_import: { label: 'CSV imports', icon: FileSpreadsheet, color: 'blue' },
  academic_correction: { label: 'Academic corrections', icon: FilePenLine, color: 'amber' },
  connection: { label: 'Connection activity', icon: UsersRound, color: 'blue' },
  provider_transfer: { label: 'Provider transfers', icon: ArrowLeftRight, color: 'green' },
  forecast: { label: 'Student forecasts', icon: BarChart3, color: 'green' },
};
const FIELDS = { previousSemesterGrade: 'Previous semester GWA / grade', gradeMaximum: 'Grading scale', previousSemesterUnitsEnrolled: 'Enrolled units', previousSemesterUnitsApproved: 'Approved units', attendance: 'Study schedule' };
const EMPTY_FILTERS = { search: '', type: 'all', academicYear: '', semester: '', from: '', to: '' };
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not recorded';
const number = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : 'Not recorded';
const displayValue = value => value === 'day' ? 'Daytime' : value === 'night' ? 'Evening' : value === null || value === undefined ? 'Not recorded' : String(value);
const period = event => event.academicYear && event.semester ? `${event.academicYear} · Semester ${event.semester}` : 'Not recorded';

export function eventTitle(event) {
  if (event.category === 'csv_import') return 'CSV import confirmed';
  if (event.category === 'academic_correction') return 'Academic record corrected';
  if (event.category === 'connection') return `Connection ${event.action}`;
  if (event.category === 'provider_transfer') return `Academic provider transfer ${event.action}`;
  return 'Student forecast generated';
}

export function ProfessorHistoryEvent({ event }) {
  const type = TYPES[event.category] || TYPES.connection;
  const Icon = type.icon;
  const details = event.details || {};
  return <li className="professor-history-item">
    <details>
      <summary>
        <span className={`professor-history-icon ${type.color}`} aria-hidden="true"><Icon size={19} /></span>
        <span className="professor-history-event-heading"><strong>{eventTitle(event)}</strong>
          <span>{event.student?.fullName || 'Class records'} · {event.actor?.fullName || 'Account unavailable'}</span>
        </span>
        <span className="professor-history-event-date"><time dateTime={event.occurredAt}>{date(event.occurredAt)}</time>{event.academicYear && <small>{period(event)}</small>}</span>
        <ChevronDown className="professor-history-chevron" size={17} aria-hidden="true" />
      </summary>
      <div className="professor-history-details">
        <dl className="professor-history-metadata">
          <div><dt>Acting user</dt><dd>{event.actor?.fullName || 'Account unavailable'}{event.actor?.role ? ` (${event.actor.role})` : ''}</dd></div>
          {event.student && <div><dt>Student</dt><dd>{event.student.fullName}</dd></div>}
          <div><dt>Recorded</dt><dd>{date(event.occurredAt)}</dd></div>
          {event.category !== 'connection' && <div><dt>Source semester</dt><dd>{period(event)}</dd></div>}
        </dl>
        {event.detailsRestricted ? <p className="professor-history-muted">Academic details are unavailable because this student is no longer connected at your current institution.</p> : <>
          {event.category === 'csv_import' && <>
            <div className="professor-history-import-counts"><span><strong>{number(details.counts?.created)}</strong> New records</span><span><strong>{number(details.counts?.corrected)}</strong> Corrected</span><span><strong>{number(details.counts?.unchanged)}</strong> Unchanged</span></div>
            <p className="professor-history-reference">Batch ID: <code>{details.batchId}</code></p>
          </>}
          {event.category === 'academic_correction' && <>
            <div className="professor-history-table-scroll"><table><caption>Academic values changed</caption><thead><tr><th scope="col">Field</th><th scope="col">Previous value</th><th scope="col">New value</th></tr></thead>
              <tbody>{(details.changes || []).map(change => <tr key={change.field}><th scope="row">{FIELDS[change.field] || change.field}</th><td>{displayValue(change.before)}</td><td>{displayValue(change.after)}</td></tr>)}</tbody></table></div>
            <p><strong>Correction reason:</strong> {details.reason || 'Not recorded'}</p>
            <p className="professor-history-reference">Academic version {number(details.academicVersion)}{details.batchId && <> · Batch ID: <code>{details.batchId}</code></>}</p>
          </>}
          {event.category === 'connection' && <dl className="professor-history-metadata">
            <div><dt>Previous status</dt><dd>{displayValue(details.previousStatus)}</dd></div><div><dt>Result</dt><dd>{displayValue(details.status || event.action)}</dd></div>
          </dl>}
          {event.category === 'provider_transfer' && <>
            <dl className="professor-history-metadata"><div><dt>Previous provider</dt><dd>{details.previousProfessor?.fullName || 'Account unavailable'}</dd></div><div><dt>Receiving provider</dt><dd>{details.receivingProfessor?.fullName || 'Account unavailable'}</dd></div><div><dt>Transfer status</dt><dd>{event.action}</dd></div><div><dt>Academic version</dt><dd>{number(details.academicVersion)}</dd></div></dl>
          </>}
          {event.category === 'forecast' && <>
            <dl className="professor-history-metadata professor-history-forecast">
              <div><dt>Predicted next-semester grade</dt><dd>{number(details.predictedGrade)} / {number(details.gradeMaximum)}</dd></div>
              <div><dt>Dropout probability</dt><dd>{typeof details.dropoutProbability === 'number' && Number.isFinite(details.dropoutProbability) ? `${Math.round(details.dropoutProbability * 10000) / 100}%` : 'Not recorded'}</dd></div>
              <div><dt>Risk level</dt><dd><span className={`professor-history-risk ${['low', 'medium', 'high'].includes(details.riskLevel) ? details.riskLevel : ''}`}>{details.riskLevel || 'Not recorded'}</span></dd></div>
              <div><dt>Academic version used</dt><dd>{number(details.academicVersion)}</dd></div>
            </dl>
            <p className="professor-history-muted">Saved forecast at the time of generation.{details.legacy ? ' This older forecast has legacy inputs.' : ''}</p>
          </>}
        </>}
      </div>
    </details>
  </li>;
}

function HistoryResults({ url, page, onNext, onPrevious, children }) {
  const { apiFetch } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      const response = await apiFetch(url);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not load your professor history.');
      setData(result); setError('');
    } catch (err) { setError(err.message || 'Could not load professor history.'); }
    finally { setRefreshing(false); }
  };
  useAdaptivePolling(refresh, { intervalMs: 15000 });
  return <>
    <section className="professor-history-summary" aria-label="Activity totals matching search, period and dates">
      {Object.entries(TYPES).map(([key, type]) => { const Icon = type.icon; return <article key={key}><span className={`professor-history-icon ${type.color}`} aria-hidden="true"><Icon size={20} /></span><div><strong>{data ? number(data.counts?.[key]) : '—'}</strong><span>{type.label}</span></div></article>; })}
    </section>
    {children}
    <div className="professor-history-list-heading"><p>{data ? `${data.total} matching ${data.total === 1 ? 'event' : 'events'}` : 'Loading activity...'}</p><button type="button" className="connection-button" onClick={refresh} disabled={refreshing}><RefreshCw size={15} /> {refreshing ? 'Refreshing...' : 'Refresh'}</button></div>
    {error && <p className="connection-message connection-message--error" role="alert">{error}</p>}
    {!data && !error && <p className="professor-history-loading" role="status">Loading your activity history...</p>}
    {data && (data.events.length ? <ol className="professor-history-list">{data.events.map(event => <ProfessorHistoryEvent key={event.id} event={event} />)}</ol> : <div className="professor-history-empty"><History size={28} /><h3>No history to display</h3><p>Your imports, corrections, connection changes, provider transfers, and student forecasts will appear here. Try adjusting your filters.</p></div>)}
    <div className="professor-history-pagination"><button type="button" className="connection-button" disabled={page === 1 || refreshing} onClick={onPrevious}>Previous</button><span>Page {page}</span><button type="button" className="connection-button" disabled={!data?.nextCursor || refreshing} onClick={() => onNext(data.nextCursor)}>Next</button></div>
  </>;
}

export default function ProfessorHistoryView() {
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [cursors, setCursors] = useState([null]);
  const parameters = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  const cursor = cursors.at(-1);
  if (cursor) parameters.set('cursor', cursor);
  const url = `/api/professor/history?${parameters}`;
  const change = event => setDraft(current => ({ ...current, [event.target.name]: event.target.value }));
  const apply = event => { event.preventDefault(); setFilters({ ...draft, search: draft.search.trim(), academicYear: draft.academicYear.trim() }); setCursors([null]); };
  const reset = () => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setCursors([null]); };
  return <section className="workspace-section professor-history" id="history">
    <div className="section-heading"><div><p className="dashboard-eyebrow">Class activity</p><h2>Professor History</h2></div><span className="professor-history-readonly"><CheckCircle2 size={15} /> Activity and audit log</span></div>
    <p className="dashboard-subtext">Review your academic uploads and corrections, student connections, provider transfers, and saved student forecasts.</p>
    <HistoryResults key={url} url={url} page={cursors.length} onNext={value => setCursors(current => [...current, value])} onPrevious={() => setCursors(current => current.slice(0, -1))}>
      <form className="professor-history-filters" onSubmit={apply} aria-label="Filter professor history">
        <label className="professor-history-search">Search student or batch ID<span><Search size={16} aria-hidden="true" /><input name="search" value={draft.search} onChange={change} maxLength={80} placeholder="Student name, email, or batch ID" /></span></label>
        <label>Event type<select name="type" value={draft.type} onChange={change}><option value="all">All events</option>{Object.entries(TYPES).map(([value, type]) => <option key={value} value={value}>{type.label}</option>)}</select></label>
        <label>Academic year<input name="academicYear" value={draft.academicYear} onChange={change} pattern="[0-9]{4}-[0-9]{4}" placeholder="2025-2026" /></label>
        <label>Semester<select name="semester" value={draft.semester} onChange={change}><option value="">All semesters</option><option value="1">Semester 1</option><option value="2">Semester 2</option></select></label>
        <label>From date<input type="date" name="from" value={draft.from} onChange={change} /></label>
        <label>To date<input type="date" name="to" value={draft.to} onChange={change} min={draft.from || undefined} /></label>
        <div className="professor-history-filter-actions"><button className="dashboard-action" type="submit">Apply filters</button><button className="connection-button" type="button" onClick={reset}>Reset</button></div>
      </form>
    </HistoryResults>
  </section>;
}
