import AdmZip from 'adm-zip';

function columnLetterToIndex(columnLetter) {
  let index = 0;
  for (let i = 0; i < columnLetter.length; i++) {
    index = index * 26 + (columnLetter.charCodeAt(i) - 64);
  }
  return index - 1;
}

export function parseCsv(text) {
  if (typeof text !== 'string') return [];
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return [];

  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if ((char === ',' || char === '\t' || char === ';') && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some(cell => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function parseXlsx(buffer) {
  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries();

  // 1. Shared strings
  const sharedStrings = [];
  const sharedStringsEntry = zipEntries.find(e => e.entryName === 'xl/sharedStrings.xml');
  if (sharedStringsEntry) {
    const xml = sharedStringsEntry.getData().toString('utf8');
    // Extract each <si> item
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(xml)) !== null) {
      const siContent = siMatch[1];
      const tMatches = siContent.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || [];
      const text = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
      sharedStrings.push(decodeXml(text));
    }
  }

  // 2. Sheet XML (prefer sheet1.xml or first worksheet)
  const sheetEntry = zipEntries.find(e => e.entryName === 'xl/worksheets/sheet1.xml') ||
    zipEntries.find(e => e.entryName.startsWith('xl/worksheets/sheet'));
  if (!sheetEntry) return [];

  const sheetXml = sheetEntry.getData().toString('utf8');
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowContent = rowMatch[1];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    const rowCells = [];

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const attrs = cellMatch[1];
      const cellBody = cellMatch[2];

      const rMatch = attrs.match(/r="([A-Z]+)(\d+)"/);
      const isString = /t="s"/.test(attrs);
      const isInlineStr = /t="inlineStr"/.test(attrs);

      let val = '';
      if (isString) {
        const vMatch = cellBody.match(/<v>(\d+)<\/v>/);
        if (vMatch) {
          const sIdx = Number.parseInt(vMatch[1], 10);
          val = sharedStrings[sIdx] || '';
        }
      } else if (isInlineStr) {
        const tMatch = cellBody.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        val = tMatch ? decodeXml(tMatch[1]) : '';
      } else {
        const vMatch = cellBody.match(/<v>([\s\S]*?)<\/v>/);
        val = vMatch ? decodeXml(vMatch[1]) : '';
      }

      const colIdx = rMatch ? columnLetterToIndex(rMatch[1]) : rowCells.length;
      rowCells[colIdx] = String(val).trim();
    }

    // Fill holes in row
    const normalizedRow = [];
    for (let c = 0; c < rowCells.length; c++) {
      normalizedRow.push(rowCells[c] || '');
    }
    if (normalizedRow.some(c => c.length > 0)) {
      rows.push(normalizedRow);
    }
  }

  return rows;
}

function decodeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function normalizeSpreadsheetRows(rawRows, companyCatalog = []) {
  if (!Array.isArray(rawRows) || rawRows.length < 2) return [];

  const headers = rawRows[0].map(h => String(h || '').trim().toLowerCase());
  const headerMap = {};

  headers.forEach((h, index) => {
    if (/^(emp(loyee)?[\s_-]?(id|code)|id|code)$/i.test(h)) headerMap.employeeCode = index;
    else if (/^(full[\s_-]?name|display[\s_-]?name|name|employee[\s_-]?name|staff[\s_-]?name)$/i.test(h)) headerMap.displayName = index;
    else if (/^(email|e[\s_-]?mail|work[\s_-]?email)$/i.test(h)) headerMap.email = index;
    else if (/^(job[\s_-]?title|title|role|designation|position)$/i.test(h)) headerMap.jobTitle = index;
    else if (/^(department|dept|team|division)$/i.test(h)) headerMap.department = index;
    else if (/^(experience([\s_-]?level)?|level|seniority)$/i.test(h)) headerMap.experienceLevel = index;
    else if (/^(access([\s_-]?role)?|role|permission)$/i.test(h) && headerMap.jobTitle !== index) headerMap.accessRole = index;
  });

  const candidates = [];
  const defaultDept = companyCatalog[0]?.department || 'Engineering';
  const defaultTitle = companyCatalog[0]?.titles?.[0] || 'Software developer';

  for (let r = 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || !row.some(cell => String(cell || '').trim().length > 0)) continue;

    const rawName = headerMap.displayName !== undefined ? row[headerMap.displayName] : row[0];
    const rawEmail = headerMap.email !== undefined ? row[headerMap.email] : row[1];
    const rawId = headerMap.employeeCode !== undefined ? row[headerMap.employeeCode] : '';
    const rawTitle = headerMap.jobTitle !== undefined ? row[headerMap.jobTitle] : '';
    const rawDept = headerMap.department !== undefined ? row[headerMap.department] : '';
    const rawExp = headerMap.experienceLevel !== undefined ? row[headerMap.experienceLevel] : '';
    const rawRole = headerMap.accessRole !== undefined ? row[headerMap.accessRole] : '';

    const displayName = String(rawName || '').trim();
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!displayName && !email) continue;

    // Normalizing experience level
    let experienceLevel = 'mid-level';
    const expLower = String(rawExp || '').toLowerCase();
    if (expLower.includes('fresh') || expLower.includes('junior') || expLower.includes('entry')) {
      experienceLevel = 'fresher';
    } else if (expLower.includes('senior') || expLower.includes('lead') || expLower.includes('principal')) {
      experienceLevel = 'senior';
    }

    // Normalizing access role
    let accessRole = 'employee';
    const roleLower = String(rawRole || rawTitle || '').toLowerCase();
    if (roleLower.includes('hr manager') || roleLower.includes('human resources manager')) {
      accessRole = 'hr-manager';
    } else if (roleLower.includes('hr') || roleLower.includes('people ops')) {
      accessRole = 'hr';
    } else if (roleLower.includes('lead') || roleLower.includes('team lead')) {
      accessRole = 'team-leader';
    } else if (roleLower.includes('manager') || roleLower.includes('director')) {
      accessRole = 'manager';
    }

    // Matching department / title against company catalog if possible
    let department = String(rawDept || '').trim();
    let jobTitle = String(rawTitle || '').trim();

    if (companyCatalog.length > 0) {
      const matchedDept = companyCatalog.find(
        c => c.department.toLowerCase() === department.toLowerCase()
      );
      if (matchedDept) {
        department = matchedDept.department;
        const matchedTitle = matchedDept.titles.find(
          t => t.toLowerCase() === jobTitle.toLowerCase()
        );
        if (matchedTitle) {
          jobTitle = matchedTitle;
        } else if (!jobTitle) {
          jobTitle = matchedDept.titles[0] || defaultTitle;
        }
      } else if (!department) {
        department = defaultDept;
        jobTitle = jobTitle || defaultTitle;
      }
    } else {
      department = department || 'General';
      jobTitle = jobTitle || 'Team Member';
    }

    const employeeCode = String(rawId || '').trim() || `EMP-${String(candidates.length + 1).padStart(3, '0')}`;

    candidates.push({
      employeeCode,
      displayName: displayName || email.split('@')[0],
      email,
      jobTitle,
      department,
      experienceLevel,
      accessRole
    });
  }

  return candidates;
}

export function parseSpreadsheet(data, { filename = '', catalog = [] } = {}) {
  let rawRows = [];

  const isZip = Buffer.isBuffer(data) && data.length > 4 &&
    data[0] === 0x50 && data[1] === 0x4B && data[2] === 0x03 && data[3] === 0x04;

  if (isZip || filename.endsWith('.xlsx')) {
    rawRows = parseXlsx(data);
  } else {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
    rawRows = parseCsv(text);
  }

  return normalizeSpreadsheetRows(rawRows, catalog);
}
