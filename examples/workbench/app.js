import {MAX_ROWS, presets, parseCategories, parseCSV, makeRequest, readAnswer, resultsCSV} from './logic.mjs';

const $ = id => document.getElementById(id);
let mode = 'text', preset = 'support', csv = null, rows = [], running = false, stop = false;
let service = null, illustrative = false, fileVersion = 0, exportHeaders = [];
const labels = {pending: '待处理', complete: '已完成', error: '失败', stopped: '未处理', illustrative: '界面示例'};

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function setError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function inputRows() {
  if (mode === 'csv') {
    if (!csv) throw new Error('请先选择 UTF-8 CSV 文件。');
    return csv.rows.map((row, index) => ({index: index + 1, text: row[Number($('text-column').value)] ?? '', original: [...row]}));
  }
  const values = $('input-text').value.split(/\r?\n/).filter(text => text.trim());
  if (!values.length) throw new Error('请放入需要分类的文字，每行一条。');
  if (values.length > MAX_ROWS) throw new Error(`一次最多处理 ${MAX_ROWS} 条，请分批处理。`);
  return values.map((text, index) => ({index: index + 1, text}));
}

function renderRows() {
  $('result-rows').replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.append(node('td', row.index), node('td', row.text), node('td', row.label || '—'),
      node('td', row.probability == null ? '—' : `${(row.probability * 100).toFixed(1)}%`),
      node('td', row.error ? `${labels[row.status]}：${row.error}` : labels[row.status]));
    $('result-rows').append(tr);
  }
  $('empty-state').hidden = rows.length > 0;
  $('results').hidden = rows.length === 0;
  $('download').disabled = !rows.length || running;
  $('result-summary').textContent = illustrative ? '界面示例 · 分类由人工预设，未调用模型，也没有模型概率。' :
    rows.length ? `${rows.filter(r => r.status === 'complete').length} 条完成 · ${rows.filter(r => r.status === 'error').length} 条失败 · ${rows.filter(r => ['pending', 'stopped'].includes(r.status)).length} 条未处理` : '你的结果会出现在这里。';
}

function note() {
  $('mode-note').textContent = illustrative ? '正在展示预设内容与预设规则的界面示例，你编辑的输入保持不变。处理自己的内容需要点击“开始分类”并连接真实模型服务。' :
    service ? '真实模型已连接。点击开始后，文字会发送到当前 Open-Jev 服务。概率表示模型对选项的分配，不代表实际正确率。' :
    '当前可编辑任务、上传并预览表格、导出任务配置。点击“看看示例流程”可了解操作；处理自己的内容需要连接模型服务。';
  $('setup-note').hidden = !!service;
}

function refreshPreview() {
  $('input-preview').replaceChildren();
  try {
    const inputs = inputRows();
    $('input-preview').append(node('p', `共 ${inputs.length} 条 · 预览前 ${Math.min(inputs.length, 3)} 条`));
    inputs.slice(0, 3).forEach(row => $('input-preview').append(node('p', `${row.index}. ${row.text || '（空白，将标记为失败）'}`)));
    $('request-preview').textContent = JSON.stringify(makeRequest(inputs[0].text, $('instructions').value, parseCategories($('categories').value)), null, 2);
  } catch (error) {
    $('request-preview').textContent = error.message;
  }
}

function invalidate() {
  if (running) return;
  rows = []; illustrative = false; exportHeaders = []; setError(''); $('progress').textContent = '';
  renderRows(); refreshPreview(); note();
}

function chooseMode(value) {
  mode = value; fileVersion++;
  $('text-panel').hidden = value !== 'text'; $('csv-panel').hidden = value !== 'csv';
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === value);
    button.setAttribute('aria-pressed', String(button.dataset.mode === value));
  });
  invalidate();
}

function choosePreset(value) {
  preset = value;
  $('instructions').value = presets[value].instructions;
  $('categories').value = presets[value].categories;
  document.querySelectorAll('[data-preset]').forEach(button => {
    button.classList.toggle('active', button.dataset.preset === value);
    button.setAttribute('aria-pressed', String(button.dataset.preset === value));
  });
  invalidate();
}

function freeze(value) {
  running = value;
  document.querySelectorAll('input, select, textarea, button').forEach(element => {
    if (element.id !== 'stop') element.disabled = value;
  });
  $('stop').hidden = !value; $('stop').disabled = false;
  $('run').disabled = value || !service;
  $('download').disabled = value || !rows.length;
  $('text-column').disabled = value || !csv;
}

