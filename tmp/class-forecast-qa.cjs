const path = require('node:path');
const http = require('node:http');
const { build } = require('../frontend/node_modules/esbuild');
const fixture = `
const batchId = '000000000000000000000003';
let initialized = false;
const attempts = {};
const rows = ['Alice Santos', 'Bob Reyes', 'Carol Cruz', 'Dave Ramos'].map((studentName, index) => ({
  id: String(index + 1), studentId: 'student-' + (index + 1), studentName, studentEmail: 'student' + (index + 1) + '@example.com',
  rowNumber: index + 2, status: 'pending', academicVersion: 1,
}));
function result() {
  const summary = {total: 4, succeeded: 0, failed: 0, pending: 0, processing: 0, restricted: 0, low: 0, medium: 0, high: 0};
  rows.forEach(row => { summary[row.status]++; if (row.forecast) summary[row.forecast.riskLevel]++; });
  summary.remaining = summary.pending + summary.processing;
  return {batchId, section: 'BSIT 3-3', academicYear: '2026-2027', semester: 1, initialized, rows: initialized ? rows : [],
    summary: initialized ? summary : {...summary, remaining: 4}};
}
const apiFetch = async (url, options = {}) => {
  if (url.endsWith('/academic-imports')) return Response.json({batches: [{_id: batchId, section: 'BSIT 3-3', academicYear: '2026-2027', semester: 1, committedAt: '2026-11-12T08:00:00Z'}]});
  if (url.endsWith('/forecasts') && options.method === 'POST') { initialized = true; return Response.json(result()); }
  if (url.endsWith('/forecasts')) return Response.json(result());
  if (url.endsWith('/run')) {
    const id = url.split('/').at(-2);
    const row = rows.find(item => item.id === id);
    attempts[id] = (attempts[id] || 0) + 1;
    await new Promise(resolve => setTimeout(resolve, 800));
    if (id === '2' && attempts[id] === 1) { row.status = 'failed'; row.error = 'Forecast unavailable: profile_incomplete. Complete personal information.'; }
    else { row.status = 'succeeded'; row.error = ''; row.completedAt = new Date().toISOString(); row.forecast = {
      predictedNextSemesterGrade: 2.25, gradeMaximum: 5, dropoutProbability: id === '1' ? 0 : id === '2' ? .2 : .4,
      riskLevel: id === '1' ? 'low' : id === '2' ? 'medium' : 'high', modelVersion: 'test-model-v1'}; }
    return Response.json({status: row.status});
  }
  return Response.json({});
};
export const useAuth = () => ({apiFetch});
`;
(async () => {
  const output = await build({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
    import Import from '../frontend/src/components/AcademicCsvImport.jsx'; import Panel from '../frontend/src/components/ClassForecastPanel.jsx';
    import '../frontend/src/styles/Global.css'; import '../frontend/src/styles/Dashboard.css';
    createRoot(document.getElementById('root')).render(<main className="academic-workspace" style={{padding: '24px', maxWidth: '1300px', margin: 'auto'}}><Import /><Panel /></main>);`,
    resolveDir: __dirname, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', outdir: path.join(__dirname, 'qa-memory'),
    nodePaths: [path.resolve(__dirname, '../frontend/node_modules')],
    plugins: [{ name: 'qa-auth', setup(builder) {
      builder.onResolve({filter: /[/\\]AuthContext(?:\.jsx)?$/}, () => ({path: 'auth', namespace: 'qa'}));
      builder.onLoad({filter: /.*/, namespace: 'qa'}, () => ({contents: fixture}));
    }}] });
  const js = output.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = output.outputFiles.find(file => file.path.endsWith('.css')).text;
  http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Retainify Class Forecast QA</title><style>' + css + '</style></head><body><div id="root"></div><script>' + js.replaceAll('</script>', '<\\/script>') + '</script></body></html>');
  }).listen(4178, '127.0.0.1', () => console.log('QA fixture available at http://127.0.0.1:4178'));
})();
