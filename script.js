/* ==========================================================================
   Course Coverage Review and Discussion Meeting Form  |  UITS CSE
   Vanilla JavaScript, no build step. PDF output uses jsPDF + jsPDF-AutoTable.

   Contents
     1. Constants and small helpers
     2. State (read from / write to the form)
     3. Teacher rows
     4. Persistence (localStorage)
     5. Validation and text cleaning
     6. Document data shared by the PDF and the print sheet
     7. PDF generation
     8. Print sheet
     9. UI helpers (toast, reset dialog)
    10. Event wiring and start-up
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Constants and small helpers
   * ------------------------------------------------------------------ */
  var STORAGE_KEY = 'uits-cse-course-coverage-form:v1';
  var SAVE_DELAY_MS = 200;

  var CRITERIA = [
    { key: 'beginning', label: 'Beginning of the Semester' },
    { key: 'midterm', label: 'Midterm' },
    { key: 'final', label: 'Final' }
  ];

  // State key -> id of the matching text control
  var TEXT_FIELDS = {
    semester: 'semester',
    courseCode: 'courseCode',
    courseTitle: 'courseTitle',
    meetingVenue: 'meetingVenue',
    meetingDate: 'meetingDate',
    meetingTime: 'meetingTime',
    covered: 'covered',
    notCovered: 'notCovered',
    partiallyCovered: 'partiallyCovered',
    discussion: 'discussion'
  };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  var FORM_TITLE = 'Course Coverage Review and Discussion Meeting Form';
  var UNIVERSITY = 'UNIVERSITY OF INFORMATION TECHNOLOGY & SCIENCES';
  var DEPARTMENT = 'Department of Computer Science and Engineering';

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function nowHHMM(d) {
    d = d || new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var mi = parseInt(m[2], 10) - 1;
    if (mi < 0 || mi > 11) return '';
    return m[3] + ' ' + MONTHS[mi] + ' ' + m[1];
  }

  function formatTime(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
    if (!m) return '';
    var h = parseInt(m[1], 10);
    return ((h % 12) || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  /* ------------------------------------------------------------------ *
   * 2. State: the form itself is the single source of truth
   * ------------------------------------------------------------------ */
  var el = {};   // cached elements, filled in init()

  function defaultState() {
    return {
      criteria: { beginning: false, midterm: false, final: false, others: false },
      othersText: '',
      semester: '',
      courseCode: '',
      courseTitle: '',
      meetingDate: todayISO(),
      meetingTime: nowHHMM(),
      meetingVenue: '',
      teachers: [''],
      covered: '',
      notCovered: '',
      partiallyCovered: '',
      discussion: ''
    };
  }

  function getState() {
    var s = {
      criteria: {},
      othersText: el.othersText.value,
      teachers: []
    };
    el.criteriaBoxes.forEach(function (box) {
      s.criteria[box.getAttribute('data-criterion')] = box.checked;
    });
    Object.keys(TEXT_FIELDS).forEach(function (key) {
      s[key] = $(TEXT_FIELDS[key]).value;
    });
    el.teacherList.querySelectorAll('.teacher-input').forEach(function (input) {
      s.teachers.push(input.value);
    });
    return s;
  }

  function setState(state) {
    el.criteriaBoxes.forEach(function (box) {
      box.checked = !!state.criteria[box.getAttribute('data-criterion')];
    });
    el.othersText.value = state.othersText;
    Object.keys(TEXT_FIELDS).forEach(function (key) {
      $(TEXT_FIELDS[key]).value = state[key];
    });
    el.teacherList.textContent = '';
    (state.teachers.length ? state.teachers : ['']).forEach(function (name) {
      el.teacherList.appendChild(createTeacherRow(name));
    });
    renumberTeachers();
    syncOthers();
  }

  // Accepts anything read from storage and returns a complete, well-typed state.
  function sanitizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return null;
    var str = function (v, fallback) { return typeof v === 'string' ? v : fallback; };

    var out = defaultState();
    var c = raw.criteria && typeof raw.criteria === 'object' ? raw.criteria : {};
    Object.keys(base.criteria).forEach(function (k) { out.criteria[k] = c[k] === true; });
    out.othersText = str(raw.othersText, '');
    Object.keys(TEXT_FIELDS).forEach(function (k) { out[k] = str(raw[k], base[k]); });
    if (Array.isArray(raw.teachers)) {
      out.teachers = raw.teachers.map(function (t) { return typeof t === 'string' ? t : ''; });
      if (!out.teachers.length) out.teachers = [''];
    }
    return out;
  }

  function syncOthers() {
    var on = el.othersBox.checked;
    el.othersWrap.hidden = !on;
    el.othersBox.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!on) clearOthersError();
  }

  /* ------------------------------------------------------------------ *
   * 3. Teacher rows
   * ------------------------------------------------------------------ */
  var teacherSeq = 0;

  function createTeacherRow(value) {
    var li = document.createElement('li');
    li.className = 'teacher-row';

    var no = document.createElement('span');
    no.className = 'teacher-no';
    no.setAttribute('aria-hidden', 'true');

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'teacher-input';
    input.id = 'teacher-' + (++teacherSeq);
    input.maxLength = 120;
    input.placeholder = 'Full name of teacher';
    input.autocomplete = 'off';
    input.value = value || '';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-remove';
    var x = document.createElement('span');
    x.className = 'x';
    x.setAttribute('aria-hidden', 'true');
    x.textContent = '\u00D7';
    var txt = document.createElement('span');
    txt.className = 'btn-text';
    txt.textContent = 'Remove';
    btn.appendChild(x);
    btn.appendChild(txt);

    li.appendChild(no);
    li.appendChild(input);
    li.appendChild(btn);
    return li;
  }

  function renumberTeachers() {
    var rows = el.teacherList.children;
    for (var i = 0; i < rows.length; i++) {
      var n = i + 1;
      rows[i].querySelector('.teacher-no').textContent = n + '.';
      rows[i].querySelector('.teacher-input').setAttribute('aria-label', 'Name of teacher ' + n);
      var btn = rows[i].querySelector('.btn-remove');
      btn.setAttribute('aria-label', 'Remove teacher ' + n);
      btn.title = 'Remove teacher ' + n;
      btn.disabled = rows.length === 1;
    }
  }

  function addTeacher(focus) {
    var li = createTeacherRow('');
    el.teacherList.appendChild(li);
    renumberTeachers();
    save();
    if (focus) li.querySelector('input').focus();
    return li;
  }

  function removeTeacher(li) {
    var rows = Array.prototype.slice.call(el.teacherList.children);
    if (rows.length <= 1) return;
    var idx = rows.indexOf(li);
    li.remove();
    renumberTeachers();
    save();
    var next = el.teacherList.children[Math.min(idx, el.teacherList.children.length - 1)];
    if (next) next.querySelector('input').focus();
  }

  /* ------------------------------------------------------------------ *
   * 4. Persistence
   * ------------------------------------------------------------------ */
  var saveTimer = null;
  var storageOk = true;

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(getState()));
      storageOk = true;
      setSaveNote('Changes are saved automatically in this browser. Last saved at ' +
        formatTime(nowHHMM()) + '.');
    } catch (err) {
      storageOk = false;
      setSaveNote('Automatic saving is unavailable in this browser (storage is blocked or full). ' +
        'Keep this page open, and download the PDF before leaving.');
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  // Writes only if a change is waiting, so a reset is never undone on page exit.
  function flushSave() {
    if (saveTimer !== null) save();
  }

  function loadSaved() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return sanitizeState(JSON.parse(raw));
    } catch (err) {
      return null;
    }
  }

  function setSaveNote(text) {
    el.saveNote.textContent = text;
  }

  /* ------------------------------------------------------------------ *
   * 5. Validation and text cleaning
   * ------------------------------------------------------------------ */

  // Normalises text typed or pasted by the user (multi-line fields).
  function cleanText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, '    ')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/[\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .replace(/[ ]+\n/g, '\n')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
  }

  // Same, for single-line fields.
  function cleanLine(value) {
    return cleanText(value).replace(/\s*\n\s*/g, ' ').trim();
  }

  // The PDF uses built-in PDF fonts (WinAnsi): Latin letters, digits, common punctuation.
  var WINANSI_EXTRA = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152' +
    '\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';

  function isPdfSafeChar(ch) {
    var c = ch.charCodeAt(0);
    return c === 10 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.indexOf(ch) !== -1;
  }

  function hasUnsupportedChars(text) {
    var s = cleanText(text);
    for (var i = 0; i < s.length; i++) {
      if (!isPdfSafeChar(s.charAt(i))) return true;
    }
    return false;
  }

  function findUnsupportedFields(state) {
    var labels = [];
    var check = function (label, text) { if (hasUnsupportedChars(text)) labels.push(label); };
    if (state.criteria.others) check('Others criterion', state.othersText);
    check('Semester', state.semester);
    check('Course Code', state.courseCode);
    check('Course Title', state.courseTitle);
    check('Meeting Venue', state.meetingVenue);
    if (state.teachers.some(hasUnsupportedChars)) labels.push('Teacher names');
    check('Covered', state.covered);
    check('Not Covered', state.notCovered);
    check('Partially Covered', state.partiallyCovered);
    check('Meeting Discussion and Decisions', state.discussion);
    return labels;
  }

  function clearOthersError() {
    el.othersText.removeAttribute('aria-invalid');
    el.othersError.hidden = true;
    el.othersError.textContent = '';
  }

  // "Others" ticked but nothing specified: the one case we stop for.
  function validateOthers() {
    var s = getState();
    if (s.criteria.others && !cleanLine(s.othersText)) {
      el.othersText.setAttribute('aria-invalid', 'true');
      el.othersError.textContent = 'Please specify the criterion, or untick \u201COthers\u201D.';
      el.othersError.hidden = false;
      el.othersText.focus();
      return false;
    }
    clearOthersError();
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 6. Document data shared by the PDF and the print sheet
   * ------------------------------------------------------------------ */
  function buildDocData(state) {
    var criteria = [];
    CRITERIA.forEach(function (c) {
      if (state.criteria[c.key]) criteria.push(c.label);
    });
    if (state.criteria.others) {
      var other = cleanLine(state.othersText);
      if (other) criteria.push(other);
    }
    return {
      criteria: criteria,
      semester: cleanLine(state.semester),
      courseCode: cleanLine(state.courseCode),
      courseTitle: cleanLine(state.courseTitle),
      date: formatDate(state.meetingDate),
      time: formatTime(state.meetingTime),
      venue: cleanLine(state.meetingVenue),
      teachers: state.teachers.map(cleanLine),
      covered: cleanText(state.covered),
      notCovered: cleanText(state.notCovered),
      partiallyCovered: cleanText(state.partiallyCovered),
      discussion: cleanText(state.discussion)
    };
  }

  /* ------------------------------------------------------------------ *
   * 7. PDF generation (A4 portrait, jsPDF + AutoTable)
   * ------------------------------------------------------------------ */
  var P = { W: 210, H: 297, mL: 20, mR: 20, topNext: 24, bottom: 22 };
  var CW = P.W - P.mL - P.mR;                 // 170 mm content width
  var NAVY = [27, 47, 75];
  var INK = [25, 25, 25];
  var RULE = [80, 80, 80];
  var FILL = [241, 243, 247];
  var LABEL_INK = [30, 40, 55];
  var GREY = [110, 110, 110];

  var CELL_PAD = { top: 2.2, right: 3, bottom: 2.2, left: 3 };
  var PAD_X = CELL_PAD.left + CELL_PAD.right;
  var PT_TO_MM = 25.4 / 72;

  var SIG = { gap: 8, space: 22, labelBlock: 12 };
  var SIG_RESERVE = SIG.gap + SIG.space + SIG.labelBlock;

  var META_COLS = [24, 38, 24, 24, 24, 36];  // sums to CW

  function pdfLibsReady() {
    return !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API &&
      typeof window.jspdf.jsPDF.API.autoTable === 'function');
  }

  // Breaks any "word" wider than maxW so it can never run past its cell.
  function breakLongWords(doc, text, maxW) {
    return text.split('\n').map(function (line) {
      return line.split(/( +)/).map(function (tok) {
        if (!tok || /^ +$/.test(tok) || doc.getTextWidth(tok) <= maxW) return tok;
        var out = '';
        var cur = '';
        for (var i = 0; i < tok.length; i++) {
          if (cur && doc.getTextWidth(cur + tok.charAt(i)) > maxW) {
            out += cur + '\n';
            cur = tok.charAt(i);
          } else {
            cur += tok.charAt(i);
          }
        }
        return out + cur;
      }).join('');
    }).join('\n');
  }

  // Text for a body cell of the given column width (mm).
  function fitCell(doc, text, colWidth) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    return breakLongWords(doc, text, colWidth - PAD_X - 0.8);
  }

  function labelCell(text) {
    return {
      content: text,
      styles: { fontStyle: 'bold', fontSize: 9.5, fillColor: FILL, textColor: LABEL_INK }
    };
  }

  function baseTable() {
    return {
      theme: 'grid',
      tableWidth: CW,
      styles: {
        font: 'helvetica',
        fontStyle: 'normal',
        fontSize: 10,
        textColor: INK,
        fillColor: [255, 255, 255],
        lineColor: RULE,
        lineWidth: 0.25,
        cellPadding: CELL_PAD,
        valign: 'middle',
        halign: 'left',
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: FILL,
        textColor: LABEL_INK,
        fontStyle: 'bold',
        fontSize: 9.5,
        halign: 'center',
        lineColor: RULE,
        lineWidth: 0.25
      },
      showHead: 'everyPage'
    };
  }

  // Lays out the Criteria bullets so the cell height is known before drawing.
  function layoutCriteria(doc, items, cellW) {
    var fs = 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fs);
    var lh = fs * doc.getLineHeightFactor() * PT_TO_MM;
    var indent = 5;
    var textW = cellW - PAD_X - indent - 0.8;
    var entries = items.map(function (t) {
      return doc.splitTextToSize(breakLongWords(doc, t, textW), textW);
    });
    var gap = 0.8;
    var inner = 0;
    entries.forEach(function (lines) { inner += lines.length * lh; });
    inner += gap * Math.max(0, entries.length - 1);
    return { entries: entries, lh: lh, indent: indent, gap: gap, inner: inner };
  }

  function meetingTable(doc, d) {
    var c = META_COLS;
    var valueW = function (i, span) {
      var w = 0;
      for (var k = 0; k < (span || 1); k++) w += c[i + k];
      return w;
    };
    var crit = layoutCriteria(doc, d.criteria, valueW(1, 5));
    var critHeight = Math.max(8.6, crit.inner + CELL_PAD.top + CELL_PAD.bottom);

    var opts = baseTable();
    opts.columnStyles = {};
    c.forEach(function (w, i) { opts.columnStyles[i] = { cellWidth: w }; });
    opts.body = [
      [
        labelCell('Criteria'),
        { content: '', colSpan: 5, styles: { minCellHeight: critHeight } }
      ],
      [
        labelCell('Semester'),
        fitCell(doc, d.semester, valueW(1)),
        labelCell('Course Code'),
        { content: fitCell(doc, d.courseCode, valueW(3, 3)), colSpan: 3 }
      ],
      [
        labelCell('Course Title'),
        { content: fitCell(doc, d.courseTitle, valueW(1, 5)), colSpan: 5 }
      ],
      [
        labelCell('Meeting Date'),
        d.date,
        labelCell('Meeting Time'),
        d.time,
        labelCell('Meeting Venue'),
        fitCell(doc, d.venue, valueW(5))
      ]
    ];
    opts.didDrawCell = function (data) {
      if (data.section !== 'body' || data.row.index !== 0 || data.column.index !== 1) return;
      var g = data.doc;
      var x = data.cell.x + CELL_PAD.left;
      var y = data.cell.y + (data.cell.height - crit.inner) / 2;
      g.setFont('helvetica', 'normal');
      g.setFontSize(10);
      g.setTextColor(INK[0], INK[1], INK[2]);
      g.setFillColor(INK[0], INK[1], INK[2]);
      crit.entries.forEach(function (lines) {
        g.circle(x + 1.2, y + crit.lh / 2, 0.62, 'F');
        lines.forEach(function (line, i) {
          g.text(line, x + crit.indent, y + i * crit.lh + crit.lh / 2 + 1.27);
        });
        y += lines.length * crit.lh + crit.gap;
      });
    };
    return opts;
  }

  function teacherTable(doc, d) {
    var opts = baseTable();
    var nameW = 104;
    opts.columnStyles = {
      0: { cellWidth: 16, halign: 'center' },
      1: { cellWidth: nameW },
      2: { cellWidth: 50 }
    };
    opts.head = [['No.', 'Name of Teacher', 'Signature']];
    opts.bodyStyles = { minCellHeight: 11 };
    opts.body = d.teachers.map(function (name, i) {
      return [String(i + 1), fitCell(doc, name, nameW), ''];
    });
    return opts;
  }

  function coverageTable(doc, d) {
    var colW = CW / 3;
    var opts = baseTable();
    opts.columnStyles = {
      0: { cellWidth: colW }, 1: { cellWidth: colW }, 2: { cellWidth: colW }
    };
    opts.head = [['Covered', 'Not Covered', 'Partially Covered']];
    opts.bodyStyles = { valign: 'top', minCellHeight: 35 };
    opts.body = [[
      fitCell(doc, d.covered, colW),
      fitCell(doc, d.notCovered, colW),
      fitCell(doc, d.partiallyCovered, colW)
    ]];
    return opts;
  }

  function discussionTable(doc, d) {
    var opts = baseTable();
    opts.columnStyles = { 0: { cellWidth: CW } };
    opts.bodyStyles = { valign: 'top', minCellHeight: 35 };
    opts.body = [[fitCell(doc, d.discussion, CW)]];
    return opts;
  }

  // Height a table would take, measured on a scratch document with a very tall page.
  function measureTable(jsPDF, opts) {
    var scratch = new jsPDF({ unit: 'mm', format: [P.W, 3000], orientation: 'portrait' });
    var copy = Object.assign({}, opts, {
      startY: 0,
      margin: { top: 0, right: P.mR, bottom: 0, left: P.mL }
    });
    scratch.autoTable(copy);
    return scratch.lastAutoTable.finalY;
  }

  function drawHeading(doc, y, title, note) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text(title, P.mL, y + 3.9);
    var h = 5;
    if (note) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(85, 85, 85);
      doc.text(note, P.mL, y + 5 + 3.2);
      h += 4.5;
    }
    return y + h + 2.2;
  }

  /* Draws a numbered section (heading + table), keeping them together:
     - if the whole section fits on the current page it stays there;
     - if not, but it fits on a fresh page, it moves to a new page;
     - only a section taller than a page is split (long text boxes). */
  function placeSection(ctx, y, spec) {
    var doc = ctx.doc;
    var reserve = spec.reserve || 0;
    var limit = P.H - P.bottom - reserve;
    var tableH = measureTable(ctx.jsPDF, spec.table);
    var headH = (spec.note ? 9.5 : 5) + 2.2;
    var gap = y > P.topNext + 0.5 ? 6 : 0;
    var fits = true;

    if (gap + headH + tableH > limit - y) {
      if (headH + tableH <= limit - P.topNext) {
        doc.addPage();
        y = P.topNext;
        gap = 0;
      } else {
        fits = false;
        if (limit - y < gap + headH + 45) {
          doc.addPage();
          y = P.topNext;
          gap = 0;
        }
      }
    }

    var tableY = drawHeading(doc, y + gap, spec.title, spec.note);
    var opts = Object.assign({}, spec.table, {
      startY: tableY,
      margin: { top: P.topNext, right: P.mR, bottom: P.bottom + reserve, left: P.mL },
      rowPageBreak: fits || !spec.splitRows ? 'avoid' : 'auto'
    });
    doc.autoTable(opts);
    return doc.lastAutoTable.finalY;
  }

  function drawTitleBlock(doc) {
    var cx = P.W / 2;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.setFontSize(15);
    doc.text(UNIVERSITY, cx, 22, { align: 'center' });

    doc.setFontSize(11);
    doc.setTextColor(60, 60, 60);
    doc.text(DEPARTMENT, cx, 28.4, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text(FORM_TITLE.toUpperCase(), cx, 38.5, { align: 'center' });

    doc.setDrawColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.setLineWidth(0.6);
    doc.line(P.mL, 42, P.W - P.mR, 42);
    doc.setDrawColor(140, 140, 140);
    doc.setLineWidth(0.2);
    doc.line(P.mL, 43.2, P.W - P.mR, 43.2);
    return 43.2;
  }

  function drawSignature(doc, y) {
    var w = 74;
    var x2 = P.W - P.mR;
    var x1 = x2 - w;
    var lineY = y + SIG.space;
    doc.setDrawColor(40, 40, 40);
    doc.setLineWidth(0.3);
    doc.line(x1, lineY, x2, lineY);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Signature of Head of the Department', (x1 + x2) / 2, lineY + 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('Department of CSE, UITS', (x1 + x2) / 2, lineY + 10, { align: 'center' });
  }

  function truncateToWidth(doc, text, maxW) {
    if (doc.getTextWidth(text) <= maxW) return text;
    var t = text;
    while (t.length > 1 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
    return t.replace(/\s+$/, '') + '...';
  }

  // Running header (pages 2+) and footer (all pages), added once pagination is final.
  function decoratePages(doc, d) {
    var total = doc.getNumberOfPages();
    var course = [d.courseCode, d.courseTitle].filter(Boolean).join(' - ');

    for (var i = 1; i <= total; i++) {
      doc.setPage(i);

      if (i > 1) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(GREY[0], GREY[1], GREY[2]);
        doc.text('UITS  |  Department of CSE', P.mL, 13.5);
        if (course) {
          doc.text(truncateToWidth(doc, course, 110), P.W - P.mR, 13.5, { align: 'right' });
        }
        doc.setDrawColor(190, 190, 190);
        doc.setLineWidth(0.2);
        doc.line(P.mL, 16, P.W - P.mR, 16);
      }

      doc.setDrawColor(190, 190, 190);
      doc.setLineWidth(0.2);
      doc.line(P.mL, 282, P.W - P.mR, 282);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(GREY[0], GREY[1], GREY[2]);
      doc.text(FORM_TITLE, P.mL, 287);
      doc.text('Page ' + i + ' of ' + total, P.W - P.mR, 287, { align: 'right' });
    }
  }

  function buildPdf(state) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    var d = buildDocData(state);
    var ctx = { jsPDF: jsPDF, doc: doc };

    doc.setProperties({
      title: FORM_TITLE + (d.courseCode ? ' - ' + d.courseCode : ''),
      subject: 'Department of Computer Science and Engineering, UITS',
      author: 'Department of CSE, UITS',
      creator: FORM_TITLE
    });

    var y = drawTitleBlock(doc);

    y = placeSection(ctx, y, {
      title: '1. Meeting Information',
      table: meetingTable(doc, d)
    });
    y = placeSection(ctx, y, {
      title: '2. Participating Course Teachers',
      table: teacherTable(doc, d)
    });
    y = placeSection(ctx, y, {
      title: '3. Course Coverage',
      note: 'Write the topics under the appropriate category.',
      table: coverageTable(doc, d),
      splitRows: true
    });
    // The signature block is reserved below the last box, so it always shares
    // a page with the end of the discussion text.
    y = placeSection(ctx, y, {
      title: '4. Meeting Discussion and Decisions',
      table: discussionTable(doc, d),
      splitRows: true,
      reserve: SIG_RESERVE
    });
    drawSignature(doc, y + SIG.gap);

    decoratePages(doc, d);
    return { doc: doc, data: d };
  }

  function pdfFileName(d, state) {
    var parts = ['Course-Coverage-Meeting', d.courseCode, state.meetingDate]
      .filter(Boolean)
      .join('_')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return parts + '.pdf';
  }

  function handlePdf(mode) {
    flushSave();
    if (!validateOthers()) return;

    var state = getState();
    var unsupported = findUnsupportedFields(state);
    if (unsupported.length) {
      toast('The PDF can only contain Latin characters (for example English). Found in: ' +
        unsupported.join(', ') + '. For other scripts such as Bangla, use Print and choose \u201CSave as PDF\u201D.',
        'error', 9000);
      return;
    }
    if (!pdfLibsReady()) {
      toast('The PDF library could not be loaded. Check your internet connection and reload the page. Print still works.',
        'error', 8000);
      return;
    }

    // Open the preview tab inside the click handler so pop-up blockers allow it.
    var win = mode === 'preview' ? window.open('', '_blank') : null;

    try {
      var built = buildPdf(state);
      var fileName = pdfFileName(built.data, state);
      if (mode === 'preview' && win) {
        var url = URL.createObjectURL(built.doc.output('blob'));
        win.location.href = url;
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      } else {
        built.doc.save(fileName);
        toast(mode === 'preview'
          ? 'Your browser blocked the preview tab, so the PDF was downloaded instead.'
          : 'PDF downloaded: ' + fileName);
      }
    } catch (err) {
      if (win) win.close();
      if (window.console) console.error(err);
      toast('Sorry, the PDF could not be created. Please try Print instead.', 'error', 7000);
    }
  }

  /* ------------------------------------------------------------------ *
   * 8. Print sheet (HTML twin of the PDF; shown only by @media print)
   * ------------------------------------------------------------------ */
  function h(tag, className, content) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) {
      if (Array.isArray(content)) {
        content.forEach(function (child) { if (child) node.appendChild(child); });
      } else if (typeof content === 'object') {
        node.appendChild(content);
      } else {
        node.textContent = content;
      }
    }
    return node;
  }

  function cell(tag, className, content, colSpan) {
    var c = h(tag, className, content);
    if (colSpan) c.colSpan = colSpan;
    return c;
  }

  function colgroup(widths) {
    var g = document.createElement('colgroup');
    widths.forEach(function (w) {
      var col = document.createElement('col');
      col.style.width = w + 'mm';
      g.appendChild(col);
    });
    return g;
  }

  function section(title, note, table) {
    return h('section', 'ps-section', [
      h('h2', 'ps-h', title),
      note ? h('p', 'ps-note', note) : null,
      table
    ]);
  }

  function renderPrintSheet() {
    var d = buildDocData(getState());
    var sheet = el.printSheet;
    sheet.textContent = '';

    sheet.appendChild(h('header', 'ps-head', [
      h('p', 'ps-uni', UNIVERSITY),
      h('p', 'ps-dept', DEPARTMENT),
      h('h1', 'ps-title', FORM_TITLE.toUpperCase())
    ]));

    // 1. Meeting information
    var info = h('table', 'ps-table');
    info.appendChild(colgroup(META_COLS));
    var bullets = h('ul', 'ps-bullets', d.criteria.map(function (t) { return h('li', null, t); }));
    var tb = document.createElement('tbody');
    tb.appendChild(h('tr', null, [
      cell('td', 'ps-label', 'Criteria'),
      cell('td', null, d.criteria.length ? bullets : '', 5)
    ]));
    tb.appendChild(h('tr', null, [
      cell('td', 'ps-label', 'Semester'), cell('td', null, d.semester),
      cell('td', 'ps-label', 'Course Code'), cell('td', null, d.courseCode, 3)
    ]));
    tb.appendChild(h('tr', null, [
      cell('td', 'ps-label', 'Course Title'), cell('td', null, d.courseTitle, 5)
    ]));
    tb.appendChild(h('tr', null, [
      cell('td', 'ps-label', 'Meeting Date'), cell('td', null, d.date),
      cell('td', 'ps-label', 'Meeting Time'), cell('td', null, d.time),
      cell('td', 'ps-label', 'Meeting Venue'), cell('td', null, d.venue)
    ]));
    info.appendChild(tb);
    sheet.appendChild(section('1. Meeting Information', null, info));

    // 2. Teachers
    var teachers = h('table', 'ps-table');
    teachers.appendChild(colgroup([16, 104, 50]));
    var thead = document.createElement('thead');
    thead.appendChild(h('tr', null, [
      cell('th', null, 'No.'), cell('th', null, 'Name of Teacher'), cell('th', null, 'Signature')
    ]));
    teachers.appendChild(thead);
    var tbody = document.createElement('tbody');
    d.teachers.forEach(function (name, i) {
      tbody.appendChild(h('tr', null, [
        cell('td', 'ps-center ps-teacher-row', String(i + 1)),
        cell('td', 'ps-teacher-row', name),
        cell('td', 'ps-teacher-row', '')
      ]));
    });
    teachers.appendChild(tbody);
    sheet.appendChild(section('2. Participating Course Teachers', null, teachers));

    // 3. Course coverage
    var coverage = h('table', 'ps-table');
    coverage.appendChild(colgroup([56.67, 56.66, 56.67]));
    var chead = document.createElement('thead');
    chead.appendChild(h('tr', null, [
      cell('th', null, 'Covered'), cell('th', null, 'Not Covered'), cell('th', null, 'Partially Covered')
    ]));
    coverage.appendChild(chead);
    var cbody = document.createElement('tbody');
    cbody.appendChild(h('tr', null, [
      cell('td', 'ps-text ps-box-cov', d.covered),
      cell('td', 'ps-text ps-box-cov', d.notCovered),
      cell('td', 'ps-text ps-box-cov', d.partiallyCovered)
    ]));
    coverage.appendChild(cbody);
    sheet.appendChild(section('3. Course Coverage', 'Write the topics under the appropriate category.', coverage));

    // 4. Discussion and decisions
    var disc = h('table', 'ps-table');
    disc.appendChild(colgroup([170]));
    var dbody = document.createElement('tbody');
    dbody.appendChild(h('tr', null, [cell('td', 'ps-text ps-box-disc', d.discussion)]));
    disc.appendChild(dbody);
    sheet.appendChild(section('4. Meeting Discussion and Decisions', null, disc));

    // Head of the Department (blank, for a handwritten signature)
    sheet.appendChild(h('div', 'ps-signature', [
      h('div', 'ps-sig-box', [
        h('div', 'ps-sig-line', 'Signature of Head of the Department'),
        h('div', 'ps-sig-sub', 'Department of CSE, UITS')
      ])
    ]));
  }

  function handlePrint() {
    flushSave();
    if (!validateOthers()) return;
    renderPrintSheet();
    window.print();
  }

  /* ------------------------------------------------------------------ *
   * 9. UI helpers
   * ------------------------------------------------------------------ */
  var toastTimer = null;

  function toast(message, type, duration) {
    clearTimeout(toastTimer);
    el.toast.classList.toggle('is-error', type === 'error');
    el.toast.hidden = false;
    el.toast.textContent = '';
    // Setting the text after un-hiding lets screen readers announce it.
    setTimeout(function () { el.toast.textContent = message; }, 40);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, duration || 4500);
  }

  function confirmReset() {
    var dlg = el.resetDialog;
    return new Promise(function (resolve) {
      if (!dlg || typeof dlg.showModal !== 'function') {
        resolve(window.confirm('Reset the form? All entries and the saved copy in this browser will be cleared.'));
        return;
      }
      var onClose = function () {
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'confirm');
      };
      dlg.returnValue = '';
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  function doReset() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    setState(defaultState());
    clearOthersError();
    setSaveNote('Changes are saved automatically in this browser.');
    window.scrollTo(0, 0);
    toast('The form has been reset.');
  }

  /* ------------------------------------------------------------------ *
   * 10. Event wiring and start-up
   * ------------------------------------------------------------------ */
  function init() {
    el.form = $('meetingForm');
    el.criteriaBoxes = Array.prototype.slice.call(document.querySelectorAll('[data-criterion]'));
    el.othersBox = $('crit-others');
    el.othersWrap = $('othersWrap');
    el.othersText = $('othersText');
    el.othersError = $('othersError');
    el.teacherList = $('teacherList');
    el.saveNote = $('saveNote');
    el.printSheet = $('printSheet');
    el.resetDialog = $('resetDialog');
    el.toast = $('toast');

    // Restore saved entries, or start from defaults (today's date, current time).
    var saved = loadSaved();
    setState(saved || defaultState());
    if (saved) {
      setSaveNote('Your previous entries were restored. Changes are saved automatically in this browser.');
    }

    // Auto-save on any edit.
    el.form.addEventListener('input', scheduleSave);
    el.form.addEventListener('change', scheduleSave);
    el.form.addEventListener('submit', function (e) { e.preventDefault(); });

    el.othersBox.addEventListener('change', function () {
      syncOthers();
      if (el.othersBox.checked) el.othersText.focus();
    });
    el.othersText.addEventListener('input', clearOthersError);

    // Teachers
    $('addTeacher').addEventListener('click', function () { addTeacher(true); });

    el.teacherList.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-remove');
      if (btn) removeTeacher(btn.closest('.teacher-row'));
    });

    el.teacherList.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.classList.contains('teacher-input')) return;
      e.preventDefault();
      var row = e.target.closest('.teacher-row');
      if (row.nextElementSibling) {
        row.nextElementSibling.querySelector('input').focus();
      } else if (e.target.value.trim()) {
        addTeacher(true);
      }
    });

    // Actions
    $('downloadBtn').addEventListener('click', function () { handlePdf('download'); });
    $('previewBtn').addEventListener('click', function () { handlePdf('preview'); });
    $('printBtn').addEventListener('click', handlePrint);
    $('resetBtn').addEventListener('click', function () {
      confirmReset().then(function (ok) {
        if (ok) doReset();
        else $('resetBtn').focus();
      });
    });

    // Keep the print sheet current when the user prints with Ctrl/Cmd+P.
    window.addEventListener('beforeprint', renderPrintSheet);

    // Never lose a pending edit when the page is closed or hidden.
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushSave();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