async function checkHealth() {
  try {
    const response = await fetch('/health', {signal: AbortSignal.timeout(10000)});
    const data = await response.json();
    if (data.status === 'ready' && typeof data.model === 'string') {
      service = data;
      $('health').textContent = `模型已连接 · ${data.checkpoint || data.model}${data.device ? ' · ' + data.device.toUpperCase() : ''}`;
      $('health').dataset.state = 'connected';
    } else if (data.status === 'loading') {
      $('health').textContent = '模型正在加载，网页可以先编辑任务…';
      $('health').dataset.state = 'checking';
      setTimeout(checkHealth, 10000);
    } else throw new Error('not ready');
  } catch (_) {
    service = null; $('health').textContent = '界面预览 · 模型未连接'; $('health').dataset.state = 'disconnected';
  }
  $('run').disabled = running || !service; note();
}

$('run').addEventListener('click', async () => {
  if (running || !service) return;
  setError('');
  let categories, instructions, inputs;
  try {
    inputs = inputRows(); categories = parseCategories($('categories').value); instructions = $('instructions').value;
    if (!instructions.trim()) throw new Error('请填写分类规则。');
    const limit = service.limits?.max_candidates;
    if (limit && Object.keys(categories).length > limit) throw new Error(`当前服务一次支持最多 ${limit} 个类别。`);
  } catch (error) { setError(error.message); return; }
  rows = inputs.map(row => ({...row, status: 'pending'})); illustrative = false; stop = false;
  exportHeaders = mode === 'csv' ? [...csv.headers] : [];
  freeze(true); renderRows(); note();
  for (const [index, row] of rows.entries()) {
    if (stop) break;
    $('progress').textContent = `正在处理 ${index + 1} / ${rows.length}…`;
    try {
      if (service.limits?.max_text_chars && row.text.length > service.limits.max_text_chars) throw new Error(`内容超过当前服务的 ${service.limits.max_text_chars} 字符限制。`);
      const request = makeRequest(row.text, instructions, categories);
      let response;
      try {
        response = await fetch('/v1/systemone', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(request), signal: AbortSignal.timeout(300000)});
      } catch (_) { stop = true; throw new Error('连接中断或等待超时，服务器可能仍在处理。后续行未提交，请检查服务后再处理。'); }
      let data;
      try { data = await response.json(); }
      catch (_) { stop = true; throw new Error('服务返回的内容无法读取，已停止提交后续行。'); }
      if (!response.ok) {
        if (response.status !== 422) stop = true;
        throw new Error(response.status === 429 ? '服务正在处理其他请求，后续行未提交。稍后再试。' : (data.error || `服务返回 HTTP ${response.status}`));
      }
      try { Object.assign(row, readAnswer(data, categories)); }
      catch (error) { stop = true; throw error; }
      row.status = 'complete';
    } catch (error) { row.status = 'error'; row.error = error.message; }
    renderRows();
  }
  rows.filter(row => row.status === 'pending').forEach(row => { row.status = 'stopped'; });
  freeze(false); renderRows();
  $('progress').textContent = stop ? '已停止提交后续行。已获得的结果仍可下载；超时的请求可能仍在服务器处理。' : '本批处理结束。请检查结果后使用。';
});

$('stop').addEventListener('click', () => {
  stop = true; $('stop').disabled = true;
  $('progress').textContent = '将在当前请求返回后停止，不再提交后续行。';
});

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('download').addEventListener('click', () => download(illustrative ? 'open-jev-illustrative-example.csv' : 'open-jev-results.csv', resultsCSV(rows, exportHeaders), 'text/csv;charset=utf-8'));
$('download-config').addEventListener('click', () => {
  try {
    const categories = parseCategories($('categories').value);
    if (!$('instructions').value.trim()) throw new Error('请填写分类规则。');
    download('open-jev-task.json', JSON.stringify({instructions: $('instructions').value, categories}, null, 2), 'application/json');
  } catch (error) { setError(error.message); }
});
$('show-demo').addEventListener('click', () => {
  rows = presets[preset].text.split('\n').map((text, index) => ({index: index + 1, text, label: presets[preset].illustrative[index], status: 'illustrative'}));
  illustrative = true; exportHeaders = []; setError(''); refreshPreview(); renderRows(); note();
});
$('csv-file').addEventListener('change', async event => {
  invalidate(); csv = null; $('text-column').disabled = true;
  const file = event.target.files[0]; const version = ++fileVersion;
  if (!file) { refreshPreview(); return; }
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('请使用不超过 2 MB 的 UTF-8 CSV 文件。');
    const text = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
    if (version !== fileVersion) return;
    csv = parseCSV(text); $('text-column').replaceChildren(); $('text-column').disabled = false;
    csv.headers.forEach((header, index) => { const option = node('option', header); option.value = index; $('text-column').append(option); });
    refreshPreview();
  } catch (error) { if (version === fileVersion) { csv = null; setError(error.message); refreshPreview(); } }
});
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => choosePreset(button.dataset.preset)));
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => chooseMode(button.dataset.mode)));
['input-text', 'instructions', 'categories'].forEach(id => $(id).addEventListener('input', invalidate));
$('text-column').addEventListener('change', invalidate);
$('input-text').value = presets.support.text;
choosePreset('support'); chooseMode('text');
$('run').disabled = true;
checkHealth();
