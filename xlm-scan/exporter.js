'use strict';
/* XLM Scan — xuất PDF (có lớp chữ tìm kiếm, mật khẩu, nén) và Word (.docx) */
const Exporter = (() => {
  let fontB64 = null;
  async function pdfFont() {
    if (fontB64) return fontB64;
    const buf = new Uint8Array(await (await fetch('vendor/fonts/pdf-vn.ttf')).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    fontB64 = btoa(s); return fontB64;
  }
  async function shrink(blob, maxSide, q) {
    const c = Imaging.scaleCanvas(await Imaging.blobToCanvas(blob), maxSide);
    return { blob: await Imaging.toBlob(c, 'image/jpeg', q), w: c.width, h: c.height };
  }

  /** opts: { size:'a4'|'fit', textLayer:bool, password:string, compress:bool, progress(fn) } */
  async function pdf(doc, opts) {
    await loadScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    let pdf = null, fontReady = false;
    const n = doc.pageIds.length;
    for (let k = 0; k < n; k++) {
      opts.progress && opts.progress(`Đang tạo PDF… trang ${k + 1}/${n}`, k / n);
      const p = await DB.get('pages', doc.pageIds[k]);
      let img = { blob: p.image, w: p.w, h: p.h };
      if (opts.compress) img = await shrink(p.image, 1500, p.filter === 'bw' ? 0.5 : 0.6);
      const bytes = new Uint8Array(await img.blob.arrayBuffer());
      const land = p.w > p.h;
      let W, H, x = 0, y = 0, w, h;
      if (opts.size === 'a4') {
        W = land ? 297 : 210; H = land ? 210 : 297;
        const s = Math.min(W / p.w, H / p.h); w = p.w * s; h = p.h * s; x = (W - w) / 2; y = (H - h) / 2;
      } else {
        const s = Math.min(1, 297 / (Math.max(p.w, p.h) * 25.4 / 200));
        W = w = p.w * 25.4 / 200 * s; H = h = p.h * 25.4 / 200 * s;
      }
      const fmt = [Math.min(W, H), Math.max(W, H)], ori = land ? 'l' : 'p';
      if (!pdf) {
        const o = { orientation: ori, unit: 'mm', format: fmt, compress: true };
        if (opts.password) o.encryption = { userPassword: opts.password, ownerPassword: opts.password + '#xlm', userPermissions: ['print', 'copy'] };
        pdf = new jsPDF(o);
      } else pdf.addPage(fmt, ori);
      pdf.addImage(bytes, 'JPEG', x, y, w, h, 'p' + k, 'NONE');
      // lớp chữ vô hình đặt đúng vị trí từng từ → PDF tìm kiếm / bôi đen sao chép được
      if (opts.textLayer && p.words && p.words.length) {
        if (!fontReady) { pdf.addFileToVFS('pdf-vn.ttf', await pdfFont()); pdf.addFont('pdf-vn.ttf', 'VN', 'normal'); fontReady = true; }
        pdf.setFont('VN', 'normal');
        for (const [t, x0, y0, x1, y1] of p.words) {
          const bh = (y1 - y0) * h, bw = (x1 - x0) * w;
          if (!t || bh <= 0 || bw <= 0) continue;
          const fs = Math.max(2, bh * 0.92 / 0.3528); // mm → pt
          pdf.setFontSize(fs);
          const tw = pdf.getTextWidth(t);
          const hs = tw > 0 ? Math.max(0.2, Math.min(5, bw / tw)) : 1;
          try { pdf.text(t, x + x0 * w, y + y1 * h - bh * 0.18, { renderingMode: 'invisible', horizontalScale: hs }); } catch { /* ký tự lạ */ }
        }
      }
    }
    pdf.setProperties({ title: doc.name, subject: doc.assetCode ? `Tài sản ${doc.assetCode}` : '', creator: 'XLM Scan' });
    return pdf.output('blob');
  }

  /* ---------- Word (.docx) theo thể thức văn bản: Times New Roman 13, lề trái 3 cm */
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const run = t => `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const para = t => `<w:p><w:pPr><w:spacing w:after="60" w:line="288" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>${t ? run(t) : ''}</w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  function imagePara(rid, idx, cx, cy) {
    return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${idx}" name="Trang ${idx}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${idx}" name="trang${idx}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  /** opts: { images:bool, progress } — cần đã nhận dạng chữ */
  async function word(doc, opts = {}) {
    await loadScript('vendor/jszip.min.js');
    const zip = new JSZip();
    const rels = [];
    let body = '';
    const n = doc.pageIds.length;
    for (let k = 0; k < n; k++) {
      opts.progress && opts.progress(`Đang tạo Word… trang ${k + 1}/${n}`, k / n);
      const pid = doc.pageIds[k];
      if (k) body += pageBreak;
      if (opts.images) {
        const p = await DB.get('pages', pid);
        const img = await shrink(p.image, 1600, 0.8);
        const name = `trang${k + 1}.jpg`, rid = 'rIdImg' + (k + 1);
        zip.file('word/media/' + name, img.blob);
        rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
        const maxW = 16 * 360000, maxH = 24 * 360000; // EMU, vùng in A4 trừ lề
        const s = Math.min(maxW / img.w, maxH / img.h);
        body += imagePara(rid, k + 1, Math.round(img.w * s), Math.round(img.h * s));
        if (doc.ocr?.[pid]) body += pageBreak;
      }
      const text = (doc.ocr?.[pid] || '').replace(/\r/g, '');
      for (const block of text.split(/\n{2,}/)) {
        // nối các dòng bị ngắt giữa câu thành 1 đoạn, giữ dòng ngắn (tiêu đề, danh sách)
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        let buf = '';
        for (const l of lines) {
          if (!buf) buf = l;
          else if (/[.:;!?]$/.test(buf) || !/^[a-zà-ỹđ(]/.test(l) || buf.length < 30) { body += para(buf); buf = l; }
          else buf += ' ' + l;
        }
        if (buf) body += para(buf);
        body += para('');
      }
    }
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.name)}</dc:title><dc:creator>XLM Scan</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
    zip.file('word/document.xml', docXml);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  return { pdf, word };
})();
