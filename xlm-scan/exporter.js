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
  /** Ảnh trang để xuất: đóng dấu mờ / nén nếu cần */
  async function pageImage(p, opts = {}) {
    if (!opts.watermark && !opts.compress && !opts.maxSide) return { blob: p.image, w: p.w, h: p.h };
    let c = await Imaging.blobToCanvas(p.image);
    const lim = opts.compress ? 1500 : opts.maxSide || 0;
    if (lim) c = Imaging.scaleCanvas(c, lim);
    if (c === undefined) c = await Imaging.blobToCanvas(p.image);
    if (opts.watermark) { const cc = Imaging.canvas(c.width, c.height); cc.getContext('2d').drawImage(c, 0, 0); c = Imaging.watermark(cc, opts.watermark); }
    return { blob: await Imaging.toBlob(c, 'image/jpeg', opts.compress ? (p.filter === 'bw' ? 0.5 : 0.6) : 0.9), w: c.width, h: c.height };
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
      const img = await pageImage(p, opts);
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
        const img = await pageImage(p, { maxSide: 1600, watermark: opts.watermark });
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
  /* ---------- PowerPoint: mỗi trang một slide khổ A4 */
  async function pptx(doc, opts = {}) {
    await loadScript('vendor/jszip.min.js');
    const z = new JSZip();
    const SW = 7560000, SH = 10692000; // A4 dọc (EMU)
    const n = doc.pageIds.length, slides = [];
    for (let k = 0; k < n; k++) {
      opts.progress && opts.progress(`Đang tạo PowerPoint… trang ${k + 1}/${n}`, k / n);
      const p = await DB.get('pages', doc.pageIds[k]);
      const img = await pageImage(p, { maxSide: 2000, watermark: opts.watermark });
      z.file(`ppt/media/image${k + 1}.jpg`, img.blob);
      const s = Math.min(SW / img.w, SH / img.h), cx = Math.round(img.w * s), cy = Math.round(img.h * s);
      const x = Math.round((SW - cx) / 2), y = Math.round((SH - cy) / 2);
      z.file(`ppt/slides/slide${k + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Trang ${k + 1}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
      z.file(`ppt/slides/_rels/slide${k + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${k + 1}.jpg"/></Relationships>`);
      slides.push(k + 1);
    }
    const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const emptyTree = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>';
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map(i => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
    z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
    z.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map(i => `<p:sldId id="${255 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SW}" cy="${SH}"/><p:notesSz cx="${SH}" cy="${SW}"/></p:presentation>`);
    z.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map(i => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`).join('')}</Relationships>`);
    z.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}>${emptyTree.replace('<p:cSld>', '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
    z.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>');
    z.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1">${emptyTree.replace('<p:cSld>', '<p:cSld name="Trống">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    z.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
    const c = (n, v) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
    const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    const ln = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
    z.file('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="XLM"><a:themeElements><a:clrScheme name="XLM"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${c('dk2', '14202A')}${c('lt2', 'EEF2F4')}${c('accent1', '0E5A78')}${c('accent2', 'E09A10')}${c('accent3', '1E7B4B')}${c('accent4', 'B42318')}${c('accent5', '5E6E7B')}${c('accent6', '5DB2D8')}${c('hlink', '0E5A78')}${c('folHlink', '5E6E7B')}</a:clrScheme><a:fontScheme name="XLM"><a:majorFont><a:latin typeface="Times New Roman"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Times New Roman"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="XLM"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${ln}${ln}${ln}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`);
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }
  return { pdf, word, pptx, pageImage };
})();
