(() => {
  "use strict";

  function xmlEscape(value) {
    return String(value ?? "").replace(/\u00e2\u201a\u00b5/g, "GHS ").replace(/\u00c2\u00b7/g, " - ")
      .replace(/\u00e2\u20ac\u00a2/g, "- ").replace(/\u00e2\u20ac\u2122/g, "'")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
    })[character]);
  }

  function safeName(value) {
    return String(value || "assessment").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "assessment";
  }

  function paragraphs(data) {
    if (Array.isArray(data.lines)) {
      return [
        { text: data.title, style: "Title" },
        ...data.lines
      ];
    }
    const lines = [
      { text: data.title, style: "Title" },
      { text: "" },
      { text: "Instructions", style: "Heading1" },
      { text: data.instructions || "" },
      { text: "" },
      { text: data.mode === "guide" ? "Teacher marking guide" : "Questions", style: "Heading1" }
    ];
    (data.questions || []).forEach((question, index) => {
      lines.push({ text: `Question ${index + 1}  -  ${question.marks || "—"} marks`, style: "Heading1" });
      lines.push({ text: question.prompt || question.expected_answer || "" });
      if (data.mode === "guide") {
        if (question.options) {
          question.options.forEach((option, optionIndex) => lines.push({ text: `   ${String.fromCharCode(65 + optionIndex)}. ${option}` }));
          lines.push({ text: `   Correct option: ${String.fromCharCode(65 + Number(question.correct_option || 0))}` });
        }
        lines.push({ text: `   Expected response: ${question.expected_answer || data.markingGuide?.[index]?.expected_response || "Teacher to complete."}` });
      } else if (question.options) {
        question.options.forEach((option, optionIndex) => lines.push({ text: `   ${String.fromCharCode(65 + optionIndex)}. ${option}` }));
      }
    });
    if (data.mode === "combined") {
      lines.push({ text: "Teacher marking scheme", style: "Heading1" });
      (data.questions || []).forEach((question, index) => {
        const guide = data.markingGuide?.find?.((item) => Number(item.question_number) === index + 1) || data.markingGuide?.[index] || {};
        lines.push({ text: `Question ${index + 1} (${question.marks} marks)`, style: "Heading1" });
        if (question.options) {
          question.options.forEach((option, optionIndex) => lines.push({ text: `   ${String.fromCharCode(65 + optionIndex)}. ${option}${optionIndex === Number(question.correct_option) ? " (correct)" : ""}` }));
        }
        lines.push({ text: `Expected response / marking points: ${guide.expected_response || question.expected_answer || "Teacher to complete."}` });
      });
      if (data.additionalNotes) lines.push({ text: "Additional marking notes", style: "Heading1" }, { text: data.additionalNotes });
    }
    if (data.mode === "guide" && data.additionalNotes) {
      lines.push({ text: "" }, { text: "Additional marking notes", style: "Heading1" }, { text: data.additionalNotes });
    }
    lines.push({ text: "" }, { text: "Teacher review required. Verify curriculum alignment, answers and mark allocations before use." });
    return lines;
  }

  function assessmentBlocks(data) {
    const blocks = [
      { text: "Instructions", style: "Heading1" },
      { text: data.instructions || "" },
      { text: data.mode === "guide" ? "Teacher marking guide" : "Questions", style: "Heading1" }
    ];
    const questionRows = (question) => window.akademiAssessmentRendering?.parseQuestionTable(question.prompt, question.table)
      || { text: question.prompt || question.expected_answer || "", rows: [] };
    (data.questions || []).forEach((question, index) => {
      const parsed = questionRows(question);
      blocks.push({ text: `Question ${index + 1} - ${question.marks || "—"} marks`, style: "Heading1" });
      if (parsed.text) blocks.push({ text: parsed.text });
      if (parsed.rows.length > 1) blocks.push({ type: "table", rows: parsed.rows });
      if (question.visual) {
        const visual = question.visual;
        const caption = visual.title || ({ graph: "Coordinate graph", bar_chart: "Bar chart", geometry: "Geometry diagram" })[visual.type] || "Question diagram";
        blocks.push({ text: caption, style: "Heading2" });
        const visualRows = visual.type === "bar_chart"
          ? [["Category", "Value"], ...(visual.labels || []).map((label, itemIndex) => [label, String(visual.values?.[itemIndex] ?? "")])]
          : visual.type === "graph"
            ? [["x", "y"], ...(visual.points || []).map((point) => [String(point[0]), String(point[1])])]
            : [["Shape", "Labels"], ...(visual.shapes || []).map((shape) => [shape.shape, (shape.labels || []).join(", ")])];
        if (visualRows.length > 1) blocks.push({ type: "table", rows: visualRows });
      }
      if (data.mode === "guide") {
        if (question.options) {
          question.options.forEach((option, optionIndex) => blocks.push({ text: `   ${String.fromCharCode(65 + optionIndex)}. ${option}` }));
          blocks.push({ text: `   Correct option: ${String.fromCharCode(65 + Number(question.correct_option || 0))}` });
        }
        blocks.push({ text: `Expected response: ${question.expected_answer || data.markingGuide?.[index]?.expected_response || "Teacher to complete."}` });
      } else if (question.options) {
        question.options.forEach((option, optionIndex) => blocks.push({ text: `   ${String.fromCharCode(65 + optionIndex)}. ${option}` }));
      }
    });
    if (data.mode === "combined") {
      blocks.push({ text: "Teacher marking scheme", style: "Heading1" });
      (data.questions || []).forEach((question, index) => {
        const guide = data.markingGuide?.find?.((item) => Number(item.question_number) === index + 1) || data.markingGuide?.[index] || {};
        blocks.push({ text: `Question ${index + 1} (${question.marks || guide.marks || ""} marks)`, style: "Heading1" });
        if (question.options) question.options.forEach((option, optionIndex) =>
          blocks.push({ text: `   ${String.fromCharCode(65 + optionIndex)}. ${option}${optionIndex === Number(question.correct_option) ? " (correct)" : ""}` }));
        blocks.push({ text: guide.expected_response || question.expected_answer || "Teacher to complete." });
      });
    }
    if (data.additionalNotes && ["guide", "combined"].includes(data.mode)) {
      blocks.push({ text: "Additional marking notes", style: "Heading1" }, { text: data.additionalNotes });
    }
    return blocks;
  }

  function docxBlob(data) {
    const wordTable = (rows, rowKinds = data.weekKinds) => {
      if (!rows.length) return "";
      const columnCount = Math.max(...rows.map((row) => row.length));
      const tableWidth = data.scheduleTable || data.lessonExport || data.scoreSheet ? 14400 : data.reportCard ? 10800 : 9000;
      const widths = data.schemeExport && columnCount === 7
        ? [800, 1400, 3000, 2100, 2300, 2300, 2500]
        : data.schemeExport && columnCount === 8
          ? [700, 1300, 2600, 1700, 2200, 2000, 1900, 2000]
        : data.schemeExport && columnCount === 5
          ? [680, 1500, 3600, 5000, 3620]
        : Array.from({ length: columnCount }, () => Math.floor(tableWidth / columnCount));
      const borders = '<w:tblBorders><w:top w:val="single" w:sz="5" w:color="C9D5CC"/><w:left w:val="single" w:sz="5" w:color="C9D5CC"/><w:bottom w:val="single" w:sz="5" w:color="C9D5CC"/><w:right w:val="single" w:sz="5" w:color="C9D5CC"/><w:insideH w:val="single" w:sz="5" w:color="C9D5CC"/><w:insideV w:val="single" w:sz="5" w:color="C9D5CC"/></w:tblBorders>';
      const tableRows = rows.map((row, rowIndex) => {
        const rowKind = rowKinds?.[rowIndex];
        const fill = rowKind === "semester" || (data.reportCard && rowIndex === 0) ? "315B40"
          : rowKind === "mid_semester" ? "FFF2D6"
            : rowKind === "revision" ? "EAF4FB"
              : rowKind === "end_semester" ? "FCE9E7"
              : rowKind === "report_good" ? "E8F5EC"
                : rowKind === "report_partial" ? "FFF5DC"
                  : rowKind === "report_low" ? "FCEBEA"
                    : rowKind === "report_pending" ? "F1F3F2"
              : rowIndex === 0 ? "EAF1EB" : null;
        const rowTextColor = rowKind === "semester" || (data.reportCard && rowIndex === 0) ? '<w:color w:val="FFFFFF"/>' : "";
        return `<w:tr><w:trPr>${rowIndex === 0 && data.schemeExport ? '<w:tblHeader w:val="true"/>' : ""}</w:trPr>${Array.from({ length: columnCount }, (_, index) => {
        const value = String(row[index] || "").split("\n")
          .map((line, lineIndex) => `${lineIndex ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
          .join("");
        const shade = fill ? `<w:shd w:fill="${fill}"/>` : "";
        const bold = rowIndex === 0 || rowKind === "semester" ? "<w:b/>" : "";
        const cellWidth = widths[index];
        return `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/><w:tcMar><w:top w:w="70" w:type="dxa"/><w:start w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:end w:w="90" w:type="dxa"/></w:tcMar>${shade}</w:tcPr><w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr>${bold}${rowTextColor}<w:sz w:val="${data.schemeExport ? 16 : 18}"/></w:rPr>${value}</w:r></w:p></w:tc>`;
      }).join("")}</w:tr>`;
      }).join("");
      return `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr><w:tblGrid>${Array.from({ length: columnCount }, (_, index) => `<w:gridCol w:w="${widths[index] || Math.floor(tableWidth / columnCount)}"/>`).join("")}</w:tblGrid>${tableRows}</w:tbl>`;
    };
    const lessonTemplateTable = (rows) => {
      const tableWidth = 15398;
      const widths = [3161, 3552, 1828, 1283, 1896, 1280, 1297, 1101];
      const borders = '<w:tblBorders><w:top w:val="single" w:sz="7" w:color="89968C"/><w:left w:val="single" w:sz="7" w:color="89968C"/><w:bottom w:val="single" w:sz="7" w:color="89968C"/><w:right w:val="single" w:sz="7" w:color="89968C"/><w:insideH w:val="single" w:sz="7" w:color="89968C"/><w:insideV w:val="single" w:sz="7" w:color="89968C"/></w:tblBorders>';
      const tableRows = rows.map((row) => {
        const rowClass = row.className.split(/\s+/);
        const fill = rowClass.includes("lesson-template-subject") ? "E9EFE9"
          : rowClass.includes("lesson-template-lesson-title") ? "EAF1EB"
            : rowClass.includes("lesson-template-title") || rowClass.includes("lesson-template-section-heading") ? "DCE8DD"
              : rowClass.includes("lesson-template-intro") ? "F8FAF8"
                : rowClass.includes("lesson-template-warning") ? "FFF8E9" : "";
        let columnIndex = 0;
        const cells = row.cells.map((cell) => {
          const span = Math.min(8, Math.max(1, cell.span));
          const cellWidth = widths.slice(columnIndex, columnIndex + span).reduce((sum, width) => sum + width, 0);
          columnIndex += span;
          const rowBold = fill === "DCE8DD" || fill === "E9EFE9" || fill === "EAF1EB";
          const content = (cell.text.length ? cell.text : [""]).map((line) => {
            const bold = rowBold || cell.header || /^(?:LESSON\s+\d+:|INTRODUCTION$|Key Assessment$|Formative Assessment:|Rubric\/Mark Scheme:|Reflection & Remarks$|\d+\.\s)/i.test(line);
            return `<w:p><w:pPr><w:spacing w:after="35"/></w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`;
          }).join("");
          const spanXml = span > 1 ? `<w:gridSpan w:val="${span}"/>` : "";
          const shading = fill ? `<w:shd w:fill="${fill}"/>` : cell.header ? '<w:shd w:fill="EDF2ED"/>' : "";
          return `<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${spanXml}<w:tcMar><w:top w:w="70" w:type="dxa"/><w:start w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:end w:w="90" w:type="dxa"/></w:tcMar>${shading}<w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;
        }).join("");
        return `<w:tr>${cells}</w:tr>`;
      }).join("");
      return `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${tableRows}</w:tbl>`;
    };
    const contentBlocks = Array.isArray(data.blocks)
      ? data.reportCard || (data.lessonExport && data.blocks.some((line) => line.type === "lesson-template"))
        ? data.blocks
        : [{ text: data.title, style: "Title" }, ...data.blocks]
      : paragraphs(data);
    const content = contentBlocks.map((line) => {
      if (line.type === "page-break") return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      if (line.type === "lesson-template") return lessonTemplateTable(line.rows);
      if (line.type === "table") return wordTable(line.rows, line.rowKinds);
      const style = line.style ? `<w:pPr><w:pStyle w:val="${line.style}"/></w:pPr>` : "";
      const color = /^[0-9A-F]{6}$/i.test(line.color || "") ? `<w:color w:val="${line.color}"/>` : "";
      const bold = line.bold ? "<w:b/>" : "";
      const runs = String(line.text ?? "").split(/\r?\n/).map((part, index) =>
        `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:rPr>${color}${bold}</w:rPr><w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>`
      ).join("");
      return `<w:p>${style}${runs}</w:p>`;
    }).join("");
    const entries = [
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ["word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'],
      ["word/header1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="6" w:color="C99D3B"/></w:pBdr></w:pPr><w:r><w:rPr><w:b/><w:color w:val="2D6A4F"/><w:sz w:val="16"/></w:rPr><w:t>AKADEMI  |  ASSESSMENT</w:t></w:r></w:p></w:hdr>'], ["word/footer1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="D9E2DA"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="65736A"/><w:sz w:val="16"/></w:rPr><w:t>Teacher review copy  |  Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>'],             ["word/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:rPr><w:b/><w:color w:val="18352B"/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="2D6A4F"/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:pPr><w:keepNext/><w:spacing w:before="140" w:after="70"/></w:pPr><w:rPr><w:b/><w:color w:val="315B40"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>'],
      ["word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${content}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="${data.lessonExport ? 16838 : data.scheduleTable || data.scoreSheet ? 15840 : 12240}" w:h="${data.lessonExport ? 11906 : data.scheduleTable || data.scoreSheet ? 12240 : 15840}"${data.lessonExport || data.scheduleTable || data.scoreSheet ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${data.reportCard ? 1500 : 540}" w:right="720" w:bottom="540" w:left="720"/></w:sectPr></w:body></w:document>`]
    ];
    if (data.lessonExport) {
      const headerEntry = entries.find(([path]) => path === "word/header1.xml");
      headerEntry[1] = headerEntry[1].replace("AKADEMI  |  ASSESSMENT", "AKADEMI  |  LESSON PLAN");
    }
    if (data.schemeExport) {
      const headerEntry = entries.find(([path]) => path === "word/header1.xml");
      headerEntry[1] = headerEntry[1].replace("AKADEMI  |  ASSESSMENT", "AKADEMI  |  SCHEME OF WORK");
    }
    if (data.reviewExport) {
      const headerEntry = entries.find(([path]) => path === "word/header1.xml");
      headerEntry[1] = headerEntry[1].replace("AKADEMI  |  ASSESSMENT", "AKADEMI  |  LEARNER FEEDBACK");
      const footerEntry = entries.find(([path]) => path === "word/footer1.xml");
      footerEntry[1] = footerEntry[1].replace("Teacher review copy", "Student feedback copy");
    }
    if (data.hodName && !data.schemeExport) {
      const verification = `HOD signature required: ${xmlEscape(data.hodName)}  |  `;
      const footerEntry = entries.find(([path]) => path === "word/footer1.xml");
      footerEntry[1] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="D9E2DA"/></w:pBdr></w:pPr><w:r><w:rPr><w:color w:val="65736A"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${verification}</w:t></w:r><w:r><w:rPr><w:color w:val="65736A"/><w:sz w:val="16"/></w:rPr><w:t>Teacher review copy  |  Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
    }
    if (data.reportCard) {
      const administrator = data.administrator || {};
      const logoBytes = administrator.logoDocxBase64
        ? Uint8Array.from(atob(administrator.logoDocxBase64), (character) => character.charCodeAt(0))
        : null;
      const schoolName = xmlEscape(administrator.school || "School");
      const contactDetails = [
        administrator.name && `Prepared by ${administrator.name}`,
        administrator.email,
        administrator.phone,
        [administrator.region, administrator.district].filter(Boolean).join(" · ")
      ].filter(Boolean).map(xmlEscape).join("  |  ");
      const logoMarkup = logoBytes
        ? '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="548640" cy="548640"/><wp:docPr id="1" name="School logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="School logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="548640" cy="548640"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
        : "";
      const headerEntry = entries.find(([path]) => path === "word/header1.xml");
      headerEntry[1] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="C99D3B"/></w:pBdr></w:pPr>${logoMarkup}<w:r><w:rPr><w:b/><w:color w:val="2D6A4F"/><w:sz w:val="28"/></w:rPr><w:t>${schoolName}</w:t></w:r></w:p>${contactDetails ? `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:color w:val="65736A"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${contactDetails}</w:t></w:r></w:p>` : ""}</w:hdr>`;
      const footerEntry = entries.find(([path]) => path === "word/footer1.xml");
      footerEntry[1] = footerEntry[1].replace("Teacher review copy", "Official student results slip");
      if (logoBytes) {
        entries.push(
          ["word/_rels/header1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/school-logo.jpg"/></Relationships>'],
          ["word/media/school-logo.jpg", logoBytes]
        );
        const contentTypes = entries.find(([path]) => path === "[Content_Types].xml");
        contentTypes[1] = contentTypes[1].replace("</Types>", '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
      }
    }
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let value = n;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[n] = value >>> 0;
    }
    const crc32 = (bytes) => {
      let crc = 0xffffffff;
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    };
    const header = (size) => new Uint8Array(size);
    const put = (array, position, value, width = 2) => {
      for (let index = 0; index < width; index++) array[position + index] = value >>> (index * 8) & 0xff;
    };
    for (const [filename, text] of entries) {
      const name = encoder.encode(filename);
      const bytes = typeof text === "string" ? encoder.encode(text) : text;
      const crc = crc32(bytes);
      const local = header(30 + name.length);
      put(local, 0, 0x04034b50, 4); put(local, 4, 20); put(local, 14, crc, 4);
      put(local, 18, bytes.length, 4); put(local, 22, bytes.length, 4); put(local, 26, name.length);
      local.set(name, 30);
      chunks.push(local, bytes);
      const item = header(46 + name.length);
      put(item, 0, 0x02014b50, 4); put(item, 4, 20); put(item, 6, 20);
      put(item, 16, crc, 4); put(item, 20, bytes.length, 4); put(item, 24, bytes.length, 4);
      put(item, 28, name.length); put(item, 42, offset, 4); item.set(name, 46);
      central.push(item);
      offset += local.length + bytes.length;
    }
    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = header(22);
    put(end, 0, 0x06054b50, 4); put(end, 8, entries.length); put(end, 10, entries.length);
    put(end, 12, centralSize, 4); put(end, 16, offset, 4);
    return new Blob([...chunks, ...central, end], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  }

  function lessonExportModel(doc) {
    const parsed = new DOMParser().parseFromString(String(doc.html || ""), "text/html");
    const body = parsed.querySelector(".output-body") || parsed.body;
    body.querySelectorAll("script, style, noscript, button, .output-actions").forEach((node) => node.remove());
    const template = body.querySelector(".lesson-plan-table");
    const nodeLines = (node) => {
      if (!node) return [];
      const visit = (current) => {
        if (current.nodeType === 3) return current.nodeValue || "";
        if (current.nodeType !== 1) return "";
        const tag = current.tagName.toLowerCase();
        if (tag === "br") return "\n";
        const prefix = tag === "li" ? "• " : "";
        const contents = Array.from(current.childNodes || [], visit).join("");
        return ["p", "li", "h1", "h2", "h3", "h4", "div", "section"].includes(tag)
          ? `\n${prefix}${contents}\n`
          : contents;
      };
      return visit(node).split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    };
    const templateRows = Array.from(template?.querySelectorAll("tbody > tr") || [], (row) => ({
      className: row.className || "",
      cells: Array.from(row.cells, (cell) => ({
        text: nodeLines(cell),
        span: Number(cell.colSpan) || 1,
        header: cell.tagName === "TH"
      }))
    }));
    const source = doc.data?.lesson_draft && typeof doc.data.lesson_draft === "object" ? doc.data.lesson_draft : {};
    const planData = doc.data && typeof doc.data === "object" ? doc.data : {};
    const text = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();
    const asList = (value) => Array.isArray(value)
      ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
      : String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const fromDataOrTemplate = (dataKey, draftKey, ...aliases) => {
      const candidates = [source[draftKey], planData[dataKey], ...aliases.map((key) => planData[key])];
      for (const candidate of candidates) {
        const items = asList(candidate);
        if (items.length) return items;
      }
      return [];
    };
    const metadata = Array.from(body.querySelectorAll(".meta-box")).map((box) => [
      text(box.querySelector("small")) || "Planning detail",
      text(box.querySelector("strong"))
    ]).filter((row) => row[1]);
    const sections = Array.from(body.querySelectorAll(".document-section"));
    const section = (name) => sections.find((item) => text(item.querySelector("h3")).toLowerCase().includes(name));
    const listValues = (node) => Array.from(node?.querySelectorAll(":scope > ul > li, :scope > ol > li") || []).map(text).filter(Boolean);
    const outcomeSection = section("learning outcomes");
    const outcomes = fromDataOrTemplate("learning_outcomes", "learning_outcomes", "learningOutcomes");
    if (!outcomes.length) outcomes.push(...listValues(outcomeSection));
    const contextSection = section("prior knowledge");
    const contextParagraph = contextSection?.querySelector(":scope > p");
    const priorKnowledge = text(contextParagraph) || String(source.prior_knowledge || "");
    const resources = fromDataOrTemplate("resources", "resources", "available_resources");
    if (!resources.length) resources.push(...listValues(contextSection));
    const sequence = section("teaching sequence");
    const legacyStages = Array.from(sequence?.querySelectorAll(".lesson-phase") || []).map((phase) => {
      const activity = phase.querySelector("p");
      const fragments = (activity?.innerHTML || "").split(/<br\s*\/?>/i).map((fragment) => {
        const holder = parsed.createElement("div");
        holder.innerHTML = fragment;
        return text(holder);
      });
      const field = (label, fallback) => {
        const match = fragments.find((fragment) => fragment.toLowerCase().startsWith(`${label.toLowerCase()}:`));
        return match ? match.slice(match.indexOf(":") + 1).trim() : fallback;
      };
      return [
        text(phase.querySelector(".phase-time")),
        text(phase.querySelector("strong")),
        field("Teacher", ""),
        field("Learners", ""),
        field("Check", "")
      ];
    });
    const stages = Array.isArray(source.lesson_stages) ? source.lesson_stages.map((stage) => ({
      name: String(stage.name || "Lesson activity"),
      minutes: String(stage.minutes || ""),
      teacher: String(stage.teacher_activity || ""),
      learners: String(stage.learner_activity || ""),
      assessment: String(stage.assessment_check || "")
    })) : legacyStages.map((stage) => ({
      minutes: String(stage[0] || "").replace(/\s*min$/i, ""),
      name: stage[1] || "Lesson activity",
      teacher: stage[2] || "",
      learners: stage[3] || "",
      assessment: stage[4] || ""
    }));
    const differentiation = source.differentiation && typeof source.differentiation === "object"
      ? [["Support", source.differentiation.support || ""], ["Core", source.differentiation.core || ""], ["Extension", source.differentiation.extension || ""]].filter((row) => row[1])
      : [];
    const focalAreas = fromDataOrTemplate("focal_areas", "focal_areas", "focalAreas", "focal_area", "focalArea");
    const indicators = fromDataOrTemplate("learning_indicators", "learning_indicators", "indicators", "indicator");
    const curriculumRows = [
      ["Semester / week", planData.week_label || planData.week || ""],
      ["Strand", planData.strand || ""],
      ["Sub-strand", planData.sub_strand || planData.substrand || ""],
      ["Focal area(s)", focalAreas.join("\n")],
      ["Content standard", planData.content_standard || planData.standard || ""],
      ["Learning indicator(s)", indicators.join("\n")],
      ["Learning outcome(s)", outcomes.join("\n")],
      ["Curriculum source", planData.curriculum_reference || ""]
    ].filter((row) => row[1]);
    const listField = (draftKey, dataKey, ...aliases) => fromDataOrTemplate(dataKey, draftKey, ...aliases);
    return {
      title: doc.title || source.title || "Lesson plan",
      metadata: [
        ["Subject", planData.subject || doc.subject || ""],
        ["SHS year", planData.year || planData.year_group || doc.year || doc.year_group || ""],
        ["Class / Form", planData.class_name || planData.className || doc.className || ""],
        ["Number of learners", planData.learners || planData.number_of_learners || ""],
        ["Teaching week", planData.week_label || planData.week || ""],
        ["Academic year", planData.academicYear || planData.academic_year || ""],
        ["Duration", planData.duration_minutes || planData.duration ? `${planData.duration_minutes || planData.duration} minutes` : ""],
        ["School", planData.school || ""],
        ["Topic", planData.topic || ""]
      ].filter((row) => row[1]).concat(metadata.filter(([label]) => !["subject", "shs year / class", "academic year / week", "duration", "school", "learners"].includes(label.toLowerCase()))),
      priorKnowledge,
      outcomes: outcomes.map((item) => String(item)).filter(Boolean),
      curriculumRows,
      resources: resources.map((item) => String(item)).filter(Boolean),
      stages,
      templateRows,
      questions: listField("essential_questions", "essential_questions", "essentialQuestions"),
      strategies: listField("pedagogical_strategies", "pedagogical_strategies", "strategies"),
      keyAssessment: String(source.key_assessment || planData.key_assessment || ""),
      rubric: String(source.rubric_mark_scheme || planData.rubric_mark_scheme || ""),
      reflection: String(source.reflection_remarks || planData.reflection_remarks || ""),
      formativeAssessment: stages.map((stage) => stage.assessment).filter(Boolean),
      differentiation
    };
  }

  function lessonBlocks(model) {
    if (model.templateRows.length) {
      return [{ type: "lesson-template", rows: model.templateRows }];
    }
    const blocks = [
      { text: "LESSON PLAN · TEACHER-REVIEW DRAFT", style: "Heading1" },
      { text: "Lesson overview", style: "Heading1" },
      { type: "table", rows: [["Planning detail", "Value"], ...model.metadata] }
    ];
    if (model.curriculumRows.length) {
      blocks.push(
        { text: "Week-aligned curriculum reference", style: "Heading1" },
        { type: "table", rows: [["Curriculum element", "Verified weekly allocation"], ...model.curriculumRows] }
      );
    }
    if (model.questions.length) blocks.push({ text: "Essential questions", style: "Heading1" }, ...model.questions.map((item) => ({ text: `- ${item}` })));
    if (model.strategies.length) blocks.push({ text: "Pedagogical strategies", style: "Heading1" }, ...model.strategies.map((item) => ({ text: `- ${item}` })));
    if (model.outcomes.length) {
      blocks.push({ text: "Learning outcomes", style: "Heading1" }, ...model.outcomes.map((item) => ({ text: `- ${item}` })));
    }
    if (model.priorKnowledge || model.resources.length) {
      blocks.push({ text: "Prior knowledge and resources", style: "Heading1" });
      if (model.priorKnowledge) blocks.push({ text: `Prior knowledge: ${model.priorKnowledge}` });
      if (model.resources.length) blocks.push({ text: `Teaching and learning resources: ${model.resources.join("; ")}` });
    }
    if (model.stages.length) {
      blocks.push({ text: "Lesson sequence", style: "Heading1" });
      model.stages.forEach((stage, index) => {
        blocks.push({ text: `${index + 1}. ${stage.name} · ${stage.minutes} minutes`, style: "Heading2" });
        if (stage.teacher) blocks.push({ text: `Teacher Activities: ${stage.teacher}` });
        if (stage.learners) blocks.push({ text: `Learner Activities: ${stage.learners}` });
        if (stage.assessment) blocks.push({ text: `Assessment / Check: ${stage.assessment}` });
      });
    }
    if (model.differentiation.length) blocks.push({ text: "Key notes on differentiation", style: "Heading1" }, ...model.differentiation.map(([label, detail]) => ({ text: `${label}: ${detail}` })));
    if (model.keyAssessment) blocks.push({ text: "Key assessment", style: "Heading1" }, { text: model.keyAssessment });
    if (model.formativeAssessment.length) blocks.push({ text: "Formative assessment", style: "Heading1" }, ...model.formativeAssessment.map((item) => ({ text: `- ${item}` })));
    if (model.rubric) blocks.push({ text: "Rubric / mark scheme", style: "Heading1" }, { text: model.rubric });
    blocks.push({ text: "Reflection & remarks", style: "Heading1" }, { text: model.reflection || "Key observations: ________________________________\nStrengths: ________________________________\nAreas for development: ________________________________" });
    blocks.push({ text: "Teacher review required. Check curriculum alignment, activities and assessment evidence before classroom use." });
    return blocks;
  }

  function lessonTemplatePdfBlob(model) {
    const pageWidth = 842;
    const pageHeight = 595;
    const left = 30;
    const contentWidth = pageWidth - left * 2;
    const pages = [[]];
    const columns = [20.53, 23.06, 11.87, 8.33, 12.31, 8.31, 8.42, 7.17]
      .map((percent) => contentWidth * percent / 100);
    const fontSize = 6.4;
    const lineHeight = 8;
    let y = 22;
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
    const textCommand = (value, x, top, bold = false) => {
      const escaped = plain(value).replace(/[\\()]/g, "\\$&");
      return `BT /${bold ? "F2" : "F1"} ${fontSize} Tf 0.15 0.21 0.17 rg 1 0 0 1 ${x} ${pageHeight - top - fontSize} Tm (${escaped}) Tj ET\n`;
    };
    const wrap = (value, width) => {
      const limit = Math.max(8, Math.floor(width / (fontSize * 0.52)));
      const result = [];
      for (const paragraph of String(value || "").split(/\r?\n/)) {
        let line = "";
        for (const word of plain(paragraph).split(/\s+/).filter(Boolean)) {
          if (line && `${line} ${word}`.length > limit) {
            result.push(line);
            line = word;
          } else line = line ? `${line} ${word}` : word;
        }
        result.push(line);
      }
      return result.length ? result : [""];
    };
    const nextPage = () => {
      pages.push([]);
      y = 22;
    };
    const rowFill = (rowClass) => rowClass.includes("lesson-template-subject") ? "0.91 0.94 0.91"
      : rowClass.includes("lesson-template-lesson-title") ? "0.93 0.95 0.93"
        : rowClass.includes("lesson-template-title") || rowClass.includes("lesson-template-section-heading") ? "0.86 0.91 0.87"
          : rowClass.includes("lesson-template-intro") ? "0.98 0.99 0.98"
            : rowClass.includes("lesson-template-warning") ? "1 0.97 0.91" : "";
    model.templateRows.forEach((row) => {
      let columnIndex = 0;
      const positions = [];
      const cellLines = row.cells.map((cell) => {
        const span = Math.min(8, Math.max(1, cell.span));
        const x = left + columns.slice(0, columnIndex).reduce((sum, width) => sum + width, 0);
        const width = columns.slice(columnIndex, columnIndex + span).reduce((sum, value) => sum + value, 0);
        positions.push({ x, width });
        columnIndex += span;
        return cell.text.flatMap((line) => wrap(line, width - 8));
      });
      const maxLines = Math.max(1, ...cellLines.map((lines) => lines.length));
      for (let offset = 0; offset < maxLines;) {
        let capacity = Math.floor((pageHeight - 35 - y) / lineHeight);
        if (capacity < 1) {
          nextPage();
          capacity = Math.floor((pageHeight - 35 - y) / lineHeight);
        }
        const chunkLines = Math.min(maxLines - offset, capacity);
        const rowHeight = Math.max(18, chunkLines * lineHeight + 8);
        const fill = rowFill(row.className);
        row.cells.forEach((cell, index) => {
          const { x, width } = positions[index];
          const bottom = pageHeight - y - rowHeight;
          if (fill) pages[pages.length - 1].push(`${fill} rg ${x} ${bottom} ${width} ${rowHeight} re f\n`);
          pages[pages.length - 1].push(`0.54 0.59 0.55 RG 0.45 w ${x} ${bottom} ${width} ${rowHeight} re S\n`);
          const bold = fill !== "" || cell.header;
          (cellLines[index] || []).slice(offset, offset + chunkLines).forEach((line, lineIndex) => {
            pages[pages.length - 1].push(textCommand(line, x + 4, y + 4 + lineIndex * lineHeight, bold));
          });
        });
        y += rowHeight;
        offset += chunkLines;
        if (offset < maxLines) nextPage();
      }
    });

    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    const pageRefs = [];
    pages.forEach((commands, index) => {
      const footerText = plain(`Akademi | ${model.title} | ${index + 1} / ${pages.length}`).replace(/[\\()]/g, "\\$&");
      const stream = commands.join("") + `BT /F1 6 Tf 0.40 0.45 0.41 rg 1 0 0 1 ${left} 13 Tm (${footerText}) Tj ET\n`;
      const pageNumber = objects.length + 1;
      const contentNumber = pageNumber + 1;
      pageRefs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(output.length);
      output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function lessonPdfBlob(doc) {
    const model = lessonExportModel(doc);
    if (model.templateRows.length) return lessonTemplatePdfBlob(model);
    const pageWidth = 842;
    const pageHeight = 595;
    const left = 36;
    const contentWidth = pageWidth - left * 2;
    const pages = [[]];
    let y = 40;
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
    const wrap = (value, limit) => {
      const result = [];
      let line = "";
      plain(value).split(/\s+/).forEach((word) => {
        if (line && (line + " " + word).length > limit) {
          result.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      });
      result.push(line);
      return result;
    };
    const textCommand = (value, x, top, size = 8, bold = false, color = "0.16 0.22 0.18") => {
      const escaped = plain(value).replace(/[\\()]/g, "\\$&");
      const baseline = pageHeight - top - size;
      return `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${baseline} Tm (${escaped}) Tj ET\n`;
    };
    const newPage = () => { pages.push([]); y = 40; };
    const writeLine = (value, size = 9, bold = false, gap = 4, color) => {
      const maxChars = Math.max(35, Math.floor(contentWidth / (size * 0.52)));
      wrap(value, maxChars).forEach((line) => {
        if (y + size + gap > pageHeight - 35) newPage();
        pages[pages.length - 1].push(textCommand(line, left, y, size, bold, color));
        y += size + gap;
      });
    };
    const drawTable = (headers, rows, widths) => {
      const drawRow = (cells, header = false) => {
        const wrapped = cells.map((cell, index) => wrap(cell, Math.max(8, Math.floor((widths[index] - 10) / 4.15))));
        const maxLines = Math.max(1, ...wrapped.map((lines) => lines.length));
        const maxChunkLines = Math.max(1, Math.floor((pageHeight - 100) / 10));
        for (let offset = 0; offset < maxLines; offset += maxChunkLines) {
          const chunkLength = Math.min(maxChunkLines, maxLines - offset);
          const rowHeight = Math.max(24, chunkLength * 9 + 10);
          if (y + rowHeight > pageHeight - 34) {
            newPage();
            if (!header) drawRow(headers, true);
          }
          let x = left;
          widths.forEach((width, index) => {
            const bottom = pageHeight - y - rowHeight;
            if (header) pages[pages.length - 1].push(`0.91 0.95 0.92 rg ${x} ${bottom} ${width} ${rowHeight} re f\n`);
            pages[pages.length - 1].push(`0.76 0.82 0.77 RG 0.5 w ${x} ${bottom} ${width} ${rowHeight} re S\n`);
            const visible = wrapped[index].slice(offset, offset + maxChunkLines);
            visible.forEach((line, lineIndex) => {
              pages[pages.length - 1].push(textCommand(line, x + 5, y + 5 + lineIndex * 9, header ? 7.2 : 7, header, "0.15 0.21 0.17"));
            });
            x += width;
          });
          y += rowHeight;
        }
      };
      drawRow(headers, true);
      rows.forEach((row) => drawRow(row));
      y += 10;
    };
    pages[0].push(textCommand(model.title, left, y, 18, true, "0.09 0.25 0.17"));
    y += 26;
    writeLine("LESSON PLAN - TEACHER-REVIEW DRAFT", 8, true, 10, "0.28 0.40 0.31");
    writeLine("Lesson overview", 12, true, 6, "0.09 0.25 0.17");
    drawTable(["Planning detail", "Value"], model.metadata, [190, contentWidth - 190]);
    if (model.curriculumRows.length) {
      writeLine("Week-aligned curriculum reference", 12, true, 5, "0.09 0.25 0.17");
      drawTable(
        ["Curriculum element", "Verified weekly allocation"],
        model.curriculumRows,
        [160, contentWidth - 160]
      );
    }
    if (model.questions.length) {
      writeLine("Essential questions", 12, true, 5, "0.09 0.25 0.17");
      model.questions.forEach((item) => writeLine(`- ${item}`, 9, false, 3));
    }
    if (model.strategies.length) {
      writeLine("Pedagogical strategies", 12, true, 5, "0.09 0.25 0.17");
      model.strategies.forEach((item) => writeLine(`- ${item}`, 9, false, 3));
    }
    if (model.outcomes.length) {
      writeLine("Learning outcomes", 12, true, 5, "0.09 0.25 0.17");
      model.outcomes.forEach((item) => writeLine(`- ${item}`, 9, false, 3));
      y += 5;
    }
    if (model.priorKnowledge || model.resources.length) {
      writeLine("Prior knowledge and resources", 12, true, 5, "0.09 0.25 0.17");
      if (model.priorKnowledge) writeLine(`Prior knowledge: ${model.priorKnowledge}`, 9, false, 3);
      if (model.resources.length) writeLine(`Teaching and learning resources: ${model.resources.join("; ")}`, 9, false, 5);
    }
    if (model.stages.length) {
      writeLine("Teaching sequence", 12, true, 5, "0.09 0.25 0.17");
      model.stages.forEach((stage, index) => {
        writeLine(`${index + 1}. ${stage.name} · ${stage.minutes} minutes`, 10, true, 4, "0.12 0.29 0.19");
        if (stage.teacher) writeLine(`Teacher Activities: ${stage.teacher}`, 8.5, false, 3);
        if (stage.learners) writeLine(`Learner Activities: ${stage.learners}`, 8.5, false, 3);
        if (stage.assessment) writeLine(`Assessment / Check: ${stage.assessment}`, 8.5, false, 6);
      });
    }
    if (model.differentiation.length) {
      writeLine("Key notes on differentiation", 12, true, 5, "0.09 0.25 0.17");
      model.differentiation.forEach(([label, detail]) => writeLine(`${label}: ${detail}`, 9, false, 3));
    }
    if (model.keyAssessment) writeLine(`Key assessment: ${model.keyAssessment}`, 9, false, 5);
    if (model.formativeAssessment.length) {
      writeLine("Formative assessment", 12, true, 5, "0.09 0.25 0.17");
      model.formativeAssessment.forEach((item) => writeLine(`- ${item}`, 9, false, 3));
    }
    if (model.rubric) writeLine(`Rubric / mark scheme: ${model.rubric}`, 9, false, 5);
    writeLine("Reflection & remarks", 12, true, 5, "0.09 0.25 0.17");
    writeLine(model.reflection || "Key observations: ________________________________  Strengths: ________________________________  Areas for development: ________________________________", 9, false, 5);
    writeLine("Teacher review required. Check curriculum alignment, activities and assessment evidence before classroom use.", 8, false, 4, "0.38 0.38 0.32");

    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    const pageRefs = [];
    pages.forEach((commands, index) => {
      const stream = commands.join("") + textCommand(`Akademi | ${model.title} | ${index + 1} / ${pages.length}`, left, pageHeight - 24, 7, false, "0.40 0.45 0.41");
      const pageNumber = objects.length + 1;
      const contentNumber = pageNumber + 1;
      pageRefs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(output.length);
      output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function schemePdfBlob(data) {
    const pageWidth = 842;
    const pageHeight = 595;
    const margin = 34;
    const contentWidth = pageWidth - margin * 2;
    const headers = data.tableRows?.[0] || ["Wk", "Week Ending", "Topic", "Focal Areas", "Assessment Schedule (auto)"];
    const widths = headers.length === 7
      ? [0.07, 0.10, 0.20, 0.15, 0.16, 0.16, 0.16].map((share) => contentWidth * share)
      : headers.length === 8
        ? [0.06, 0.09, 0.16, 0.12, 0.15, 0.15, 0.15, 0.12].map((share) => contentWidth * share)
      : [38, 86, 172, 290, contentWidth - 586];
    const pages = [[]];
    let y = 0;
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7e]/g, "");
    const escaped = (value) => plain(value).replace(/[\\()]/g, "\\$&");
    const text = (value, x, top, size = 7.1, bold = false) =>
      `BT /${bold ? "F2" : "F1"} ${size} Tf 0.12 0.16 0.13 rg 1 0 0 1 ${x} ${pageHeight - top - size} Tm (${escaped(value)}) Tj ET\n`;
    const wrap = (value, width, size, maxLines = 60) => {
      const limit = Math.max(6, Math.floor((width - 10) / (size * 0.52)));
      const lines = [];
      let line = "";
      for (const word of plain(value).split(/\s+/).filter(Boolean)) {
        if (line && `${line} ${word}`.length > limit) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) lines.push(line);
      return (lines.length ? lines : [""]).slice(0, maxLines);
    };
    const rect = (x, top, width, height, header, fillOverride = null) => {
      const bottom = pageHeight - top - height;
      const fill = fillOverride || (header ? "0.93 0.94 0.93" : "1 1 1");
      return `${fill} rg ${x} ${bottom} ${width} ${height} re f\n0.68 0.71 0.69 RG 0.45 w ${x} ${bottom} ${width} ${height} re S\n`;
    };
    const pageHeader = (first) => {
      if (first) {
        pages[pages.length - 1].push(text(data.title || "Scheme of Work", margin, 27, 16, true));
        pages[pages.length - 1].push(text(`${data.school || ""}  |  ${data.subject || ""}  |  ${data.year || ""}  |  ${data.academic_year || ""}`, margin, 50, 8));
        pages[pages.length - 1].push(`0.68 0.71 0.69 RG 0.6 w ${margin} ${pageHeight - 67} m ${pageWidth - margin} ${pageHeight - 67} l S\n`);
        y = 78;
      } else {
        pages[pages.length - 1].push(text(`${data.title || "Scheme of Work"}  |  continued`, margin, 24, 9, true));
        y = 40;
      }
      const height = 25;
      let x = margin;
      headers.forEach((label, index) => {
        pages[pages.length - 1].push(rect(x, y, widths[index], height, true));
        wrap(label, widths[index], 7, 2).forEach((line, lineIndex) => {
          pages[pages.length - 1].push(text(line, x + 5, y + 5 + lineIndex * 8, 6.8, true));
        });
        x += widths[index];
      });
      y += height;
    };
    const startPage = () => {
      pages.push([]);
      pageHeader(false);
    };
    pageHeader(true);
    (data.tableRows || []).slice(1).forEach((row, rowIndex) => {
      const rowKind = data.weekKinds?.[rowIndex + 1];
      if (rowKind === "semester") {
        const height = 21;
        if (y + height > pageHeight - 35) startPage();
        pages[pages.length - 1].push(rect(margin, y, contentWidth, height, false, "0.89 0.93 0.89"));
        pages[pages.length - 1].push(text(row[0], margin + 8, y + 5, 9, true));
        y += height;
        return;
      }
      const cells = headers.map((_, index) => String(row[index] ?? ""));
      const wrapped = cells.map((cell, index) => wrap(cell, widths[index], 7));
      const maxLines = Math.max(1, ...wrapped.map((lines) => lines.length));
      const maxLinesPerPart = 42;
      for (let offset = 0; offset < maxLines; offset += maxLinesPerPart) {
        const partLines = Math.min(maxLinesPerPart, maxLines - offset);
        const rowHeight = Math.max(22, partLines * 8.5 + 9);
        if (y + rowHeight > pageHeight - 35) startPage();
        let x = margin;
        const eventFill = rowKind === "mid_semester" ? "1 0.96 0.88"
          : rowKind === "revision" ? "0.91 0.96 0.99"
            : rowKind === "end_semester" ? "0.99 0.92 0.91"
              : null;
        widths.forEach((width, index) => {
          pages[pages.length - 1].push(rect(x, y, width, rowHeight, false, eventFill));
          wrapped[index].slice(offset, offset + maxLinesPerPart).forEach((line, lineIndex) => {
            pages[pages.length - 1].push(text(line, x + 5, y + 4 + lineIndex * 8.5, 6.8, false));
          });
          x += width;
        });
        y += rowHeight;
      }
    });
    const signatureHeight = 78;
    if (y + signatureHeight > pageHeight - 35) startPage();
    pages[pages.length - 1].push(text("REVIEW & SIGN-OFF", margin, y + 2, 9, true));
    const signoffWidth = (contentWidth - 18) / 2;
    const signoffs = [
      { x: margin, role: "Prepared by · Teacher", name: data.teacherName || "Teacher", signature: "Teacher's signature" },
      { x: margin + signoffWidth + 18, role: "Reviewed by · HOD", name: data.hodName || "HOD", signature: "HOD's signature" }
    ];
    signoffs.forEach((signoff) => {
      pages[pages.length - 1].push(text(signoff.role, signoff.x, y + 19, 7.1, true));
      pages[pages.length - 1].push(text(signoff.name, signoff.x, y + 31, 8, false));
      const lineY = pageHeight - (y + 58);
      pages[pages.length - 1].push(`0.52 0.57 0.53 RG 0.55 w ${signoff.x} ${lineY} m ${signoff.x + signoffWidth} ${lineY} l S\n`);
      pages[pages.length - 1].push(text(signoff.signature, signoff.x, y + 61, 6.5, false));
      pages[pages.length - 1].push(text("Date: __________________", signoff.x + signoffWidth - 86, y + 61, 6.5, false));
    });
    y += signatureHeight;
    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    const refs = [];
    pages.forEach((commands, index) => {
      const footer = `Teacher review copy  |  Page ${index + 1} of ${pages.length}`;
      commands.push(text(footer, margin, pageHeight - 24, 7));
      const stream = commands.join("");
      const pageNumber = objects.length + 1;
      const streamNumber = pageNumber + 1;
      refs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${refs.join(" ")}] /Count ${refs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function reportCardPdfBlob(data) {
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 38;
    const contentWidth = pageWidth - margin * 2;
    const administrator = data.administrator || {};
    const reports = Array.isArray(data.reportCards) ? data.reportCards : [];
    const logo = administrator.logoPdf;
    const pages = [];
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[–—]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, "");
    const escaped = (value) => plain(value).replace(/[\\()]/g, "\\$&");
    const text = (value, x, top, size = 9, bold = false, color = "0.15 0.21 0.17") =>
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${pageHeight - top - size} Tm (${escaped(value)}) Tj ET\n`;
    const rect = (x, top, width, height, fill, stroke = "0.82 0.86 0.82") =>
      `${fill} rg ${x} ${pageHeight - top - height} ${width} ${height} re f\n${stroke} RG 0.6 w ${x} ${pageHeight - top - height} ${width} ${height} re S\n`;
    const wrap = (value, width, size = 8) => {
      const limit = Math.max(10, Math.floor(width / (size * 0.52)));
      const output = [];
      let line = "";
      for (const word of plain(value).split(/\s+/).filter(Boolean)) {
        if (line && `${line} ${word}`.length > limit) {
          output.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) output.push(line);
      return output.length ? output : [""];
    };
    const addText = (commands, value, x, top, size, bold, color, width = contentWidth) => {
      const lines = wrap(value, width, size);
      lines.forEach((line, index) => commands.push(text(line, x, top + index * (size + 3), size, bold, color)));
      return lines.length * (size + 3);
    };
    const newPage = (report, continued = false) => {
      const commands = [];
      pages.push(commands);
      let y = 30;
      commands.push(rect(0, 0, pageWidth, 105, "0.94 0.97 0.94", "0.94 0.97 0.94"));
      commands.push(rect(0, 101, pageWidth, 4, "0.78 0.59 0.23", "0.78 0.59 0.23"));
      if (logo) commands.push(`q 56 0 0 56 ${margin} ${pageHeight - 22 - 56} cm /Im1 Do Q\n`);
      else {
        commands.push(rect(margin, 22, 56, 56, "0.13 0.32 0.23"));
        commands.push(text("A", margin + 18, 35, 28, true, "1 1 1"));
      }
      const schoolX = margin + 70;
      commands.push(text("STUDENT RESULTS SLIP", schoolX, 25, 8, true, "0.78 0.59 0.23"));
      addText(commands, administrator.school || "School", schoolX, 42, 15, true, "0.08 0.24 0.17", contentWidth - 80);
      const contacts = [administrator.name && `Prepared by ${administrator.name}`, administrator.email, administrator.phone,
        [administrator.region, administrator.district].filter(Boolean).join(" · ")].filter(Boolean).join("  |  ");
      addText(commands, contacts, schoolX, 73, 7, false, "0.34 0.42 0.36", contentWidth - 80);
      y = 123;
      commands.push(text(continued ? "STUDENT ASSESSMENT REPORT · CONTINUED" : "STUDENT ASSESSMENT REPORT", margin, y, 13, true, "0.08 0.24 0.17"));
      y += 24;
      commands.push(rect(margin, y, contentWidth, 48, "0.97 0.98 0.96"));
      commands.push(text("STUDENT", margin + 11, y + 7, 6.5, true, "0.39 0.47 0.41"));
      addText(commands, report.learner.name, margin + 11, y + 18, 11, true, "0.08 0.24 0.17", contentWidth * 0.52);
      commands.push(text("CLASS", margin + contentWidth * 0.58, y + 7, 6.5, true, "0.39 0.47 0.41"));
      addText(commands, report.learner.class_name, margin + contentWidth * 0.58, y + 18, 10, true, "0.08 0.24 0.17", contentWidth * 0.38);
      y += 63;
      if (!continued) {
        commands.push(text("OVERALL PERFORMANCE", margin, y, 8, true, "0.13 0.32 0.23"));
        y += 15;
        const summary = report.summary;
        const ranking = report.reportCardRanking || {};
        const ordinal = (rank, total) => rank && total
          ? `${rank}${rank % 100 >= 11 && rank % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[rank % 10] || "th")} of ${total}`
          : "Not ranked";
        const metrics = [
          ["OVERALL", summary.overall_percentage === null ? "Not available" : `${summary.overall_percentage}%`],
          ["ASSESSMENT GPA", ranking.gpa === null || ranking.gpa === undefined ? "Not available" : `${Number(ranking.gpa).toFixed(1)} / 4.0`],
          ["CLASS POSITION", ordinal(ranking.classRank, ranking.classSize)],
          ["MANAGED-CLASS POSITION", ordinal(ranking.overallRank, ranking.overallSize)],
          ["ASSESSMENTS", String(summary.assessment_count)],
          ["FULLY MARKED", String(summary.finalized_count)],
          ["AWAITING REVIEW", String(summary.pending_review_count)],
          ["MARKS", `${summary.earned_marks}/${summary.possible_marks}`]
        ];
        const gap = 7;
        const cardWidth = (contentWidth - gap * 3) / 4;
        metrics.forEach(([label, value], index) => {
          const row = Math.floor(index / 4);
          const column = index % 4;
          const x = margin + column * (cardWidth + gap);
          const cardY = y + row * 50;
          commands.push(rect(x, cardY, cardWidth, 43, "0.95 0.97 0.95"));
          commands.push(text(label, x + 6, cardY + 7, 5.7, true, "0.39 0.47 0.41"));
          addText(commands, value, x + 6, cardY + 21, 9, true, "0.08 0.24 0.17", cardWidth - 12);
        });
        y += 107;
        commands.push(text("GPA: 80-100 = 4.0, 75-79 = 3.5, 70-74 = 3.0, 65-69 = 2.5, 60-64 = 2.0, 50-59 = 1.5, 45-49 = 1.0, 40-44 = 0.5, below 40 = 0.0.", margin, y, 6, false, "0.40 0.46 0.41"));
        y += 10;
        commands.push(text("Ranks include students with finalized aggregate results only; ties share a rank.", margin, y, 6, false, "0.40 0.46 0.41"));
        y += 12;
        const types = Object.entries(summary.question_type_analysis || {});
        if (types.length) {
          commands.push(text("PERFORMANCE BY QUESTION TYPE", margin, y, 8, true, "0.13 0.32 0.23"));
          y += 14;
          types.forEach(([type, analysis], index) => {
            const percentage = analysis.percentage;
            const tone = percentage === null ? { fill: "0.95 0.96 0.95", text: "0.40 0.45 0.41" }
              : Number(percentage) >= 70 ? { fill: "0.90 0.96 0.91", text: "0.09 0.38 0.21" }
                : Number(percentage) >= 50 ? { fill: "1 0.97 0.88", text: "0.52 0.35 0.00" }
                  : { fill: "0.99 0.92 0.91", text: "0.62 0.13 0.10" };
            const rowY = y + index * 21;
            commands.push(rect(margin, rowY, contentWidth, 19, tone.fill, tone.fill));
            commands.push(text(type.replaceAll("_", " "), margin + 8, rowY + 5, 7, true, tone.text));
            commands.push(text(`${analysis.earned}/${analysis.possible}  ·  ${percentage === null ? "Not available" : `${percentage}%`}`, pageWidth - margin - 105, rowY + 5, 7, true, tone.text));
          });
          y += types.length * 21 + 10;
          commands.push(text("Green: 70%+  ·  Amber: 50-69%  ·  Red: below 50%", margin, y, 6.5, false, "0.40 0.46 0.41"));
          y += 14;
        }
      }
      return { commands, y, report };
    };
    const section = (state, label) => {
      if (state.y > pageHeight - 92) state = newPage(state.report, true);
      state.y += addText(state.commands, label, margin, state.y, 8, true, "0.13 0.32 0.23") + 3;
      return state;
    };
    const drawHistory = (state, reports) => {
      const widths = [contentWidth * 0.42, contentWidth * 0.2, contentWidth * 0.19, contentWidth * 0.19];
      const headers = ["ASSESSMENT / SUBJECT", "SCORE", "STATUS", "SUBMITTED"];
      const drawHeader = () => {
        let x = margin;
        headers.forEach((header, index) => {
          state.commands.push(rect(x, state.y, widths[index], 23, "0.13 0.32 0.23", "0.13 0.32 0.23"));
          state.commands.push(text(header, x + 5, state.y + 7, 6.2, true, "1 1 1"));
          x += widths[index];
        });
        state.y += 23;
      };
      state = section(state, "ASSESSMENT HISTORY");
      drawHeader();
      reports.forEach((assessment, rowIndex) => {
        const cells = [
          `${assessment.title}\n${assessment.subject}`,
          assessment.final_score === null
            ? assessment.review_pending ? `${assessment.auto_score} objective; pending` : "Not finalized"
            : `${assessment.final_score}/${assessment.total_marks} (${assessment.percentage}%)`,
          String(assessment.status || "").replaceAll("_", " "),
          assessment.submitted_at || "Not recorded"
        ];
        const cellLines = cells.map((value, index) => wrap(value, widths[index] - 10, 7));
        const height = Math.max(27, ...cellLines.map((lines) => lines.length * 9 + 8));
        if (state.y + height > pageHeight - 45) {
          state = newPage(state.report, true);
          drawHeader();
        }
        let x = margin;
        cellLines.forEach((cellLinesForColumn, index) => {
          state.commands.push(rect(x, state.y, widths[index], height, rowIndex % 2 ? "1 1 1" : "0.97 0.98 0.96"));
          cellLinesForColumn.forEach((line, lineIndex) =>
            state.commands.push(text(line, x + 5, state.y + 5 + lineIndex * 9, 7, index === 0, "0.15 0.21 0.17")));
          x += widths[index];
        });
        state.y += height;
      });
      state.y += 12;
      return state;
    };
    reports.forEach((report) => {
      let state = newPage(report);
      if (report.assessments.length) state = drawHistory(state, report.assessments);
      else {
        state = section(state, "ASSESSMENT HISTORY");
        state.commands.push(text("No online assessment attempts have been recorded.", margin, state.y, 8));
        state.y += 18;
      }
      if (data.includeQuestionDetails) {
        state = section(state, "ANSWER COLOR KEY  ·  Green: correct/full marks  ·  Red: incorrect/no marks  ·  Amber: partial/pending");
        report.assessments.forEach((assessment) => {
          state = section(state, `${assessment.title} · ${assessment.subject}`);
          assessment.questions.forEach((question) => {
            const questionText = `Question ${question.question_number} · ${question.question_type.replaceAll("_", " ")} · ${question.score === null ? "Awaiting review" : `${question.score}/${question.marks} marks`}`;
            const promptLines = wrap(question.prompt || "Question text unavailable.", contentWidth - 22, 8);
            let learnerAnswer = question.learner_answer || "No response";
            if (question.question_type === "mcq" && /^\\d+$/.test(learnerAnswer)) {
              const answerIndex = Number(learnerAnswer);
              learnerAnswer = `${String.fromCharCode(65 + answerIndex)}. ${question.options?.[answerIndex] || "Unavailable option"}`;
            }
            const tone = question.is_correct === true || (question.score !== null && Number(question.score) >= Number(question.marks))
              ? { fill: "0.90 0.96 0.91", text: "0.09 0.38 0.21" }
              : question.is_correct === false || (question.score !== null && Number(question.score) === 0)
                ? { fill: "0.99 0.92 0.91", text: "0.62 0.13 0.10" }
                : question.score === null ? { fill: "1 0.97 0.88", text: "0.52 0.35 0.00" }
                  : { fill: "0.95 0.97 0.95", text: "0.13 0.32 0.23" };
            const needed = 30 + promptLines.length * 11 + 24;
            if (state.y + needed > pageHeight - 48) state = newPage(report, true);
            state.commands.push(rect(margin, state.y, contentWidth, 21, "0.95 0.97 0.95"));
            state.commands.push(text(questionText, margin + 8, state.y + 6, 7, true, "0.13 0.32 0.23"));
            state.y += 26;
            promptLines.forEach((line) => {
              if (state.y > pageHeight - 48) state = newPage(report, true);
              state.commands.push(text(line, margin + 8, state.y, 8));
              state.y += 11;
            });
            const answerLines = wrap(`Student response: ${learnerAnswer}`, contentWidth - 26, 7.5);
            const answerHeight = answerLines.length * 10 + 7;
            if (state.y + answerHeight > pageHeight - 45) state = newPage(report, true);
            state.commands.push(rect(margin + 6, state.y, contentWidth - 12, answerHeight, tone.fill, tone.fill));
            answerLines.forEach((line, index) => state.commands.push(text(line, margin + 11, state.y + 4 + index * 10, 7.5, true, tone.text)));
            state.y += answerHeight + 4;
            if (question.expected_answer) {
              state.y += addText(state.commands, `Expected response: ${question.expected_answer}`, margin + 8, state.y, 7.5, false, "0.34 0.42 0.36");
            }
            if (question.teacher_feedback) {
              state.y += addText(state.commands, `Teacher feedback: ${question.teacher_feedback}`, margin + 8, state.y, 7.5, false, "0.34 0.42 0.36");
            }
            state.y += 8;
          });
        });
      }
      if (state.y > pageHeight - 92) state = newPage(report, true);
      state = section(state, "TEACHER VERIFICATION");
      const signatureGap = 9;
      const signatureWidth = (contentWidth - signatureGap * 2) / 3;
      ["Class teacher signature", "Headteacher signature", `Date: ${new Date().toLocaleDateString()}`].forEach((label, index) => {
        const x = margin + index * (signatureWidth + signatureGap);
        state.commands.push(`0.48 0.55 0.49 RG 0.7 w ${x} ${pageHeight - state.y - 22} m ${x + signatureWidth} ${pageHeight - state.y - 22} l S\n`);
        addText(state.commands, label, x, state.y + 27, 6.5, false, "0.40 0.46 0.41", signatureWidth);
      });
    });
    pages.forEach((commands, index) => {
      commands.push(`0.82 0.87 0.83 RG 0.7 w ${margin} 32 m ${pageWidth - margin} 32 l S\n`);
      commands.push(text(`${administrator.school || "School"}  |  Confidential student results slip`, margin, pageHeight - 25, 6.5, false, "0.40 0.46 0.41"));
      commands.push(text(`Page ${index + 1} of ${pages.length}`, pageWidth - margin - 55, pageHeight - 25, 6.5, false, "0.40 0.46 0.41"));
    });
    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    let logoObjectNumber = 0;
    if (logo) {
      logoObjectNumber = objects.length + 1;
      objects.push(`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${logo.hex.length + 2} >>\nstream\n${logo.hex}>\nendstream`);
    }
    const refs = [];
    pages.forEach((commands) => {
      const stream = commands.join("");
      const pageNumber = objects.length + 1;
      const streamNumber = pageNumber + 1;
      refs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${logoObjectNumber ? ` /XObject << /Im1 ${logoObjectNumber} 0 R >>` : ""} >> /Contents ${streamNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${refs.join(" ")}] /Count ${refs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function scoreSheetPdfBlob(data) {
    const pageWidth = 842;
    const pageHeight = 595;
    const margin = 36;
    const contentWidth = pageWidth - margin * 2;
    const rows = Array.isArray(data.tableRows) ? data.tableRows : [];
    const headers = rows[0] || [];
    const columnWidths = [35, 145, 67, 61, 61, 61, 67, 61, 212];
    const pages = [[]];
    let y = 0;
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00e2\u201a\u00b5|₵/g, "GHS ").replace(/\u00c2\u00b7|·/g, " - ")
      .replace(/[–—]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, "");
    const escaped = (value) => plain(value).replace(/[\\()]/g, "\\$&");
    const text = (value, x, top, size = 8, bold = false, color = "0.15 0.21 0.17") =>
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${pageHeight - top - size} Tm (${escaped(value)}) Tj ET\n`;
    const rect = (x, top, width, height, fill, stroke = "0.78 0.83 0.78") =>
      `${fill} rg ${x} ${pageHeight - top - height} ${width} ${height} re f\n${stroke} RG 0.5 w ${x} ${pageHeight - top - height} ${width} ${height} re S\n`;
    const wrap = (value, width, size = 7.2) => {
      const limit = Math.max(8, Math.floor(width / (size * 0.51)));
      const output = [];
      let line = "";
      for (const word of plain(value).split(/\s+/).filter(Boolean)) {
        if (word.length > limit) {
          if (line) { output.push(line); line = ""; }
          for (let offset = 0; offset < word.length; offset += limit) output.push(word.slice(offset, offset + limit));
        } else if (line && `${line} ${word}`.length > limit) {
          output.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) output.push(line);
      return output.length ? output : [""];
    };
    const details = data.assessmentDetails || {};
    const administrator = data.administrator || {};
    const drawTableHeader = () => {
      let x = margin;
      const headerHeight = 30;
      headers.forEach((value, index) => {
        const width = columnWidths[index] || contentWidth / headers.length;
        pages[pages.length - 1].push(rect(x, y, width, headerHeight, "0.13 0.32 0.23", "0.13 0.32 0.23"));
        wrap(value, width - 10, 7).slice(0, 2).forEach((line, lineIndex) =>
          pages[pages.length - 1].push(text(line, x + 5, y + 5 + lineIndex * 8, 7, true, "1 1 1")));
        x += width;
      });
      y += headerHeight;
    };
    const startPage = (firstPage) => {
      if (!firstPage) pages.push([]);
      y = firstPage ? 35 : 28;
      pages[pages.length - 1].push(text(firstPage ? "AKADEMI  |  ASSESSMENT SCORE SHEET" : "AKADEMI  |  SCORE SHEET  ·  CONTINUED", margin, y, 8, true, "0.13 0.32 0.23"));
      y += 14;
      pages[pages.length - 1].push(`0.13 0.32 0.23 RG 1 w ${margin} ${pageHeight - y} m ${pageWidth - margin} ${pageHeight - y} l S\n`);
      y += 11;
      if (firstPage) {
        const titleLines = wrap(data.title || "Assessment score sheet", contentWidth, 17);
        titleLines.forEach((line) => { pages[0].push(text(line, margin, y, 17, true, "0.08 0.23 0.15")); y += 21; });
        const summary = [
          details.school || administrator.school,
          details.className && `Class: ${details.className}`,
          details.subject && `Subject: ${details.subject}`,
          details.status && `Status: ${details.status}`,
          details.totalMarks !== undefined && `Total marks: ${details.totalMarks}`
        ].filter(Boolean).join("  |  ");
        wrap(summary, contentWidth, 8.5).forEach((line) => { pages[0].push(text(line, margin, y, 8.5, false, "0.34 0.42 0.36")); y += 12; });
        const contacts = [
          administrator.name && `Prepared by ${administrator.name}`,
          administrator.email,
          administrator.phone
        ].filter(Boolean).join("  |  ");
        if (contacts) {
          wrap(contacts, contentWidth, 7.5).forEach((line) => { pages[0].push(text(line, margin, y, 7.5, false, "0.38 0.45 0.40")); y += 10; });
        }
        if (data.rankingNote) {
          wrap(data.rankingNote, contentWidth, 7.5).forEach((line) => { pages[0].push(text(line, margin, y, 7.5, false, "0.38 0.45 0.40")); y += 10; });
        }
        y += 8;
      } else {
        y += 2;
      }
      drawTableHeader();
    };
    startPage(true);
    const bodyRows = rows.slice(1).length
      ? rows.slice(1)
      : [["No learners are on the roster.", ...headers.slice(1).map(() => "")]];
    bodyRows.forEach((row, rowIndex) => {
      const cellLines = headers.map((_, columnIndex) => wrap(row[columnIndex] ?? "", (columnWidths[columnIndex] || contentWidth / headers.length) - 10));
      const rowHeight = Math.max(22, ...cellLines.map((lines) => lines.length * 9 + 8));
      if (y + rowHeight > pageHeight - 37) startPage(false);
      let x = margin;
      headers.forEach((_, columnIndex) => {
        const width = columnWidths[columnIndex] || contentWidth / headers.length;
        const fill = rowIndex % 2 === 0 ? "0.97 0.98 0.96" : "1 1 1";
        pages[pages.length - 1].push(rect(x, y, width, rowHeight, fill));
        cellLines[columnIndex].forEach((line, lineIndex) =>
          pages[pages.length - 1].push(text(line, x + 5, y + 4 + lineIndex * 9, 7.2, columnIndex === 0)));
        x += width;
      });
      y += rowHeight;
    });
    pages.forEach((commands, index) => {
      commands.push(`0.78 0.83 0.78 RG 0.6 w ${margin} 29 m ${pageWidth - margin} 29 l S\n`);
      commands.push(text("Akademi  |  Confidential teacher review copy", margin, pageHeight - 24, 7, false, "0.38 0.43 0.39"));
      commands.push(text(`Page ${index + 1} of ${pages.length}`, pageWidth - margin - 60, pageHeight - 24, 7, false, "0.38 0.43 0.39"));
    });
    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    const pageRefs = [];
    pages.forEach((commands) => {
      const stream = commands.join("");
      const pageNumber = objects.length + 1;
      const contentNumber = pageNumber + 1;
      pageRefs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function pdfBlob(data) {
    if (data.reportCard && Array.isArray(data.reportCards)) return reportCardPdfBlob(data);
    if (data.scoreSheet && Array.isArray(data.tableRows)) return scoreSheetPdfBlob(data);
    if (data.schemeExport && Array.isArray(data.tableRows)) return schemePdfBlob(data);
    if (data.scheduleTable && Array.isArray(data.tableRows)) return schedulePdfBlob(data);
    if (!Array.isArray(data.lines)) return assessmentPdfBlob(data);
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00e2\u201a\u00b5|₵/g, "GHS ").replace(/\u00c2\u00b7|·/g, " - ").replace(/\u00e2\u20ac\u00a2|•/g, "- ").replace(/[–—]/g, "-")
      .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, "");
    const wrap = (value, width = 88) => {
      const words = plain(value).split(/\s+/);
      const result = [];
      let line = "";
      words.forEach((word) => {
        if (line && (line + " " + word).length > width) {
          result.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      });
      if (line) result.push(line);
      return result.length ? result : [""];
    };
    const textLines = [];
    paragraphs(data).forEach((paragraph) => wrap(paragraph.text).forEach((line) => textLines.push({
      text: line,
      size: paragraph.style === "Title" ? 18 : paragraph.style === "Heading1" ? 13 : 10,
      bold: paragraph.style === "Title" || paragraph.style === "Heading1"
    })));
    const pages = [[]];
    let y = 744;
    textLines.forEach((line) => {
      const lineHeight = line.size + 5;
      if (y - lineHeight < 50) {
        pages.push([]);
        y = 744;
      }
      pages[pages.length - 1].push({ ...line, y });
      y -= lineHeight;
    });
    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    const pageRefs = [];
    const esc = (value) => value.replace(/[\\()]/g, "\\$&");
    pages.forEach((lines, pageIndex) => {
      const pageNumber = objects.length + 1;
      const contentNumber = pageNumber + 1;
      pageRefs.push(`${pageNumber} 0 R`);
      let stream = "BT\n";
      lines.forEach((line) => {
        stream += `/F1 ${line.size} Tf\n1 0 0 1 50 ${line.y} Tm\n(${esc(line.text)}) Tj\n`;
      });
      if (data.hodName && !data.schemeExport) {
        const verification = plain(`HOD signature required: ${data.hodName}`);
        stream += `/F1 8 Tf\n1 0 0 1 50 25 Tm\n(${esc(verification)}) Tj\n`;
      }
      stream += "ET";
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(output.length);
      output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function schedulePdfBlob(data) {
    const pageWidth = 842;
    const pageHeight = 595;
    const margin = 36;
    const contentWidth = pageWidth - margin * 2;
    const columnCount = Math.max(1, (data.tableRows[0] || []).length);
    const dayColumnWidth = columnCount > 1 ? 90 : contentWidth;
    const columns = [dayColumnWidth, ...Array.from({ length: columnCount - 1 }, () => (contentWidth - dayColumnWidth) / (columnCount - 1))];
    const pages = [[]];
    let y = 0;
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00e2\u201a\u00b5|₵/g, "GHS ").replace(/\u00c2\u00b7|·/g, " - ").replace(/[–—]/g, "-")
      .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, "");
    const escaped = (value) => plain(value).replace(/[\\()]/g, "\\$&");
    const text = (value, x, top, size = 7.2, bold = false, color = "0.15 0.21 0.17") =>
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${pageHeight - top - size} Tm (${escaped(value)}) Tj ET\n`;
    const rect = (x, top, width, height, fill, stroke = "0.82 0.86 0.82") =>
      `${fill} rg ${x} ${pageHeight - top - height} ${width} ${height} re f\n${stroke} RG 0.45 w ${x} ${pageHeight - top - height} ${width} ${height} re S\n`;
    const wrap = (value, width, size) => {
      const limit = Math.max(8, Math.floor(width / (size * 0.52)));
      const result = [];
      let line = "";
      plain(value).split(/\s+/).filter(Boolean).forEach((word) => {
        if (line && `${line} ${word}`.length > limit) {
          result.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      });
      if (line) result.push(line);
      return result.length ? result : [""];
    };
    const header = (firstPage) => {
      if (firstPage) {
        pages[pages.length - 1].push(`0.13 0.32 0.23 rg ${margin} ${pageHeight - 31} ${contentWidth} 4 re f\n`);
        pages[pages.length - 1].push(text(data.title || "Teaching schedule", margin, 42, 17, true, "0.08 0.23 0.15"));
        pages[pages.length - 1].push(text(`${data.school || "Teacher workspace"}  |  Recurring teaching timetable`, margin, 64, 8.5, false, "0.34 0.42 0.36"));
        y = 88;
      } else {
        pages[pages.length - 1].push(text(`${data.title || "Teaching schedule"}  |  continued`, margin, 28, 9, true, "0.10 0.29 0.19"));
        y = 47;
      }
      const heading = data.tableRows[0] || [];
      let x = margin;
      const rowHeight = 25;
      heading.forEach((value, index) => {
        const width = columns[index] || contentWidth / heading.length;
        pages[pages.length - 1].push(rect(x, y, width, rowHeight, "0.13 0.32 0.23", "0.13 0.32 0.23"));
        wrap(value, width - 10, 7.1).forEach((line, lineIndex) => {
          pages[pages.length - 1].push(text(line, x + 5, y + 3 + lineIndex * 8, 7.1, true, "1 1 1"));
        });
        x += width;
      });
      y += rowHeight;
    };
    header(true);
    const bodyRows = (data.tableRows || []).slice(1);
    if (!bodyRows.length) {
      const emptyRow = ["No classes scheduled for this period.", ...Array.from({ length: columnCount - 1 }, () => "")];
      bodyRows.push(emptyRow);
    }
    bodyRows.forEach((row, rowIndex) => {
      const cellLines = row.map((value, index) => {
        const width = columns[index] || contentWidth / row.length;
        return wrap(value, width - 10, columnCount > 7 ? 5.8 : 7.2);
      });
      const rowHeight = Math.max(23, ...cellLines.map((lines) => lines.length * 9.5 + 9));
      if (y + rowHeight > pageHeight - 34) {
        pages.push([]);
        header(false);
      }
      let x = margin;
      row.forEach((value, index) => {
        const width = columns[index] || contentWidth / row.length;
        const background = rowIndex % 2 === 0 ? "0.97 0.98 0.96" : "1 1 1";
        pages[pages.length - 1].push(rect(x, y, width, rowHeight, background));
        cellLines[index].forEach((line, lineIndex) => {
          const fontSize = columnCount > 7 ? 5.8 : 7.2;
          pages[pages.length - 1].push(text(line, x + 5, y + 5 + lineIndex * 9.5, fontSize, index === 0));
        });
        x += width;
      });
      y += rowHeight;
    });
    pages.forEach((commands, index) => {
      commands.push(text(`Page ${index + 1} of ${pages.length}`, pageWidth - margin - 52, pageHeight - 25, 7, false, "0.38 0.43 0.39"));
    });
    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    const pageRefs = [];
    pages.forEach((commands) => {
      const pageNumber = objects.length + 1;
      const contentNumber = pageNumber + 1;
      const stream = commands.join("");
      pageRefs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(output.length);
      output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function assessmentPdfBlob(data) {
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;
    const pages = [[]];
    // Keep all layout measurements top-origin. PDF drawing commands convert
    // these positions to bottom-origin coordinates only at the final text/rule.
    let y = 58;
    const pagesStart = () => { pages.push([]); y = 58; };
    const plain = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00e2\u201a\u00b5|₵/g, "GHS ").replace(/\u00c2\u00b7|·/g, " - ").replace(/\u00e2\u20ac\u00a2|•/g, "- ").replace(/[–—]/g, "-")
      .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, "");
    const escaped = (value) => plain(value).replace(/[\\()]/g, "\\$&");
    const text = (value, x, top, size = 10, bold = false, color = "0.16 0.22 0.18") => {
      const baseline = pageHeight - top - size;
      return `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x} ${baseline} Tm (${escaped(value)}) Tj ET\n`;
    };
    const wrap = (value, width, size = 10) => {
      const limit = Math.max(12, Math.floor(width / (size * 0.51)));
      const result = [];
      let line = "";
      for (const word of plain(value).split(/\s+/).filter(Boolean)) {
        if (!line && word.length > limit) {
          for (let offset = 0; offset < word.length; offset += limit) result.push(word.slice(offset, offset + limit));
        } else if (line && `${line} ${word}`.length > limit) {
          result.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) result.push(line);
      return result.length ? result : [""];
    };
    const ensureSpace = (height, bottom = 770) => { if (y + height > bottom) pagesStart(); };
    const writeParagraph = (value, { size = 10, bold = false, color = "0.16 0.22 0.18", x = margin, width = contentWidth, lineGap = 4, after = 7 } = {}) => {
      const lines = wrap(value, width, size);
      lines.forEach((line, index) => {
        ensureSpace(size + lineGap + (index === lines.length - 1 ? after : 0));
        pages[pages.length - 1].push(text(line, x, y, size, bold, color));
        y += size + lineGap;
      });
      y += after;
    };
    const sectionHeading = (label) => {
      ensureSpace(31);
      y += 3;
      pages[pages.length - 1].push(`0.17 0.38 0.27 rg ${margin} ${pageHeight - y - 17} 3 17 re f\n`);
      pages[pages.length - 1].push(text(label, margin + 10, y, 12, true, "0.10 0.29 0.19"));
      y += 25;
    };
    const drawRule = (top = y) => pages[pages.length - 1].push(`0.82 0.87 0.83 RG 0.7 w ${margin} ${pageHeight - top} m ${pageWidth - margin} ${pageHeight - top} l S\n`);
    const drawTable = (rows) => {
      if (!rows.length) return;
      const columnCount = Math.max(1, ...rows.map((row) => row.length));
      const columnWidth = contentWidth / columnCount;
      rows.forEach((row, rowIndex) => {
        const cellLines = Array.from({ length: columnCount }, (_, columnIndex) =>
          wrap(row[columnIndex] || "", columnWidth - 12, 8.5));
        const rowHeight = Math.max(23, ...cellLines.map((lines) => lines.length * 10 + 9));
        if (y + rowHeight > 770) pagesStart();
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
          const x = margin + columnIndex * columnWidth;
          const bottom = pageHeight - y - rowHeight;
          const fill = rowIndex === 0 ? "0.91 0.95 0.92" : rowIndex % 2 ? "0.98 0.99 0.98" : "1 1 1";
          pages[pages.length - 1].push(`${fill} rg ${x} ${bottom} ${columnWidth} ${rowHeight} re f\n0.67 0.72 0.68 RG 0.5 w ${x} ${bottom} ${columnWidth} ${rowHeight} re S\n`);
          cellLines[columnIndex].forEach((line, lineIndex) => {
            pages[pages.length - 1].push(text(line, x + 6, y + 5 + lineIndex * 10, 8.5, rowIndex === 0));
          });
        }
        y += rowHeight;
      });
      y += 8;
    };
    const drawVisual = (visual) => {
      if (!visual || !["graph", "bar_chart", "geometry"].includes(visual.type)) return;
      const boxX = margin + 18;
      const boxWidth = contentWidth - 36;
      const boxHeight = 166;
      ensureSpace(boxHeight + 12);
      const boxTop = y;
      const title = visual.title || (visual.type === "bar_chart" ? "Bar chart" : visual.type === "graph" ? "Coordinate graph" : "Geometry diagram");
      pages[pages.length - 1].push(`0.96 0.98 0.96 rg ${boxX} ${pageHeight - boxTop - boxHeight} ${boxWidth} ${boxHeight} re f\n0.78 0.84 0.79 RG 0.6 w ${boxX} ${pageHeight - boxTop - boxHeight} ${boxWidth} ${boxHeight} re S\n`);
      pages[pages.length - 1].push(text(title, boxX + 8, boxTop + 6, 9, true, "0.10 0.29 0.19"));
      const line = (x1, y1, x2, y2, color = "0.48 0.57 0.50", width = 0.6) =>
        pages[pages.length - 1].push(`${color} RG ${width} w ${x1} ${pageHeight - y1} m ${x2} ${pageHeight - y2} l S\n`);
      if (visual.type === "bar_chart") {
        const labels = Array.isArray(visual.labels) ? visual.labels : [];
        const values = Array.isArray(visual.values) ? visual.values.map(Number) : [];
        const plotX = boxX + 34;
        const plotY = boxTop + 28;
        const plotW = boxWidth - 50;
        const plotH = 98;
        const max = Math.max(...values, 1);
        line(plotX, plotY + plotH, plotX + plotW, plotY + plotH, "0.35 0.45 0.39", 0.9);
        const slot = plotW / Math.max(1, labels.length);
        labels.forEach((label, index) => {
          const barHeight = Math.max(0, values[index] || 0) / max * (plotH - 12);
          const barWidth = Math.min(24, slot * 0.55);
          const x = plotX + index * slot + (slot - barWidth) / 2;
          const bottom = pageHeight - (plotY + plotH - barHeight);
          pages[pages.length - 1].push(`0.22 0.55 0.40 rg ${x} ${bottom} ${barWidth} ${barHeight} re f\n`);
          pages[pages.length - 1].push(text(String(values[index] ?? ""), x - 5, plotY + plotH - barHeight - 11, 7));
          pages[pages.length - 1].push(text(String(label).slice(0, 12), x - 8, plotY + plotH + 5, 6.5));
        });
      } else if (visual.type === "graph") {
        const [xMin, xMax, yMin, yMax] = [visual.x_min, visual.x_max, visual.y_min, visual.y_max].map(Number);
        const plotX = boxX + 42;
        const plotY = boxTop + 28;
        const plotW = boxWidth - 58;
        const plotH = 105;
        const x = (value) => plotX + (value - xMin) / (xMax - xMin) * plotW;
        const yy = (value) => plotY + (yMax - value) / (yMax - yMin) * plotH;
        for (let index = 0; index <= 5; index++) {
          const tx = plotX + plotW * index / 5;
          const ty = plotY + plotH * index / 5;
          line(tx, plotY, tx, plotY + plotH, "0.86 0.89 0.86", 0.35);
          line(plotX, ty, plotX + plotW, ty, "0.86 0.89 0.86", 0.35);
          pages[pages.length - 1].push(text((xMin + (xMax - xMin) * index / 5).toFixed(1), tx - 7, plotY + plotH + 4, 6));
          pages[pages.length - 1].push(text((yMax - (yMax - yMin) * index / 5).toFixed(1), plotX - 28, ty - 3, 6));
        }
        const axisX = xMin <= 0 && xMax >= 0 ? x(0) : plotX;
        const axisY = yMin <= 0 && yMax >= 0 ? yy(0) : plotY + plotH;
        line(axisX, plotY, axisX, plotY + plotH, "0.35 0.45 0.39", 0.9);
        line(plotX, axisY, plotX + plotW, axisY, "0.35 0.45 0.39", 0.9);
        const points = (visual.points || []).map((point) => [Number(point[0]), Number(point[1])]);
        points.forEach((point, index) => {
          const px = x(point[0]);
          const py = yy(point[1]);
          if (index) line(x(points[index - 1][0]), yy(points[index - 1][1]), px, py, "0.09 0.42 0.65", 1.5);
          pages[pages.length - 1].push(`0.09 0.42 0.65 rg ${px - 2} ${pageHeight - py - 2} 4 4 re f\n`);
        });
      } else {
        const shapes = Array.isArray(visual.shapes) ? visual.shapes : [];
        const slot = boxWidth / Math.max(1, shapes.length);
        shapes.forEach((item, index) => {
          const centerX = boxX + slot * (index + 0.5);
          const top = boxTop + 42;
          const stroke = "0.14 0.45 0.33";
          if (item.shape === "rectangle") {
            pages[pages.length - 1].push(`0.91 0.96 0.92 rg ${centerX - 27} ${pageHeight - top - 60} 54 60 re B\n`);
          } else if (item.shape === "triangle") {
            pages[pages.length - 1].push(`0.91 0.96 0.92 rg ${centerX - 32} ${pageHeight - top - 56} m ${centerX} ${pageHeight - top} l ${centerX + 32} ${pageHeight - top - 56} l h B\n`);
          } else if (item.shape === "circle") {
            const radius = 27;
            const curve = radius * 0.5523;
            const cy = pageHeight - top - 32;
            pages[pages.length - 1].push(`0.91 0.96 0.92 rg ${stroke} RG 1 w ${centerX + radius} ${cy} m ${centerX + radius} ${cy + curve} ${centerX + curve} ${cy + radius} ${centerX} ${cy + radius} c ${centerX - curve} ${cy + radius} ${centerX - radius} ${cy + curve} ${centerX - radius} ${cy} c ${centerX - radius} ${cy - curve} ${centerX - curve} ${cy - radius} ${centerX} ${cy - radius} c ${centerX + curve} ${cy - radius} ${centerX + radius} ${cy - curve} ${centerX + radius} ${cy} c B\n`);
          } else {
            line(centerX - 34, top + 50, centerX + 34, top + 8, stroke, 1.4);
          }
          (item.labels || []).slice(0, 4).forEach((label, labelIndex) =>
            pages[pages.length - 1].push(text(String(label), centerX - 25, top + 66 + labelIndex * 10, 7)));
        });
      }
      y += boxHeight + 9;
    };

    const administrator = data.administrator || {};
    const metadata = data._export || {};
    const coverText = (value, x, top, size, bold, color) =>
      pages[0].push(text(value, x, top, size, bold, color));
    const coverRect = (x, top, width, height, fill, stroke = fill) =>
      pages[0].push(`${fill} rg ${x} ${pageHeight - top - height} ${width} ${height} re f\n${stroke} RG 0.6 w ${x} ${pageHeight - top - height} ${width} ${height} re S\n`);
    const coverKind = data.mode === "review"
      ? "LEARNER ANSWER REVIEW"
      : data.mode === "guide" ? "TEACHER MARKING GUIDE  ·  CONFIDENTIAL" : "ASSESSMENT QUESTION PAPER";
    coverRect(0, 0, pageWidth, 190, "0.08 0.24 0.17");
    coverRect(0, 184, pageWidth, 6, "0.78 0.59 0.23");
    const coverLogo = data.administrator?.logoPdf;
    if (coverLogo) {
      pages[0].push(`q 44 0 0 44 ${margin} ${pageHeight - 78 - 44} cm /Im1 Do Q\n`);
    } else {
      coverRect(margin, 34, 44, 44, "0.16 0.42 0.29");
      coverText("A", margin + 13, 43, 24, true, "1 1 1");
    }
    coverText("AKADEMI  /  GHANA SHS", margin + 58, 34, 9, true, "0.88 0.93 0.89");
    coverText(administrator.school || "Teacher workspace", margin + 58, 51, 11, true, "1 1 1");
    coverText(coverKind, margin, 105, 8, true, "0.91 0.75 0.39");
    const titleLines = wrap(data.title || "Assessment", contentWidth, 22);
    titleLines.slice(0, 2).forEach((line, index) =>
      coverText(line, margin, 126 + index * 27, 22, true, "1 1 1"));
    y = 216;
    const coverItems = [
      ["Subject", metadata.subject],
      ["Year / class", [metadata.yearGroup, metadata.className].filter(Boolean).join(" · ")],
      ["Assessment", metadata.assessmentType],
      ...(data.mode === "review" && metadata.learnerName ? [["Learner", metadata.learnerName]] : []),
      ["Duration", metadata.duration ? `${metadata.duration} minutes` : ""],
      ["Questions", (data.questions || []).length || ""],
      ["Total marks", metadata.totalMarks || (data.questions || []).reduce((sum, question) => sum + Number(question.marks || 0), 0)]
    ].filter(([, value]) => value !== undefined && value !== "");
    const cardGap = 12;
    const cardWidth = (contentWidth - cardGap) / 2;
    const coverGridTop = y;
    coverItems.forEach(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = margin + column * (cardWidth + cardGap);
      const top = coverGridTop + row * 52;
      coverRect(x, top, cardWidth, 43, "0.96 0.98 0.96", "0.85 0.89 0.85");
      coverRect(x, top, 3, 43, "0.78 0.59 0.23");
      coverText(label.toUpperCase(), x + 12, top + 7, 7, true, "0.39 0.47 0.41");
      wrap(value, cardWidth - 24, 9).slice(0, 2).forEach((line, lineIndex) =>
        coverText(line, x + 12, top + 20 + lineIndex * 10, 9, true, "0.12 0.25 0.18"));
    });
    y = coverGridTop + Math.ceil(coverItems.length / 2) * 52;
    const adminTop = Math.min(Math.max(y + 18, 390), 650);
    const contacts = [administrator.email, administrator.phone, administrator.region, administrator.district].filter(Boolean).join("  |  ");
    coverRect(margin, adminTop, contentWidth, 82, "0.93 0.96 0.93", "0.85 0.89 0.85");
    coverRect(margin, adminTop, 4, 82, "0.08 0.32 0.22");
    coverText("PREPARED BY", margin + 16, adminTop + 12, 7, true, "0.39 0.47 0.41");
    coverText(administrator.name || "Teacher / administrator", margin + 16, adminTop + 28, 12, true, "0.10 0.29 0.19");
    if (contacts) {
      wrap(contacts, contentWidth - 32, 8).slice(0, 2).forEach((line, index) =>
        coverText(line, margin + 16, adminTop + 49 + index * 11, 8, false, "0.34 0.42 0.36"));
    }
    pagesStart();
    sectionHeading(data.mode === "review" ? "Learner response review" : "Instructions");
    writeParagraph(data.mode === "review"
      ? data.instructions || "Review each response and the feedback provided."
      : data.instructions || "Answer all questions. Check the mark value shown for each question.",
    { size: 10, lineGap: 5, after: 8 });
    sectionHeading("Questions");
    (data.questions || []).forEach((question, index) => {
      const optionLines = Array.isArray(question.options) ? question.options.flatMap((option, optionIndex) =>
        wrap(`${String.fromCharCode(65 + optionIndex)}. ${option}`, contentWidth - 18, 9).map((line) => `  ${line}`)) : [];
      const parsedPrompt = window.akademiAssessmentRendering?.parseQuestionTable(question.prompt, question.table)
        || { text: question.prompt || "", rows: [] };
      const promptLines = wrap(parsedPrompt.text, contentWidth - 18, 10);
      const estimate = 31 + (promptLines.length + optionLines.length) * 14 + (question.options ? 3 : 25);
      ensureSpace(estimate);
      pages[pages.length - 1].push(`0.98 0.99 0.98 rg ${margin} ${pageHeight - y - 24} ${contentWidth} 24 re f\n`);
      pages[pages.length - 1].push(text(`QUESTION ${index + 1}`, margin + 9, y + 5, 9, true, "0.10 0.31 0.20"));
      const marks = `${question.marks ?? ""} MARKS`;
      pages[pages.length - 1].push(text(marks, pageWidth - margin - marks.length * 5.2, y + 5, 8, true, "0.34 0.40 0.36"));
      y += 31;
      promptLines.forEach((line) => { pages[pages.length - 1].push(text(line, margin + 9, y, 10)); y += 14; });
      if (parsedPrompt.rows.length > 1) drawTable(parsedPrompt.rows);
      if (question.visual) drawVisual(question.visual);
      optionLines.forEach((line) => { pages[pages.length - 1].push(text(line, margin + 15, y, 9)); y += 13; });
      if (!question.options) {
        y += 2;
        pages[pages.length - 1].push(`0.80 0.84 0.81 RG 0.5 w ${margin + 12} ${pageHeight - y - 12} m ${pageWidth - margin - 12} ${pageHeight - y - 12} l S\n`);
        y += 18;
      }
      if (data.mode === "review" && question.review) {
        const review = question.review;
        const answerColor = review.isCorrect ? "0.09 0.42 0.23" : review.isIncorrect ? "0.68 0.13 0.10" : "0.16 0.22 0.18";
        writeParagraph(`Result: ${review.state || "Reviewed"}`, { size: 9, bold: true, color: answerColor, x: margin + 9, width: contentWidth - 18, after: 3 });
        writeParagraph(`Learner response: ${review.learnerAnswer || "No response"}`, { size: 9, color: answerColor, x: margin + 9, width: contentWidth - 18, after: 3 });
        if (review.correctAnswer) writeParagraph(`Correct answer: ${review.correctAnswer}`, { size: 9, color: "0.09 0.42 0.23", x: margin + 9, width: contentWidth - 18, after: 3 });
        if (review.expectedResponse) writeParagraph(`Expected response: ${review.expectedResponse}`, { size: 9, x: margin + 9, width: contentWidth - 18, after: 3 });
        if (review.teacherFeedback) writeParagraph(`Teacher feedback: ${review.teacherFeedback}`, { size: 9, x: margin + 9, width: contentWidth - 18, after: 3 });
      }
      y += 8;
    });

    if (data.mode === "combined" || data.mode === "guide") {
      pagesStart();
      sectionHeading("Teacher marking scheme | confidential");
      writeParagraph("Keep this section separate from the student question paper. Review the expected answers and mark allocations before use.", { size: 9, color: "0.34 0.40 0.36", after: 12 });
      (data.questions || []).forEach((question, index) => {
        const guide = data.markingGuide?.find?.((item) => Number(item.question_number) === index + 1) || data.markingGuide?.[index] || {};
        ensureSpace(55);
        writeParagraph(`Question ${index + 1} | ${question.marks ?? guide.marks ?? ""} marks`, { size: 10, bold: true, color: "0.10 0.31 0.20", after: 4 });
        if (Array.isArray(question.options)) {
          const correctIndex = Number(question.correct_option ?? 0);
          writeParagraph(`Correct option: ${String.fromCharCode(65 + correctIndex)}. ${question.options[correctIndex] || ""}`, { size: 9, x: margin + 8, width: contentWidth - 8, after: 3 });
        }
        writeParagraph(guide.expected_response || question.expected_answer || "Teacher to complete.", { size: 9, x: margin + 8, width: contentWidth - 8, lineGap: 4, after: 10 });
      });
      if (data.additionalNotes) {
        sectionHeading("Additional marking notes");
        writeParagraph(data.additionalNotes, { size: 9, lineGap: 4 });
      }
    }

    pages.forEach((commands, index) => {
      if (index > 0 && commands.length === 1 && commands[0] === " ") commands.pop();
      if (index > 0) {
        commands.push(text("AKADEMI  |  ASSESSMENT", margin, 22, 7, true, "0.20 0.39 0.29"));
        commands.push(`0.78 0.84 0.79 RG 0.6 w ${margin} ${pageHeight - 38} m ${pageWidth - margin} ${pageHeight - 38} l S\n`);
      }
      commands.push(`0.82 0.87 0.83 RG 0.7 w ${margin} 40 m ${pageWidth - margin} 40 l S\n`);
      commands.push(text(data.mode === "review" ? "Akademi | Student feedback copy" : "Akademi | Teacher review copy", margin, pageHeight - 30, 7, false, "0.40 0.46 0.41"));
      const pageLabel = `${index + 1} / ${pages.length}`;
      commands.push(text(pageLabel, pageWidth - margin - 40, pageHeight - 30, 7, false, "0.40 0.46 0.41"));
    });
    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    let logoObjectNumber = 0;
    if (coverLogo) {
      logoObjectNumber = objects.length + 1;
      objects.push(`<< /Type /XObject /Subtype /Image /Width ${coverLogo.width} /Height ${coverLogo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${coverLogo.hex.length + 2} >>\nstream\n${coverLogo.hex}>\nendstream`);
    }
    const refs = [];
    pages.forEach((commands) => {
      const stream = commands.join("");
      const pageNumber = objects.length + 1;
      const streamNumber = pageNumber + 1;
      refs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${logoObjectNumber ? ` /XObject << /Im1 ${logoObjectNumber} 0 R >>` : ""} >> /Contents ${streamNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${refs.join(" ")}] /Count ${refs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function download(data, format) {
    const exportData = Array.isArray(data.questions) && !Array.isArray(data.lines) && !Array.isArray(data.blocks)
      ? { ...data, blocks: assessmentBlocks(data) }
      : data;
    const blob = format === "docx" ? docxBlob(exportData) : pdfBlob(exportData);
    downloadBlob(blob, `${safeName(exportData.title)}.${format}`);
  }

  async function pdfLogo(administrator) {
    if (!administrator.logoUrl || administrator.logoPdf) return administrator;
    const logoUrl = new URL(administrator.logoUrl, window.location.href);
    if (logoUrl.origin !== window.location.origin || !["http:", "https:"].includes(logoUrl.protocol)) {
      throw new Error("The school logo must come from this workspace before it can be included in the PDF.");
    }
    const response = await fetch(logoUrl.href, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`The school logo could not be loaded for the PDF (HTTP ${response.status}).`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = 180;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("The school logo could not be prepared for the PDF.");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    bitmap.close();
    const encoded = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
    if (!encoded) throw new Error("The school logo could not be encoded for the PDF.");
    const bytes = atob(encoded);
    let hex = "";
    for (let index = 0; index < bytes.length; index++) hex += bytes.charCodeAt(index).toString(16).padStart(2, "0");
    return {
      ...administrator,
      logoPdf: { width: canvas.width, height: canvas.height, hex },
      logoDocxBase64: encoded
    };
  }

  async function downloadWithLogo(data, format) {
    const administrator = data.administrator || {};
    if (data.reportCard && administrator.logoUrl && !administrator.logoDocxBase64) {
      download({ ...data, administrator: await pdfLogo(administrator) }, format);
      return;
    }
    if (format !== "pdf" || !administrator.logoUrl || administrator.logoPdf) {
      download(data, format);
      return;
    }
    download({ ...data, administrator: await pdfLogo(administrator) }, format);
  }

  async function downloadDocumentWithLogo(doc, format) {
    if (format !== "pdf" || doc.type !== "assessment" || !doc.data?.administrator?.logoUrl) {
      downloadDocument(doc, format);
      return;
    }
    const administrator = await pdfLogo(doc.data.administrator);
    downloadDocument({ ...doc, data: { ...doc.data, administrator } }, format);
  }

  function downloadBlob(blob, filename) {
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function removeAssessmentAdminDetails(doc, body) {
    if (doc.type !== "assessment") return;
    body.querySelectorAll(".document-meta, .assessment-paper-details, .assessment-candidate-fields").forEach((node) => node.remove());
    body.querySelectorAll(".assessment-title-block .eyebrow, .assessment-title-block > p").forEach((node) => node.remove());
  }

  function documentLines(doc) {
    const parsed = new DOMParser().parseFromString(String(doc.html || ""), "text/html");
    const body = parsed.querySelector(".output-body") || parsed.body;
    body.querySelectorAll("script, style, noscript, button, .output-actions").forEach((node) => node.remove());
    removeAssessmentAdminDetails(doc, body);
    const lines = [];
    body.querySelectorAll(".meta-box").forEach((box) => {
      const label = box.querySelector("small")?.textContent.trim();
      const value = box.querySelector("strong")?.textContent.trim();
      if (label || value) lines.push({ text: `${label || "Details"}: ${value || ""}` });
    });
    body.querySelectorAll("h3, h4, h5, p, li, tr, .lesson-phase > div > strong").forEach((node) => {
      if (node.closest(".meta-box") || (node.closest("table") && node.tagName !== "TR")) return;
      const text = node.tagName === "TR"
        ? Array.from(node.querySelectorAll("th, td")).map((cell) => cell.textContent.trim()).filter(Boolean).join(" | ")
        : node.textContent.trim();
      if (!text) return;
      lines.push({
        text: node.tagName === "LI" ? `• ${text}` : text,
        ...(node.tagName.startsWith("H") || node.matches(".lesson-phase > div > strong") ? { style: "Heading1" } : {})
      });
    });
    return lines.length ? lines : [{ text: body.textContent.trim() || "No document content." }];
  }

  function documentBlocks(doc) {
    const parsed = new DOMParser().parseFromString(String(doc.html || ""), "text/html");
    const body = parsed.querySelector(".output-body") || parsed.body;
    body.querySelectorAll("script, style, noscript, button, .output-actions").forEach((node) => node.remove());
    removeAssessmentAdminDetails(doc, body);
    const blocks = [];
    body.querySelectorAll(".meta-box").forEach((box) => {
      const label = box.querySelector("small")?.textContent.trim();
      const value = box.querySelector("strong")?.textContent.trim();
      if (label || value) blocks.push({ text: `${label || "Details"}: ${value || ""}` });
    });
    body.querySelectorAll("h3, h4, h5, p, li, table, .lesson-phase > div > strong").forEach((node) => {
      if (node.closest(".meta-box") || (node.closest("table") && node.tagName !== "TABLE")) return;
      if (node.tagName === "TABLE") {
        const rows = Array.from(node.querySelectorAll("tr")).map((row) =>
          Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent.replace(/\s+/g, " ").trim())
        );
        if (rows.length) blocks.push({ type: "table", rows });
        return;
      }
      const text = node.textContent.trim();
      if (text) {
        blocks.push({
          text: node.tagName === "LI" ? `• ${text}` : text,
          ...(node.tagName.startsWith("H") || node.matches(".lesson-phase > div > strong") ? { style: "Heading1" } : {})
        });
      }
    });
    return blocks.length ? blocks : [{ text: body.textContent.trim() || "No document content." }];
  }

  function legacyTextPptxBlob(doc) {
    const lines = [{ text: doc.title || "Presentation outline", style: "Title" }, ...documentLines(doc)];
    const slideGroups = [];
    let current = [];
    lines.forEach((line) => {
      if (line.style === "Heading1" && current.length >= 5) {
        slideGroups.push(current);
        current = [];
      }
      current.push(line);
      if (current.length >= 8) {
        slideGroups.push(current);
        current = [];
      }
    });
    if (current.length) slideGroups.push(current);
    const slides = slideGroups.length ? slideGroups : [[{ text: doc.title }]];
    const esc = (value) => xmlEscape(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
    const shape = (id, name, x, y, cx, cy, text, size, bold = false) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-GH" sz="${size}"${bold ? ' b="1"' : ""}/><a:t>${esc(text)}</a:t></a:r><a:endParaRPr lang="en-GH"/></a:p></p:txBody></p:sp>`;
    const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Akademi"><a:themeElements><a:clrScheme name="Akademi"><a:dk1><a:srgbClr val="18352B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="263238"/></a:dk2><a:lt2><a:srgbClr val="F4F7F5"/></a:lt2><a:accent1><a:srgbClr val="2D6A4F"/></a:accent1><a:accent2><a:srgbClr val="D4A373"/></a:accent2><a:accent3><a:srgbClr val="52796F"/></a:accent3><a:accent4><a:srgbClr val="84A98C"/></a:accent4><a:accent5><a:srgbClr val="E9C46A"/></a:accent5><a:accent6><a:srgbClr val="E76F51"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Akademi"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Akademi"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill><a:noFill/></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050"><a:noFill/><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill><a:noFill/></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
    const entries = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'],
      ["ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
      ["ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("")}</Relationships>`],
      ["ppt/slideMasters/slideMaster1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>'],
      ["ppt/slideMasters/_rels/slideMaster1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'],
      ["ppt/slideLayouts/slideLayout1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'],
      ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'],
      ["ppt/theme/theme1.xml", themeXml]
    ];
    slides.forEach((items, index) => {
      const slideContent = items.map((item, itemIndex) => shape(itemIndex + 2, `Text ${itemIndex + 1}`, 457200, 350000 + itemIndex * 620000, 8229600, 560000, item.text, item.style === "Title" ? 3200 : item.style ? 2200 : 1700, Boolean(item.style))).join("");
      entries.push(
        [`ppt/slides/slide${index + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${slideContent}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`],
        [`ppt/slides/_rels/slide${index + 1}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>']
      );
    });
    return zipBlob(entries, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  }

  function presentationPdfBlob(doc) {
    const sourceData = doc.data || {};
    const data = {
      ...sourceData,
      template: sourceData.template || sourceData.presentation_template || "lesson",
      visual_theme: sourceData.visual_theme || sourceData.presentation_visual_theme || "modern"
    };
    const templateTag = ({
      lesson: "CLEAR LESSON SEQUENCE",
      inquiry: "INQUIRY",
      worked: "WORKED EXAMPLES",
      discussion: "DISCUSSION",
      project: "PROJECT",
      revision: "REVISION",
      flipped: "FLIPPED"
    })[data.template || data.presentation_template] || "CLEAR LESSON SEQUENCE";
    const sourceSlides = Array.isArray(data.slides) && data.slides.length
      ? data.slides
      : documentLines(doc).filter((line) => line.text).map((line) => ({
        title: line.style === "Heading1" ? line.text : "",
        key_points: line.style === "Heading1" ? [] : [line.text]
      }));
    const slides = sourceSlides.map((slide) => {
      if (slide.visual && typeof slide.visual === "object") return slide;
      const items = (Array.isArray(slide.key_points) ? slide.key_points : [])
        .filter((point) => typeof point === "string" && point.trim()).slice(0, 4);
      return { ...slide, visual: { type: "cards", title: "Key ideas", items: items.length ? items : [String(slide.activity || slide.title || "Explore the lesson idea.")] } };
    }).map((slide) => slide.visual.type === "cards" && !slide.visual.items?.length ? ({
      ...slide,
      visual: { ...slide.visual, items: [String(slide.activity || slide.title || "Explore the lesson idea.")] }
    }) : slide);
    const themes = {
      modern: ["F5F7F3", "FFFFFF", "20312A", "66756D", "1F624B", "D0A64A", "E5EFE8"],
      editorial: ["F7F5F0", "FFFFFF", "202B3C", "677386", "243C5A", "B48A42", "E9EDF3"],
      vibrant: ["FFF8F1", "FFFFFF", "33254A", "71647E", "7041B8", "F27652", "F2E9FF"],
      data: ["102033", "1B3047", "F4F7FB", "B7C7D6", "4AC2AE", "F0B95C", "263E54"],
      minimal: ["FFFFFF", "FFFFFF", "202A26", "69746E", "294B3C", "9BA99F", "F1F4F1"]
    };
    const [background, surface, ink, muted, accent, secondary, pale] = themes[data.visual_theme] || themes.modern;
    const W = 960, H = 540;
    const scale = W / 9144000;
    const pages = [];
    const plain = (value) => String(value ?? "").replace(/₵/g, "GHS ").replace(/[·•]/g, " - ")
      .replace(/[–—]/g, "-").replace(/[’‘]/g, "'").replace(/[“”]/g, '"')
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "");
    const escaped = (value) => plain(value).replace(/[\\()]/g, "\\$&");
    const rgb = (color) => {
      const hex = String(color || "FFFFFF").replace(/^#/, "");
      const normalized = /^[0-9a-f]{6}$/i.test(hex) ? hex : "FFFFFF";
      return [0, 2, 4].map((offset) => (parseInt(normalized.slice(offset, offset + 2), 16) / 255).toFixed(3)).join(" ");
    };
    const wrap = (value, maxChars) => {
      const words = plain(value).split(/\s+/).filter(Boolean);
      const lines = [];
      let current = "";
      words.forEach((word) => {
        if (current && `${current} ${word}`.length > maxChars) {
          lines.push(current);
          current = word;
        } else current = current ? `${current} ${word}` : word;
      });
      if (current) lines.push(current);
      return lines.length ? lines : [""];
    };
    slides.forEach((slide, slideIndex) => {
      const commands = [];
      const rect = (x, top, width, height, fill, stroke = null) => {
        commands.push(`${rgb(fill)} rg ${x} ${H - top - height} ${width} ${height} re f\n`);
        if (stroke) commands.push(`${rgb(stroke)} RG 0.8 w ${x} ${H - top - height} ${width} ${height} re S\n`);
      };
      const roundedRect = (x, top, width, height, fill, stroke = null, radius = 8) => {
        const bottom = H - top - height;
        const r = Math.min(radius, width / 2, height / 2);
        const k = r * 0.55228475;
        const path = `${x + r} ${bottom} m ${x + width - r} ${bottom} l ${x + width - r + k} ${bottom} ${x + width} ${bottom + r - k} ${x + width} ${bottom + r} c ${x + width} ${bottom + height - r} l ${x + width} ${bottom + height - r + k} ${x + width - r + k} ${bottom + height} ${x + width - r} ${bottom + height} c ${x + r} ${bottom + height} l ${x + r - k} ${bottom + height} ${x} ${bottom + height - r + k} ${x} ${bottom + height - r} c ${x} ${bottom + r} l ${x} ${bottom + r - k} ${x + r - k} ${bottom} ${x + r} ${bottom} c h`;
        commands.push(`${rgb(fill)} rg ${path} f\n`);
        if (stroke) commands.push(`${rgb(stroke)} RG 0.8 w ${path} S\n`);
      };
      const circle = (cx, topCy, radius, fill) => {
        const cy = H - topCy;
        const k = radius * 0.55228475;
        commands.push(`${rgb(fill)} rg ${cx + radius} ${cy} m ${cx + radius} ${cy + k} ${cx + k} ${cy + radius} ${cx} ${cy + radius} c ${cx - k} ${cy + radius} ${cx - radius} ${cy + k} ${cx - radius} ${cy} c ${cx - radius} ${cy - k} ${cx - k} ${cy - radius} ${cx} ${cy - radius} c ${cx + k} ${cy - radius} ${cx + radius} ${cy - k} ${cx + radius} ${cy} c f\n`);
      };
      const line = (x1, y1, x2, y2, color, width = 1) => {
        commands.push(`${rgb(color)} RG ${width} w ${x1} ${H - y1} m ${x2} ${H - y2} l S\n`);
      };
      const text = (value, x, top, size, color = ink, bold = false, maxWidth = null, align = "left") => {
        const maxChars = maxWidth ? Math.max(6, Math.floor(maxWidth / (size * 0.53))) : 1000;
        const lines = wrap(value, maxChars);
        lines.forEach((item, index) => {
          const estimatedWidth = item.length * size * 0.51;
          const drawX = align === "center" && maxWidth ? x + Math.max(0, (maxWidth - estimatedWidth) / 2) : align === "right" && maxWidth ? x + Math.max(0, maxWidth - estimatedWidth) : x;
          commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${drawX.toFixed(2)} ${(H - top - size - index * size * 1.28).toFixed(2)} Tm (${escaped(item)}) Tj ET\n`);
        });
        return lines.length * size * 1.28;
      };
      rect(0, 0, W, H, background);
      rect(0, 0, W, 100000 * scale, accent);
      text(`${data.subject || "CLASSROOM PRESENTATION"}  ·  ${data.year || data.year_group || ""}`.toLocaleUpperCase(), 520000 * scale, 230000 * scale, 10.5, accent, true, 5900000 * scale);
      text(templateTag, 6700000 * scale, 230000 * scale, 8.5, accent, true, 1300000 * scale, "right");
      text(String(slideIndex + 1).padStart(2, "0"), 8240000 * scale, 230000 * scale, 11, muted, true, 340000 * scale, "right");
      text(slide.title || "Lesson focus", 520000 * scale, 620000 * scale, 29, ink, true, 8120000 * scale);
      rect(520000 * scale, 1370000 * scale, 1000000 * scale, 50000 * scale, secondary);

      const left = { x: 520000 * scale, y: 1600000 * scale, w: 3940000 * scale, h: 2790000 * scale };
      const right = { x: 4760000 * scale, y: 1600000 * scale, w: 3760000 * scale, h: 2790000 * scale };
      roundedRect(left.x, left.y, left.w, left.h, surface, pale);
      roundedRect(right.x, right.y, right.w, right.h, surface, pale);
      text("KEY IDEAS", left.x + 150000 * scale, left.y + 100000 * scale, 10, accent, true);
      const keyPoints = (Array.isArray(slide.key_points) ? slide.key_points : [])
        .filter((point) => typeof point === "string" && point.trim()).slice(0, 5);
      const displayPoints = keyPoints.length ? keyPoints : [String(slide.activity || "Introduce the central idea and connect it to learners' prior knowledge.")];
      const pointHeight = Math.min(510000 * scale, 2100000 * scale / displayPoints.length);
      displayPoints.forEach((point, index) => {
        const top = left.y + 460000 * scale + index * pointHeight;
        circle(left.x + 227500 * scale, top + 127500 * scale, 47500 * scale, secondary);
        text(point, left.x + 350000 * scale, top, 14.2, ink, false, left.w - 520000 * scale);
      });

      const visual = slide.visual || {};
      text(visual.title || "TEACHING VISUAL", right.x + 140000 * scale, right.y + 90000 * scale, 14.5, accent, true, right.w - 280000 * scale);
      const plot = { x: right.x + 190000 * scale, y: right.y + 430000 * scale, w: right.w - 380000 * scale, h: right.h - 600000 * scale };
      const visualType = String(visual.type || "").toLowerCase();
      if (visualType === "table") {
        const headers = Array.isArray(visual.headers) ? visual.headers.map(String).slice(0, 5) : [];
        const rows = Array.isArray(visual.rows) ? visual.rows.filter(Array.isArray).slice(0, 6) : [];
        const tableRows = [headers, ...rows].filter((row) => row.length);
        const columns = Math.max(1, headers.length, ...tableRows.map((row) => row.length));
        const cellW = plot.w / columns, cellH = plot.h / Math.max(tableRows.length, 1);
        tableRows.forEach((row, rowIndex) => {
          for (let column = 0; column < columns; column++) {
            const x = plot.x + column * cellW, y = plot.y + rowIndex * cellH;
            const headerRow = rowIndex === 0 && headers.length > 0;
            rect(x, y, cellW, cellH, headerRow ? accent : rowIndex % 2 ? pale : surface, background);
            text(row[column] || "", x + 45000 * scale, y + 45000 * scale, headerRow ? 10 : 9, headerRow ? "FFFFFF" : ink, headerRow, cellW - 90000 * scale);
          }
        });
      } else if (visualType === "bar_chart" || visualType === "chart") {
        const labels = Array.isArray(visual.labels) ? visual.labels.map(String).slice(0, 8) : [];
        const values = Array.isArray(visual.values) ? visual.values.slice(0, labels.length).map(Number) : [];
        if (labels.length && labels.length === values.length && values.every(Number.isFinite)) {
          const max = Math.max(0, ...values), min = Math.min(0, ...values), range = Math.max(1, max - min);
          const chartTop = plot.y + 120000 * scale;
          const chartBottom = plot.y + plot.h - 390000 * scale;
          const chartHeight = chartBottom - chartTop;
          const chartWidth = plot.w - 420000 * scale;
          const slot = chartWidth / labels.length;
          const zeroY = chartBottom - (0 - min) / range * chartHeight;
          for (let tick = 0; tick <= 4; tick++) {
            const y = chartBottom - tick * chartHeight / 4;
            line(plot.x + 350000 * scale, y, plot.x + plot.w - 20000 * scale, y, pale, 0.7);
            text(String(Math.round(min + range * tick / 4)), plot.x, y - 5, 8, muted, false, 300000 * scale, "right");
          }
          values.forEach((value, index) => {
            const barH = Math.max(30000 * scale, Math.abs(value) / range * chartHeight);
            const barW = Math.min(430000 * scale, slot * 0.58);
            const x = plot.x + 350000 * scale + index * slot + (slot - barW) / 2;
            const y = value >= 0 ? zeroY - barH : zeroY;
            roundedRect(x, y, barW, barH, index % 2 ? secondary : accent, null, 4);
            text(String(value), x - 70000 * scale, y - 170000 * scale, 8.5, ink, true, barW + 140000 * scale, "center");
            text(labels[index], plot.x + 350000 * scale + index * slot, chartBottom + 80000 * scale, 7.8, muted, false, slot, "center");
          });
          if (visual.value_label) text(visual.value_label, plot.x, plot.y + plot.h - 10, 7, muted, false, plot.w, "right");
        } else text("Chart data unavailable", plot.x + 15, plot.y + 80, 12, muted, false, plot.w - 30, "center");
      } else if (visualType === "graph" || visualType === "line_chart") {
        const series = visualType === "graph"
          ? [{ name: "", points: visual.points }]
          : (Array.isArray(visual.series) ? visual.series.slice(0, 5).map((item) => ({
            name: String(item.name || ""),
            points: Array.isArray(item.values) ? item.values.map((value, index) => [index, value]) : []
          })) : []);
        const valid = series.map((item) => ({
          ...item,
          points: (Array.isArray(item.points) ? item.points : [])
            .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [])
            .filter((point) => point.length === 2 && point.every(Number.isFinite)).slice(0, 20)
        })).filter((item) => item.points.length > 1);
        const all = valid.flatMap((item) => item.points);
        if (all.length > 1) {
          const minX = Number.isFinite(Number(visual.x_min)) ? Number(visual.x_min) : Math.min(...all.map((point) => point[0]));
          const maxX = Number.isFinite(Number(visual.x_max)) ? Number(visual.x_max) : Math.max(...all.map((point) => point[0]));
          const minY = Number.isFinite(Number(visual.y_min)) ? Number(visual.y_min) : Math.min(...all.map((point) => point[1]));
          const maxY = Number.isFinite(Number(visual.y_max)) ? Number(visual.y_max) : Math.max(...all.map((point) => point[1]));
          const rangeX = Math.max(1, maxX - minX), rangeY = Math.max(1, maxY - minY);
          const graph = { x: plot.x + 360000 * scale, y: plot.y + 120000 * scale, w: plot.w - 440000 * scale, h: plot.h - 440000 * scale };
          for (let tick = 0; tick <= 4; tick++) line(graph.x, graph.y + graph.h * tick / 4, graph.x + graph.w, graph.y + graph.h * tick / 4, pale, 0.7);
          const colors = [accent, secondary, "52796F", "E76F51"];
          valid.forEach((item, seriesIndex) => {
            const points = item.points.map(([x, y]) => [
              graph.x + (x - minX) / rangeX * graph.w,
              graph.y + graph.h - (y - minY) / rangeY * graph.h
            ]);
            points.slice(1).forEach((point, index) => line(points[index][0], points[index][1], point[0], point[1], colors[seriesIndex % colors.length], 2));
            points.forEach(([x, y]) => circle(x, y, 60000 * scale, colors[seriesIndex % colors.length]));
            if (item.name) text(item.name, graph.x + seriesIndex * 90, plot.y + 2, 7, colors[seriesIndex % colors.length], true);
          });
          text(visual.x_label || "x", graph.x, graph.y + graph.h + 15, 8, muted, false, graph.w, "center");
          text(visual.y_label || "y", plot.x, graph.y - 14, 8, muted);
        } else text("Add plotted points to illustrate this relationship.", plot.x + 10, plot.y + 80, 11, muted, false, plot.w - 20, "center");
      } else {
        const items = (Array.isArray(visual.steps) ? visual.steps : Array.isArray(visual.items) ? visual.items : [])
          .map((item) => typeof item === "string" ? item : String(item?.label || item?.title || item?.details || ""))
          .filter(Boolean).slice(0, 5);
        if (items.length) {
          const vertical = items.length > 3;
          const gap = 8;
          const cardW = vertical ? plot.w : (plot.w - gap * (items.length - 1)) / items.length;
          const cardH = vertical ? (plot.h - gap * (items.length - 1)) / items.length : Math.min(100, plot.h - 20);
          items.forEach((item, index) => {
            const x = vertical ? plot.x : plot.x + index * (cardW + gap);
            const y = vertical ? plot.y + index * (cardH + gap) : plot.y + (plot.h - cardH) / 2;
            roundedRect(x, y, cardW, cardH, index % 2 ? pale : background, pale);
            text(String(index + 1).padStart(2, "0"), x + 8, y + 8, 8, accent, true);
            text(item, x + 8, y + 25, 9, ink, true, cardW - 16);
            if (index && !vertical) text(">", x - gap, y + cardH / 2 - 4, 10, secondary, true, gap, "center");
          });
        } else {
          const fallbackText = slide.visual_suggestion || slide.activity || slide.key_points?.[0] || "Add a labelled diagram or example to support the lesson.";
          roundedRect(plot.x + 50000 * scale, plot.y + 250000 * scale, plot.w - 100000 * scale, plot.h - 350000 * scale, pale, pale);
          text(fallbackText, plot.x + 230000 * scale, plot.y + 400000 * scale, 13, ink, false, plot.w - 460000 * scale, "center");
        }
      }
      if (slide.activity) {
        line(520000 * scale, 4580000 * scale, 8620000 * scale, 4580000 * scale, pale, 0.8);
        text(`TRY IT  ·  ${slide.activity}`, 520000 * scale, 4660000 * scale, 10, muted, false, 8120000 * scale);
      }
      pages.push(commands.join(""));
    });
    const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
    const pageRefs = [];
    pages.forEach((stream) => {
      const pageNumber = objects.length + 1;
      const contentNumber = pageNumber + 1;
      pageRefs.push(`${pageNumber} 0 R`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
      );
    });
    objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageRefs.length} >>`;
    let output = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(output.length);
      output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { output += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new Blob([output], { type: "application/pdf" });
  }

  function pptxBlob(doc) {
    const sourceData = doc.data || {};
    const data = {
      ...sourceData,
      template: sourceData.template || sourceData.presentation_template || "lesson",
      visual_theme: sourceData.visual_theme || sourceData.presentation_visual_theme || "modern"
    };
    const templateTag = ({
      lesson: "CLEAR LESSON SEQUENCE",
      inquiry: "INQUIRY",
      worked: "WORKED EXAMPLES",
      discussion: "DISCUSSION",
      project: "PROJECT",
      revision: "REVISION",
      flipped: "FLIPPED"
    })[data.template || data.presentation_template] || "CLEAR LESSON SEQUENCE";
    const sourceSlides = Array.isArray(data.slides) && data.slides.length
      ? data.slides
      : documentLines(doc).filter((line) => line.text).map((line) => ({ title: line.style === "Heading1" ? line.text : "", key_points: line.style === "Heading1" ? [] : [line.text] }));
    const slides = sourceSlides.map((slide) => slide.visual && typeof slide.visual === "object" ? slide : ({
      ...slide,
      visual: {
        type: "cards",
        title: "Key ideas",
        items: (Array.isArray(slide.key_points) ? slide.key_points : [])
          .filter((point) => typeof point === "string" && point.trim()).slice(0, 4)
      }
    })).map((slide) => slide.visual.type === "cards" && !slide.visual.items?.length ? ({
      ...slide,
      visual: {
        ...slide.visual,
        items: [String(slide.activity || slide.title || "Explore the lesson idea.")]
      }
    }) : slide);
    const themes = {
      modern: ["F5F7F3", "FFFFFF", "20312A", "66756D", "1F624B", "D0A64A", "E5EFE8"],
      editorial: ["F7F5F0", "FFFFFF", "202B3C", "677386", "243C5A", "B48A42", "E9EDF3"],
      vibrant: ["FFF8F1", "FFFFFF", "33254A", "71647E", "7041B8", "F27652", "F2E9FF"],
      data: ["102033", "1B3047", "F4F7FB", "B7C7D6", "4AC2AE", "F0B95C", "263E54"],
      minimal: ["FFFFFF", "FFFFFF", "202A26", "69746E", "294B3C", "9BA99F", "F1F4F1"]
    };
    const [background, surface, ink, muted, accent, secondary, pale] = themes[data.visual_theme] || themes.modern;
    const esc = (value) => xmlEscape(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
    const W = 9144000;
    const H = 5143500;
    const themeXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Akademi"><a:themeElements><a:clrScheme name="Akademi"><a:dk1><a:srgbClr val="18352B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="263238"/></a:dk2><a:lt2><a:srgbClr val="F4F7F5"/></a:lt2><a:accent1><a:srgbClr val="2D6A4F"/></a:accent1><a:accent2><a:srgbClr val="D4A373"/></a:accent2><a:accent3><a:srgbClr val="52796F"/></a:accent3><a:accent4><a:srgbClr val="84A98C"/></a:accent4><a:accent5><a:srgbClr val="E9C46A"/></a:accent5><a:accent6><a:srgbClr val="E76F51"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Akademi"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Akademi"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
    const entries = [
      ["[Content_Types].xml", ""],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'],
      ["ppt/presentation.xml", ""],
      ["ppt/_rels/presentation.xml.rels", ""],
      ["ppt/slideMasters/slideMaster1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" tx1="dk1" tx2="dk2" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>'],
      ["ppt/slideMasters/_rels/slideMaster1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'],
      ["ppt/slideLayouts/slideLayout1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'],
      ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideMasters/slideMaster1.xml"/></Relationships>'],
      ["ppt/theme/theme1.xml", themeXml]
    ];
    const shape = (id, name, x, y, cx, cy, text = "", options = {}) => {
      const fill = options.fill ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>` : "<a:noFill/>";
      const outline = options.outline ? `<a:ln w="12000"><a:solidFill><a:srgbClr val="${options.outline}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
      const paragraphs = String(text).split("\n").map((line) =>
        `<a:p><a:pPr algn="${options.align || "l"}"/><a:r><a:rPr lang="en-GH" sz="${options.size || 1200}"${options.bold ? ' b="1"' : ""}><a:solidFill><a:srgbClr val="${options.color || ink}"/></a:solidFill><a:latin typeface="${options.font || "Aptos"}"/></a:rPr><a:t xml:space="preserve">${esc(line)}</a:t></a:r><a:endParaRPr lang="en-GH"/></a:p>`
      ).join("");
      const textBody = text === "" ? "" : `<p:txBody><a:bodyPr wrap="square" lIns="${options.padding ?? 90000}" rIns="${options.padding ?? 90000}" tIns="${options.padding ?? 65000}" bIns="${options.padding ?? 65000}" anchor="${options.anchor || "ctr"}"><a:normAutofit fontScale="85000" lnSpcReduction="15000"/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody>`;
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.max(1, Math.round(cx))}" cy="${Math.max(1, Math.round(cy))}"/></a:xfrm><a:prstGeom prst="${options.geometry || "rect"}"><a:avLst/></a:prstGeom>${fill}${outline}</p:spPr>${textBody}</p:sp>`;
    };
    const connector = (id, name, x1, y1, x2, y2, color = accent, width = 20000) => {
      const flipH = x2 < x1 ? ' flipH="1"' : "";
      const flipV = y2 < y1 ? ' flipV="1"' : "";
      return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipH}${flipV}><a:off x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}"/><a:ext cx="${Math.max(1, Math.abs(x2 - x1))}" cy="${Math.max(1, Math.abs(y2 - y1))}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${width}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
    };
    const addSlide = (slide, slideIndex) => {
      const shapes = [];
      let id = 2;
      const add = (...args) => shapes.push(shape(id++, ...args));
      const line = (...args) => shapes.push(connector(id++, ...args));
      add("Background", 0, 0, W, H, "", { fill: background });
      add("Top accent", 0, 0, W, 100000, "", { fill: accent });
      add("Course", 520000, 230000, 5900000, 270000, `${String(data.subject || "CLASSROOM PRESENTATION").toLocaleUpperCase()}  ·  ${String(data.year || data.year_group || "").toLocaleUpperCase()}`, { size: 1050, bold: true, color: accent });
      add("Teaching structure", 6700000, 230000, 1300000, 270000, templateTag, { size: 850, bold: true, color: accent, align: "r" });
      add("Slide number", 8240000, 230000, 340000, 270000, String(slideIndex + 1).padStart(2, "0"), { size: 1100, bold: true, color: muted, align: "r" });
      add("Title", 520000, 620000, 8120000, 690000, String(slide.title || "Lesson focus"), { size: 2900, bold: true, color: ink, font: data.visual_theme === "editorial" ? "Georgia" : "Aptos Display", padding: 0 });
      add("Title underline", 520000, 1370000, 1000000, 50000, "", { fill: secondary });

      const leftX = 520000, leftY = 1600000, leftW = 3940000, panelH = 2790000;
      const rightX = 4760000, rightY = 1600000, rightW = 3760000;
      add("Key points panel", leftX, leftY, leftW, panelH, "", { fill: surface, geometry: "roundRect", outline: pale });
      add("Key ideas label", leftX + 150000, leftY + 100000, leftW - 300000, 240000, "KEY IDEAS", { size: 1000, bold: true, color: accent });
      const keyPoints = (Array.isArray(slide.key_points) ? slide.key_points : []).filter((point) => typeof point === "string").slice(0, 5);
      const displayPoints = keyPoints.length ? keyPoints : [String(slide.activity || "Introduce the central idea and connect it to learners' prior knowledge.")];
      const pointGap = Math.min(510000, Math.floor(2100000 / displayPoints.length));
      displayPoints.forEach((point, pointIndex) => {
        const y = leftY + 460000 + pointIndex * pointGap;
        add(`Point marker ${pointIndex + 1}`, leftX + 180000, y + 80000, 95000, 95000, "", { fill: secondary, geometry: "ellipse" });
        add(`Key point ${pointIndex + 1}`, leftX + 350000, y, leftW - 520000, pointGap - 30000, point, { size: 1420, color: ink, anchor: "t", padding: 18000 });
      });

      add("Visual panel", rightX, rightY, rightW, panelH, "", { fill: surface, geometry: "roundRect", outline: pale });
      const visual = slide.visual && typeof slide.visual === "object" ? slide.visual : null;
      add("Visual title", rightX + 140000, rightY + 90000, rightW - 280000, 290000, String(visual?.title || "TEACHING VISUAL"), { size: 1450, bold: true, color: accent });
      const plotX = rightX + 190000, plotY = rightY + 430000, plotW = rightW - 380000, plotH = panelH - 600000;
      const visualType = String(visual?.type || "").toLowerCase();

      if (visualType === "table") {
        const headers = Array.isArray(visual.headers) ? visual.headers.map(String).slice(0, 5) : [];
        const rows = Array.isArray(visual.rows) ? visual.rows.filter(Array.isArray).slice(0, 6) : [];
        const tableRows = [headers, ...rows].filter((row) => row.length);
        const columns = Math.max(1, headers.length, ...tableRows.map((row) => row.length));
        const cellW = Math.floor(plotW / columns), cellH = Math.floor(plotH / Math.max(tableRows.length, 1));
        tableRows.forEach((row, r) => row.slice(0, columns).forEach((cell, c) => {
          add(`Table cell ${r}-${c}`, plotX + c * cellW, plotY + r * cellH, cellW, cellH, String(cell), {
            size: r === 0 && headers.length ? 1000 : 900, bold: r === 0 && headers.length,
            color: r === 0 && headers.length ? "FFFFFF" : ink,
            fill: r === 0 && headers.length ? accent : r % 2 ? pale : surface,
            outline: background, padding: 45000
          });
        }));
      } else if (visualType === "bar_chart" || visualType === "chart") {
        const labels = Array.isArray(visual.labels) ? visual.labels.map(String).slice(0, 8) : [];
        const values = Array.isArray(visual.values) ? visual.values.slice(0, labels.length).map(Number) : [];
        if (labels.length && values.length === labels.length && values.every(Number.isFinite)) {
          const max = Math.max(0, ...values), min = Math.min(0, ...values), range = Math.max(1, max - min);
          const top = plotY + 120000, bottom = plotY + plotH - 390000, chartH = bottom - top;
          const chartW = plotW - 420000, slot = chartW / labels.length;
          for (let tick = 0; tick <= 4; tick++) {
            const y = bottom - tick * chartH / 4;
            line(`Chart grid ${tick}`, plotX + 350000, y, plotX + plotW - 20000, y, pale, 9000);
            add(`Chart tick ${tick}`, plotX, y - 50000, 300000, 100000, String(Math.round(min + range * tick / 4)), { size: 800, color: muted, align: "r" });
          }
          const zeroY = bottom - (0 - min) / range * chartH;
          values.forEach((value, i) => {
            const barH = Math.max(30000, Math.abs(value) / range * chartH);
            const barW = Math.min(430000, slot * 0.58);
            const x = plotX + 350000 + i * slot + (slot - barW) / 2;
            const y = value >= 0 ? zeroY - barH : zeroY;
            add(`Bar ${i + 1}`, x, y, barW, barH, "", { fill: i % 2 ? secondary : accent, geometry: "roundRect" });
            add(`Bar value ${i + 1}`, x - 70000, y - 170000, barW + 140000, 140000, String(value), { size: 850, bold: true, color: ink, align: "ctr" });
            add(`Bar label ${i + 1}`, plotX + 350000 + i * slot, bottom + 80000, slot, 230000, labels[i], { size: 780, color: muted, align: "ctr", anchor: "t" });
          });
          if (visual.value_label) add("Value unit", plotX, plotY + plotH - 220000, plotW, 120000, String(visual.value_label), { size: 800, color: muted, align: "r" });
        } else add("Chart data guidance", plotX, plotY + 500000, plotW, 650000, "Add named categories and values to draw a chart.", { size: 1250, color: muted, align: "ctr" });
      } else if (visualType === "graph" || visualType === "line_chart") {
        const graphSeries = visualType === "graph"
          ? [{ name: "", points: visual.points }]
          : (Array.isArray(visual.series) ? visual.series.slice(0, 5).map((series) => ({
            name: String(series.name || ""),
            points: Array.isArray(series.values) ? series.values.slice(0, 20).map((value, i) => [i, value]) : []
          })) : []);
        const validSeries = graphSeries.map((series) => ({
          ...series,
          points: (Array.isArray(series.points) ? series.points : [])
            .map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [])
            .filter((point) => point.length === 2 && point.every(Number.isFinite)).slice(0, 20)
        })).filter((series) => series.points.length > 1);
        const allPoints = validSeries.flatMap((series) => series.points);
        if (allPoints.length > 1) {
          const xs = allPoints.map((point) => point[0]), ys = allPoints.map((point) => point[1]);
          const minX = Number.isFinite(Number(visual.x_min)) ? Number(visual.x_min) : Math.min(...xs);
          const maxX = Number.isFinite(Number(visual.x_max)) ? Number(visual.x_max) : Math.max(...xs);
          const minY = Number.isFinite(Number(visual.y_min)) ? Number(visual.y_min) : Math.min(...ys);
          const maxY = Number.isFinite(Number(visual.y_max)) ? Number(visual.y_max) : Math.max(...ys);
          const xRange = Math.max(1, maxX - minX), yRange = Math.max(1, maxY - minY);
          const gx = plotX + 360000, gy = plotY + 120000, gw = plotW - 440000, gh = plotH - 440000;
          for (let tick = 0; tick <= 4; tick++) line(`Graph grid ${tick}`, gx, gy + gh * tick / 4, gx + gw, gy + gh * tick / 4, pale, 9000);
          const graphColors = [accent, secondary, "52796F", "E76F51", "5271A2"];
          validSeries.forEach((series, seriesIndex) => {
            const color = graphColors[seriesIndex % graphColors.length];
            const plotted = series.points.map(([x, y]) => [gx + (x - minX) / xRange * gw, gy + gh - (y - minY) / yRange * gh]);
            plotted.slice(1).forEach((point, i) => line(`Graph series ${seriesIndex + 1} segment ${i + 1}`, plotted[i][0], plotted[i][1], point[0], point[1], color, 30000));
            plotted.forEach(([x, y], i) => add(`Graph series ${seriesIndex + 1} point ${i + 1}`, x - 60000, y - 60000, 120000, 120000, "", { fill: color, geometry: "ellipse" }));
            if (series.name) {
              const legendX = plotX + 350000 + (seriesIndex % 3) * 930000;
              const legendY = plotY + 30000 + Math.floor(seriesIndex / 3) * 140000;
              add(`Graph legend swatch ${seriesIndex + 1}`, legendX, legendY + 35000, 70000, 35000, "", { fill: color });
              add(`Graph legend label ${seriesIndex + 1}`, legendX + 95000, legendY, 780000, 110000, series.name, { size: 750, color: muted, padding: 0 });
            }
          });
          add("Graph x axis", gx, gy + gh + 100000, gw, 190000, String(visual.x_label || "x"), { size: 850, color: muted, align: "ctr" });
          add("Graph y axis", plotX, gy + 300000, 300000, 180000, String(visual.y_label || "y"), { size: 850, color: muted, align: "ctr" });
        } else add("Graph data guidance", plotX, plotY + 500000, plotW, 650000, "Add coordinate pairs or series values to plot a graph.", { size: 1250, color: muted, align: "ctr" });
      } else if (["process", "timeline", "cards", "comparison"].includes(visualType)) {
        const items = (visual.steps || visual.items || []).map((item) => typeof item === "string" ? item : String(item.label || item.title || item.details || "")).filter(Boolean).slice(0, 5);
        const vertical = items.length > 3;
        const cardW = vertical ? plotW - 100000 : Math.floor((plotW - Math.max(0, items.length - 1) * 80000) / Math.max(1, items.length));
        const cardH = vertical ? Math.floor((plotH - Math.max(0, items.length - 1) * 60000) / Math.max(1, items.length)) : Math.min(1000000, plotH - 120000);
        items.forEach((item, i) => {
          const x = vertical ? plotX + 50000 : plotX + i * (cardW + 80000);
          const y = vertical ? plotY + i * (cardH + 60000) : plotY + 300000;
          if (i && !vertical) add(`Flow arrow ${i}`, x - 85000, y + cardH / 2 - 50000, 70000, 100000, "›", { size: 1900, bold: true, color: secondary, align: "ctr" });
          add(`Concept ${i + 1}`, x, y, cardW, cardH, item, { size: 1050, bold: true, fill: i % 2 ? pale : background, outline: pale, geometry: "roundRect", anchor: "ctr", padding: 70000 });
        });
        if (!items.length) add("Visual guidance", plotX, plotY + 400000, plotW, 700000, String(slide.visual_suggestion || "Add a labelled visual to support the explanation."), { size: 1200, color: muted, align: "ctr" });
      } else {
        add("Visual guidance", plotX + 50000, plotY + 250000, plotW - 100000, plotH - 350000,
          String(slide.visual_suggestion || slide.activity || slide.key_points?.[0] || "Add a labelled diagram or example to support the lesson."),
          { size: 1300, color: ink, fill: pale, outline: pale, geometry: "roundRect", anchor: "ctr", padding: 180000 });
      }
      if (slide.activity) {
        line("Footer rule", 520000, 4580000, 8620000, 4580000, pale, 9000);
        add("Classroom activity", 520000, 4660000, 8120000, 350000, `TRY IT  ·  ${String(slide.activity)}`, { size: 1000, color: muted, padding: 10000 });
      }
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    };
    const slideXml = slides.map(addSlide);
    entries[0][1] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`;
    entries[2][1] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
    entries[3][1] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`;
    slideXml.forEach((content, i) => entries.push(
      [`ppt/slides/slide${i + 1}.xml`, content],
      [`ppt/slides/_rels/slide${i + 1}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>']
    ));
    return zipBlob(entries, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  }

  function zipBlob(entries, mimeType) {
    const encoder = new TextEncoder();
    const files = [];
    const central = [];
    let offset = 0;
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let value = n;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[n] = value >>> 0;
    }
    const crc32 = (bytes) => {
      let crc = 0xffffffff;
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    };
    const header = (size) => new Uint8Array(size);
    const put = (array, position, value, width = 2) => {
      for (let index = 0; index < width; index++) array[position + index] = value >>> (index * 8) & 0xff;
    };
    entries.forEach(([filename, content]) => {
      const name = encoder.encode(filename);
      const bytes = encoder.encode(content);
      const crc = crc32(bytes);
      const local = header(30 + name.length);
      put(local, 0, 0x04034b50, 4); put(local, 4, 20); put(local, 14, crc, 4);
      put(local, 18, bytes.length, 4); put(local, 22, bytes.length, 4); put(local, 26, name.length);
      local.set(name, 30);
      files.push(local, bytes);
      const item = header(46 + name.length);
      put(item, 0, 0x02014b50, 4); put(item, 4, 20); put(item, 6, 20);
      put(item, 16, crc, 4); put(item, 20, bytes.length, 4); put(item, 24, bytes.length, 4);
      put(item, 28, name.length); put(item, 42, offset, 4); item.set(name, 46);
      central.push(item);
      offset += local.length + bytes.length;
    });
    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = header(22);
    put(end, 0, 0x06054b50, 4); put(end, 8, entries.length); put(end, 10, entries.length);
    put(end, 12, centralSize, 4); put(end, 16, offset, 4);
    return new Blob([...files, ...central, end], { type: mimeType });
  }

  function downloadDocument(doc, format) {
    const data = { title: doc.title || "Akademi document", lines: documentLines(doc) };
    if (doc.type === "slides") {
      if (format === "pptx") downloadBlob(pptxBlob(doc), `${safeName(data.title)}.pptx`);
      else if (format === "pdf") downloadBlob(presentationPdfBlob(doc), `${safeName(data.title)}.pdf`);
      else throw new Error("Presentation exports are available as PDF or PowerPoint.");
      return;
    }
    if (format !== "docx" && format !== "pdf") throw new Error("Choose DOCX, PDF or PowerPoint for this document.");
    if (doc.type === "lesson") {
      const model = lessonExportModel(doc);
      if (format === "pdf") downloadBlob(lessonPdfBlob(doc), `${safeName(model.title)}.pdf`);
      else downloadBlob(docxBlob({ title: model.title, blocks: lessonBlocks(model), lessonExport: true }), `${safeName(model.title)}.docx`);
      return;
    }
    if (doc.type === "assessment") {
      const input = doc.data?.assessment_input || {};
      const draft = doc.data?.assessment_draft || assessmentDraftFromHtml(doc);
      const administrator = doc.data?.administrator || {};
      if (!draft?.questions?.length) {
        if (format === "docx") download({ title: data.title, blocks: documentBlocks(doc), administrator }, format);
        else download({ ...data, administrator }, format);
        return;
      }
      download({
        title: draft.title || data.title,
        instructions: draft.instructions || input.instructions || "",
        questions: draft.questions || [],
        markingGuide: draft.marking_guide || [],
        additionalNotes: input.teacher_instructions || "",
        administrator,
        mode: "combined"
      }, format);
      return;
    }
    if (doc.type === "scheme") {
      const weeks = Array.isArray(doc.data?.weeks) ? doc.data.weeks : [];
      const tableRows = [["Wk", "Week Ending", "Topic", "Focal Areas", "Learning Indicators", "Learning Outcomes", "Assessment Schedule (auto)"]];
      const weekKinds = [null];
      const semesterNumbers = [null];
      let previousSemester = null;
      weeks.forEach((week) => {
        const semester = Number(week.semester_number) || Number(String(week.term || "").match(/[12]/)?.[0]) || 1;
        if ((doc.data?.scheme_period || "full_year") === "full_year" && semester !== previousSemester) {
          tableRows.push([`Semester ${semester}`, "", "", "", "", "", ""]);
          weekKinds.push("semester");
          semesterNumbers.push(semester);
        }
        previousSemester = semester;
        tableRows.push([
          String(week.week ?? ""),
          week.week_ending || "",
          week.topic || "",
          Array.isArray(week.focal_areas) ? week.focal_areas.join("\n") : "",
          Array.isArray(week.learning_indicators) ? week.learning_indicators.join("\n") : String(week.learning_indicators || ""),
          Array.isArray(week.learning_outcomes) ? week.learning_outcomes.join("\n") : String(week.learning_outcomes || ""),
          week.assessment_schedule || week.assessment || ""
        ]);
        weekKinds.push(week.week_kind || "teaching");
        semesterNumbers.push(semester);
      });
      const teacherName = doc.data?.created_by || "Teacher";
      const hodName = doc.data?.hod_name || "";
      download({
        title: data.title,
        subject: doc.data?.subject || doc.subject || "",
        year: doc.data?.year || doc.year || doc.year_group || "",
        academic_year: doc.data?.academic_year || "",
        teacherName,
        hodName,
        tableRows,
        weekKinds,
        semesterNumbers,
        blocks: [
          { text: [doc.data?.school, doc.data?.subject || doc.subject, doc.data?.year || doc.year || doc.year_group, doc.data?.academic_year].filter(Boolean).join("  |  ") },
          { type: "table", rows: tableRows, rowKinds: weekKinds },
          { text: "Sign-off", style: "Heading1" },
          { type: "table", rows: [
            ["Role", "Name", "Signature", "Date"],
            ["Prepared by", teacherName, "________________________", "________________"],
            ["Reviewed by · HOD", hodName || "HOD name not provided", "________________________", "________________"]
          ], rowKinds: [null, null, null] }
        ],
        scheduleTable: true,
        schemeExport: true
      }, format);
    } else if (format === "docx") {
      download({ title: data.title, blocks: documentBlocks(doc) }, format);
    } else {
      download(data, format);
    }
  }

  function assessmentDraftFromHtml(doc) {
    const parsed = new DOMParser().parseFromString(String(doc.html || ""), "text/html");
    const body = parsed.querySelector(".output-body") || parsed.body;
    const clean = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();
    const title = clean(body.querySelector(".document-title-block h1, .document-title-block h2, h1, h2")) || doc.title || "Assessment";
    const metadata = {};
    body.querySelectorAll(".meta-box").forEach((box) => {
      const key = clean(box.querySelector("small")).toLowerCase();
      if (key) metadata[key] = clean(box.querySelector("strong"));
    });
    const sections = Array.from(body.querySelectorAll(".document-section"));
    const questionSections = sections.filter((section) => section.querySelector(".assessment-question-list"));
    const paperSection = questionSections.find((section) => !/marking|guide/i.test(clean(section.querySelector("h3")))) || questionSections[0];
    const guideSection = questionSections.find((section) => /marking|guide/i.test(clean(section.querySelector("h3")))) || questionSections[1];
    const extractQuestions = (section, guideMode = false) => Array.from(section?.querySelectorAll(":scope .assessment-question-list > .assessment-question") || []).map((item, index) => {
      const heading = clean(item.querySelector(":scope > .assessment-question-heading"));
      const marks = heading.match(/([\d.]+)\s*marks?/i)?.[1] || "";
      const paragraphs = Array.from(item.querySelectorAll(":scope > p"));
      const options = Array.from(item.querySelector(":scope > ol.assessment-options")?.querySelectorAll(":scope > li") || []).map(clean);
      const correct = paragraphs.map(clean).map((value) => value.match(/Correct option:\s*([A-Z])(?:\.\s*(.*))?/i)).find(Boolean);
      return {
        question_number: index + 1,
        prompt: guideMode ? "" : clean(item.querySelector(":scope > p")),
        expected_response: guideMode ? clean(paragraphs.find((p) => !/Correct option:/i.test(clean(p)))) : "",
        marks,
        options: options.length ? options : undefined,
        correct_option: correct ? Math.max(0, correct[1].toUpperCase().charCodeAt(0) - 65) : 0
      };
    });
    const questions = extractQuestions(paperSection);
    if (!questions.length) return null;
    const guides = extractQuestions(guideSection, true);
    questions.forEach((question, index) => {
      const guide = guides[index];
      if (guide) {
        if (guide.expected_response) question.expected_answer = guide.expected_response;
        if (guide.options?.length) question.correct_option = guide.correct_option;
      }
    });
    const instructionSection = sections.find((section) => /instruction/i.test(clean(section.querySelector("h3"))));
    const instructions = clean(instructionSection?.querySelector(":scope > p"));
    const curriculum = sections.find((section) => /curriculum structure/i.test(clean(section.querySelector("h3"))));
    const outline = Array.from(curriculum?.querySelectorAll(":scope > ul > li") || []).map(clean);
    const duration = metadata.duration?.match(/[\d.]+/)?.[0] || "";
    const totalMarks = metadata["total marks"] || questions.reduce((sum, question) => sum + Number(question.marks || 0), 0);
    const type = metadata.assessment || "Assessment";
    const year = metadata["subject / year"]?.match(/SHS\s*Year\s*\d/i)?.[0] || "";
    const subject = metadata["subject / year"]?.replace(/\s*[·|]\s*SHS\s*Year\s*\d.*/i, "") || doc.subject || "";
    return {
      title, total_marks: totalMarks, questions,
      marking_guide: guides.map((guide, index) => ({ question_number: index + 1, marks: guide.marks, expected_response: guide.expected_response })),
      instructions, curriculum_outline: outline,
      _export: { assessmentType: type, subject, yearGroup: year, className: metadata.class || "", duration, totalMarks, coverage: "Teacher-selected curriculum scope" }
    };
  }

  window.akademiAssessmentExport = { download, downloadWithLogo, downloadDocument, downloadDocumentWithLogo };
  })();
