import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Pause, Play, RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import '../styles/ClassForecast.css';

export function ClassForecastResults({ data, search = '', filter = 'all' }) {
  const query = search.trim().toLowerCase();
  const rows = data.rows.filter(row => (!query || `${row.studentName || ''} ${row.studentEmail || ''} ${row.studentId || ''}`.toLowerCase().includes(query)) &&
    (filter === 'all' || row.status === filter || (row.status === 'succeeded' && row.forecast?.riskLevel === filter)));
  return <div className="academic-table-scroll class-forecast-table"><table>
    <caption>Individual forecasts for {data.section || 'this import'} · {data.academicYear}, Semester {data.semester}</caption>
    <thead><tr><th scope="col">Student</th><th scope="col">Source semester</th><th scope="col">Estimated dropout probability</th><th scope="col">Risk level</th><th scope="col">Predicted grade</th><th scope="col">Status / details</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td><strong>{row.studentName || 'Access unavailable'}</strong><small>{row.studentEmail}</small>{row.studentId && <small>ID: {row.studentId}</small>}</td>
      <td>{data.academicYear}<small>Semester {data.semester}{row.academicVersion !== undefined && ` · Record v${row.academicVersion}`}</small></td>
      <td>{row.status === 'succeeded' ? `${(row.forecast.dropoutProbability * 100).toFixed(2)}%` : '—'}</td>
      <td>{row.status === 'succeeded' ? <span className={`class-risk class-risk--${row.forecast.riskLevel}`}>{row.forecast.riskLevel}</span> : '—'}</td>
      <td>{row.status === 'succeeded' ? `${row.forecast.predictedNextSemesterGrade} / ${row.forecast.gradeMaximum}` : '—'}</td>
      <td><span className={`class-forecast-status class-forecast-status--${row.status}`}>{row.status === 'succeeded' ? 'Completed' : row.status}</span>
        {row.error && <small>{row.error}</small>}{row.completedAt && <small>{new Date(row.completedAt).toLocaleString()}</small>}
        {row.forecast?.modelVersion && <small>Model: {row.forecast.modelVersion}</small>}</td>
    </tr>)}</tbody>
  </table>{!rows.length && <p className="academic-panel-subtitle">{data.initialized ? 'No students match these filters.' : 'Run this class to prepare the individual forecasts.'}</p>}</div>;
}

