export const MAX_ROWS = 200;

export const presets = {
  support: {
    instructions: '根据客户留言的主要诉求，选择最合适的处理类别。信息不足时选择人工复核。',
    categories: '退款：退款、退货或重复扣款\n物流：快递、配送进度或收货地址\n产品问题：产品故障、损坏或使用问题\n人工复核：信息不足或不属于以上类别',
    text: '这笔订单扣了两次款，请退回多扣的钱。\n包裹三天没更新了，能帮我查一下吗？\n刚买的耳机左边没有声音。',
    illustrative: ['退款', '物流', '产品问题'],
  },
  feedback: {
    instructions: '根据反馈的主要内容选择一个类别。信息不足时选择人工复核。',
    categories: '功能建议：希望增加或改进功能\n故障报告：现有功能无法正常工作\n使用咨询：询问如何使用已有功能\n人工复核：内容含糊或不属于以上类别',
    text: '希望可以把报表导出为 PDF。\n点击保存后页面一直转圈，内容没有存上。\n在哪里修改我的通知设置？',
    illustrative: ['功能建议', '故障报告', '使用咨询'],
  },
  custom: {
    instructions: '按照下方类别的定义，对每条内容选择一个最合适的类别。',
    categories: '需要处理：明确提出待办事项或请求\n仅供参考：提供消息，无需采取行动\n人工复核：信息不足，无法判断',
    text: '请在周五前确认会议时间。\n本月产品更新说明已发布。\n关于上次那件事……',
    illustrative: ['需要处理', '仅供参考', '人工复核'],
  },
};

export function parseCategories(text) {
  const pairs = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.search(/[:：]/);
    const label = (separator < 0 ? line : line.slice(0, separator)).trim();
    const description = separator < 0 ? null : line.slice(separator + 1).trim() || null;
    if (!label) throw new Error('每个类别都需要名称。');
    return [label, description];
  });
  if (pairs.length < 2 || pairs.length > 20) throw new Error('请填写 2–20 个类别，每行一个。');
  if (new Set(pairs.map(([label]) => label)).size !== pairs.length) throw new Error('类别名称不能重复。');
  return Object.fromEntries(pairs);
}

// RFC 4180-style comma-separated CSV, including quoted newlines and UTF-8 BOM.
export function parseCSV(source) {
  source = source.replace(/^\uFEFF/, '');
  const records = [];
  let record = [], field = '', quoted = false, closed = false, started = false;
  function finishField() { record.push(field); field = ''; closed = false; started = false; }
  function finishRecord() {
    finishField(); records.push(record); record = [];
    if (records.length > MAX_ROWS + 1) throw new Error(`一次最多处理 ${MAX_ROWS} 行，请拆分文件。`);
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',') finishField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      finishRecord();
    } else if (closed) throw new Error('CSV 引号后有多余字符，请检查文件格式。');
    else if (char === '"') {
      if (started) throw new Error('CSV 中有未正确转义的引号。');
      quoted = true; started = true;
    } else { field += char; started = true; }
  }
  if (quoted) throw new Error('CSV 有未闭合的引号。');
  if (record.length || started || closed || field) finishRecord();
  if (records.length < 2) throw new Error('CSV 需要一行列名和至少一行内容。');
  const headers = records.shift().map(header => header.trim());
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) {
    throw new Error('CSV 列名不能为空或重复。');
  }
  for (const [index, row] of records.entries()) {
    if (row.length !== headers.length) throw new Error(`CSV 第 ${index + 2} 行的列数与列名不一致。`);
  }
  return {headers, rows: records};
}

export function makeRequest(text, instructions, categories) {
  if (!text.trim()) throw new Error('这一行没有可分类的文字。');
  if (!instructions.trim()) throw new Error('请填写分类规则。');
  return {state: text, questions: {category: {type: 'choice', instructions: instructions.trim(), criteria: categories}}};
}

export function readAnswer(data, categories) {
  if (!data || typeof data !== 'object' || !data.answers || Object.keys(data.answers).join() !== 'category') {
    throw new Error('服务返回了不匹配的判断结果。');
  }
  const answer = data.answers.category;
  const labels = Object.keys(categories);
  const probabilities = answer?.probabilities;
  if (answer?.type !== 'choice' || !probabilities || Array.isArray(probabilities) ||
      Object.keys(probabilities).length !== labels.length ||
      labels.some(label => !Object.hasOwn(probabilities, label)) || !labels.includes(answer.choice)) {
    throw new Error('服务返回的类别与当前任务不一致。');
  }
  const values = labels.map(label => probabilities[label]);
  if (values.some(p => typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) ||
      Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 1e-6 ||
      probabilities[answer.choice] < Math.max(...values) - 1e-12) {
    throw new Error('服务返回的概率无效，未采用此结果。');
  }
  return {label: answer.choice, probability: probabilities[answer.choice], probabilities,
    model: typeof data.model === 'string' ? data.model : ''};
}

function csvCell(value) {
  let text = String(value ?? '');
  // Treat spreadsheet formula prefixes as text, including after whitespace.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function resultsCSV(rows, sourceHeaders = []) {
  if (sourceHeaders.length) {
    const used = new Set(sourceHeaders);
    const columns = ['row', 'category', 'category_probability', 'status', 'error', 'all_probabilities', 'model'].map(key => {
      let name = `open_jev_${key}`;
      while (used.has(name)) name += '_result';
      used.add(name); return name;
    });
    const table = [[...sourceHeaders, ...columns], ...rows.map(row => [...row.original,
      row.index, row.label, row.probability, row.status, row.error,
      row.probabilities ? JSON.stringify(row.probabilities) : '', row.model])];
    return '\uFEFF' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  const table = [['row', 'text', 'category', 'category_probability', 'status', 'error', 'all_probabilities', 'model']];
  rows.forEach(row => table.push([row.index, row.text, row.label, row.probability, row.status,
    row.error, row.probabilities ? JSON.stringify(row.probabilities) : '', row.model]));
  return '\uFEFF' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