export default function ClassForecastPanel({ importedBatchId, onRunningChange, onCompleted }) {
  const { apiFetch } = useAuth();
  const [batches, setBatches] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [batchId, setBatchId] = useState(importedBatchId || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const mounted = useRef(false);
  const stop = useRef(false);
  const activeRun = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop.current = true; onRunningChange?.(false); };
  }, []);

  const request = async (url, options) => {
    const response = await apiFetch(url, { ...options, signal: AbortSignal.timeout(110000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'The server is starting or unavailable. Try again shortly.');
    return result;
  };
  const listBatches = async (before) => {
    setLoading(true); setError('');
    try {
      const result = await request('/api/professor/academic-imports' + (before ? `?before=${before}` : ''));
      if (!mounted.current) return;
      setBatches(current => before ? [...current, ...result.batches.filter(item => !current.some(old => old._id === item._id))] : result.batches);
      setCursor(result.nextCursor);
      if (!before) setBatchId(current => current || result.batches[0]?._id || '');
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => {
    if (importedBatchId) setBatchId(importedBatchId);
    listBatches();
  }, [apiFetch, importedBatchId]); // Reload after a confirmed import.

  const baseUrl = `/api/professor/academic-imports/${batchId}/forecasts`;
  const refresh = async () => {
    const result = await request(baseUrl);
    if (mounted.current) setData(result);
    return result;
  };
  useEffect(() => {
    let cancelled = false;
    setData(null); setSearch(''); setFilter('all'); setNotice('');
    if (!batchId) return;
    setLoading(true); setError('');
    request(baseUrl).then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch, batchId]);

  const run = async (retryFailed = false) => {
    if (activeRun.current) return;
    activeRun.current = true; stop.current = false;
    setRunning(true); setPausing(false); setError('');
    setNotice('Preparing class forecasts. The first forecast may take longer while the service starts.');
    onRunningChange?.(true);
    let changed = false;
    try {
      const initial = await request(baseUrl, { method: 'POST' });
      if (!mounted.current) return;
      setData(initial);
      const queue = initial.rows.filter(row => retryFailed ? row.status === 'failed' : ['pending', 'processing'].includes(row.status));
      let servicePaused = false;
      for (const row of queue) {
        if (stop.current || !mounted.current) break;
        setNotice(`Forecasting ${row.studentName || 'student'} (CSV row ${row.rowNumber}). The service may take a moment to respond.`);
        const result = await request(`${baseUrl}/${row.id}/run`, { method: 'POST' });
        changed = changed || result.status === 'succeeded';
        if (!mounted.current) break;
        await refresh();
        if (result.serviceUnavailable) {
          servicePaused = true;
          setNotice('The forecasting service is starting or temporarily unavailable. Progress is saved. Resume remaining students or retry failed students shortly.');
          break;
        }
      }
      if (mounted.current && !servicePaused) {
        setNotice(stop.current ? 'Paused. Completed results are saved; resume this class whenever you are ready.' : 'Class run finished. Review completed results and retry any failed students after resolving their errors.');
      }
    } catch (err) {
      if (mounted.current) {
        setError(`${err.message} Completed results are saved. Refresh results before resuming; an interrupted request may need up to 2½ minutes before it can be retried.`);
        try { await refresh(); } catch { /* Keep the last successfully loaded results. */ }
      }
    } finally {
      activeRun.current = false;
      if (mounted.current) { setRunning(false); setPausing(false); onRunningChange?.(false); if (changed) onCompleted?.(); }
    }
  };
  const exportResults = async () => {
    setError('');
    try {
      const response = await apiFetch(`${baseUrl}/export`);
      if (!response.ok) throw new Error((await response.json()).message || 'Download failed.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `retainify-class-forecasts-${batchId}.csv`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
  };
  const counts = data?.summary;

  return <section className="academic-panel class-forecast-panel" aria-labelledby="class-forecast-heading">
    <div className="academic-panel-heading"><div><span className="dashboard-eyebrow">Class Forecasts</span><h2 id="class-forecast-heading">Attrition Risk by Class</h2></div>
      <button type="button" className="connection-button" disabled={running || loading} onClick={() => listBatches()}><RefreshCw size={15} /> Refresh imports</button></div>
    <p className="academic-panel-subtitle">Choose a confirmed CSV import to forecast each student from that source semester. Students must have complete personal information and an active connection to you as their academic provider.</p>
    <div className="class-forecast-toolbar"><label className="academic-form-group">Confirmed class import
      <select className="academic-input" value={batchId} disabled={running || loading} onChange={event => setBatchId(event.target.value)}>
        <option value="">Select a confirmed import</option>{batches.map(batch => <option key={batch._id} value={batch._id}>{batch.section || 'Class import'} · {batch.academicYear || 'Academic period'} · Semester {batch.semester || '—'} · {new Date(batch.committedAt).toLocaleString()} · {batch._id.slice(-6)}</option>)}
      </select></label>{cursor && <button type="button" className="connection-button" disabled={running || loading} onClick={() => listBatches(cursor)}>Load older imports</button>}</div>
    {!loading && !error && !batches.length && <div className="academic-workspace-empty"><span className="academic-upload-icon" aria-hidden="true"><FileSpreadsheet size={23} /></span><div><h3>Your class forecasts start with an import</h3><p>Confirm a student records CSV above to start a class forecast.</p></div></div>}
    {error && <p className="academic-notice academic-notice--error" role="alert">{error}</p>}
    {loading && <p className="academic-notice" role="status">Loading class forecasts...</p>}
    {data && <>
      <p className="class-forecast-reference">{data.section || 'Class import'} · {data.academicYear}, Semester {data.semester} · Batch {data.batchId}{data.skipped > 0 && ` · ${data.skipped} invalid CSV rows skipped`}</p>
      <div className="class-forecast-summary" aria-label="Class risk totals">
        <article><strong>{counts.total}</strong><span>Students in import</span></article>
        <article><strong>{counts.succeeded}</strong><span>Completed forecasts</span></article>
        {['low', 'medium', 'high'].map(level => <article key={level} className={`class-summary--${level}`}><strong>{counts[level]}</strong><span>{level} risk</span></article>)}
      </div>
      <div className="class-forecast-progress"><progress value={counts.succeeded + counts.failed + counts.restricted} max={Math.max(counts.total, 1)} aria-label="Class forecasts processed" />
        <p aria-live="polite">{counts.succeeded} completed · {counts.failed} failed · {counts.remaining} remaining{counts.restricted > 0 && ` · ${counts.restricted} access unavailable`}</p></div>
      <div className="class-forecast-actions academic-submit-row">
        <button type="button" className="dashboard-action" disabled={running || loading || counts.remaining === 0} onClick={() => run()}><Play size={16} />{counts.succeeded || counts.failed || counts.processing ? 'Resume Remaining Students' : 'Run Attrition Risk for This Class'}</button>
        <button type="button" className="connection-button" disabled={running || loading || !counts.failed} onClick={() => run(true)}><RefreshCw size={15} /> Retry Failed Students</button>
        {running && <button type="button" className="connection-button" disabled={pausing} onClick={() => { stop.current = true; setPausing(true); }}><Pause size={15} />{pausing ? 'Pausing after current student…' : 'Pause'}</button>}
        <button type="button" className="connection-button" disabled={running || loading} onClick={() => { setError(''); refresh().catch(err => setError(err.message)); }}>Refresh results</button>
        <button type="button" className="connection-button" disabled={running || !data.rows.length} onClick={exportResults}><Download size={15} /> Download Results CSV</button>
      </div>
      {notice && <p className="academic-notice" role="status">{notice}</p>}
      <p className="academic-panel-subtitle">Keep this page open while a run is active. You can pause and return to this import later; completed forecasts are saved to student and professor History.</p>
      <div className="class-forecast-toolbar class-forecast-filters"><label className="academic-form-group"><span><Search size={14} aria-hidden="true" /> Search students</span><input type="search" className="academic-input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email, or student ID" /></label>
        <label className="academic-form-group">Filter results<select className="academic-input" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All students</option><option value="low">Low risk</option><option value="medium">Medium risk</option><option value="high">High risk</option><option value="succeeded">Completed</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="processing">Processing</option><option value="restricted">Access unavailable</option></select></label></div>
      <ClassForecastResults data={data} search={search} filter={filter} />
      <p className="class-forecast-disclaimer">Low: below 20% · Medium: 20% to below 40% · High: 40% or above. These are estimates to guide academic support, not confirmation that a student will drop out.</p>
    </>}
  </section>;
}
