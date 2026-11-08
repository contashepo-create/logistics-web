// محرّك PDF احترافي للتقارير وكشوف الحسابات.
//
// لماذا محرّك خاص بدل تصوير المستند كصورة واحدة طويلة؟
//   الطريقة القديمة كانت تصوّر المستند كله في صورة واحدة ثم تقصّها كل 297mm،
//   فيقع القصّ في منتصف الصفوف: صف يظهر نصفه أسفل صفحة ونصفه أعلى التالية،
//   ويظهر كأن ارتفاع الصفوف متداخل. كما كانت تتجاهل حجم الورق واتجاهه
//   وإعدادات الطباعة، وتفقد رأس الجدول في الصفحات التالية.
//
// هذا المحرّك:
//   1) ينتظر تحميل الخطوط والصور قبل القياس (وإلا اختلّت أبعاد النص العربي).
//   2) يقسّم المحتوى إلى صفحات حقيقية بمقاس الورق المطلوب، ولا يقطع صفاً أبداً،
//      ويكرّر رأس الجدول في كل صفحة جديدة.
//   3) يضيف ترويسة متابعة وتذييلاً احترافياً (اسم المستند + رقم الصفحة + من طبع ومتى).
//   4) يصوّر كل صفحة على حدة بدقة 2x ويضعها في PDF بمقاسها الحقيقي (A4/A5/Letter،
//      طولي/عرضي) مع نفس هوامش وعلامة الطباعة المائية.

export interface PdfDocOptions {
  /** CSS مقيَّد بجذر المستند `.doc-root` (انظر scopedPrintCss في print.ts). */
  css?: string;
  /** أبعاد الورق بالمليمتر. الافتراضي A4 طولي. */
  paper?: { w: number; h: number };
  /** هامش الورقة بالمليمتر — يُطبَّق فعلياً على كل صفحة. */
  marginMm?: number;
  watermark?: string;
  footerText?: string;
  /** عنوان يتكرر في ترويسة الصفحات التالية للأولى. */
  runningTitle?: string;
  printedBy?: string;
  printedAt?: string;
  /** دقة التصوير (2 = 192dpi تقريباً). */
  scale?: number;
}

const MM_TO_PX = 96 / 25.4;
const FOOTER_PX = 38;
const RUNNING_HEAD_PX = 30;

/** CSS محايد يُستخدم إن لم تُمرَّر أنماط (نصوص عربية + جداول مرتبة). */
const DEFAULT_CSS = `
.doc-root { direction: rtl; color: #10202f; background: #fff;
  font-family: 'IBM Plex Sans Arabic','Segoe UI',Tahoma,sans-serif; font-size: 10pt; line-height: 1.55; }
.doc-root table { border-collapse: collapse; width: 100%; font-size: 10pt; }
.doc-root td, .doc-root th { padding: 4px 6px; border: 0.6pt solid #9fb0c2; vertical-align: middle; line-height: 1.5; }
.doc-root thead th, .doc-root thead td { background: #1f4e79; color: #fff; font-weight: 800; text-align: center; }
.doc-root td.doc-cell-text { white-space: normal; overflow-wrap: anywhere; text-align: right; }
.doc-root td.doc-cell-num, .doc-root th.doc-cell-num { white-space: nowrap; text-align: center; direction: ltr; font-variant-numeric: tabular-nums; }
.doc-root table.doc-plain, .doc-root table.doc-plain td, .doc-root table.doc-plain th { border: none !important; background: transparent !important; }
.doc-root .doc-title { text-align: center; font-size: 16pt; font-weight: 800; margin: 8px 0 2px; }
.doc-root .doc-sub { text-align: center; color: #33475b; margin-bottom: 8px; }
.doc-root .doc-company { font-size: 15pt; font-weight: 800; text-align: center; }
.doc-root .doc-contact { font-size: 9pt; color: #33475b; text-align: center; }
.doc-root .doc-summary { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
.doc-root .doc-summary-item { flex: 1 1 22%; min-width: 120px; border: 0.6pt solid #cfdae6; border-radius: 4px; padding: 5px 8px; background: #f8fafc; }
.doc-root .doc-summary-item .k { display: block; font-size: 8.5pt; color: #5a6b7d; }
.doc-root .doc-summary-item .v { display: block; font-size: 10.5pt; font-weight: 800; }
`;

async function waitForFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    // تحميل الخط فعلياً قبل القياس: بدونه تختلف أعراض النص فتظهر الصفوف متداخلة.
    await document.fonts.load('12px "IBM Plex Sans Arabic"');
    await document.fonts.ready;
  } catch {
    /* لا يمنع التصدير */
  }
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }));
}

interface Block { kind: "block" | "table"; el: HTMLElement }

/** تفكيك المحتوى إلى وحدات قابلة للترحيل بين الصفحات (جداول مستقلة ونصوص). */
function flatten(node: HTMLElement, out: Block[]): void {
  if (node.tagName === "TABLE") {
    out.push({ kind: "table", el: node });
    return;
  }
  const isContainer = ["DIV", "SECTION", "ARTICLE", "MAIN"].includes(node.tagName);
  const children = Array.from(node.children) as HTMLElement[];
  const hasDirectTable = children.some((c) => c.tagName === "TABLE");
  // الحاويات التي تجمع عنواناً/نصاً + جدولاً تُفكَّك كي تنتقل الجداول بين الصفحات
  // بلا قطع الصفوف، وكذلك الغلاف المفرد الذي يلُف المستند كله.
  const isBareWrapper = children.length === 1 && node.classList.length === 0 && !node.getAttribute("style");
  if (isContainer && (hasDirectTable || isBareWrapper)) {
    for (const child of children) flatten(child, out);
    return;
  }
  out.push({ kind: "block", el: node });
}

function mmToPx(mm: number): number {
  return mm * MM_TO_PX;
}

/**
 * يُصيّر HTML إلى ملف PDF مقسَّم صفحات حقيقية (بلا قطع صفوف) ثم ينزّله.
 * الدالة تُنظّف كل عناصر القياس المؤقتة مهما حدث من خطأ.
 */
export async function renderPdfDocument(html: string, fileName: string, opts: PdfDocOptions = {}): Promise<void> {
  const paper = opts.paper ?? { w: 210, h: 297 };
  const marginMm = opts.marginMm ?? 10;
  const pageW = mmToPx(paper.w);
  const pageH = mmToPx(paper.h);
  const margin = mmToPx(marginMm);
  const contentW = pageW - margin * 2;
  const contentH = pageH - margin * 2;

  const style = document.createElement("style");
  style.setAttribute("data-pdf-doc", "1");
  style.textContent = `${opts.css ?? DEFAULT_CSS}
    .pdf-stage { position: fixed; left: -20000px; top: 0; width: ${pageW}px; background: #fff; }
    .pdf-stage .doc-root { padding: 0 !important; margin: 0 !important; width: auto !important; max-width: none !important; }
    .pdf-page { position: relative; box-sizing: border-box; background: #fff; overflow: hidden;
      width: ${pageW}px; height: ${pageH}px; padding: ${margin}px; }
    .pdf-page-head { height: ${RUNNING_HEAD_PX}px; display: flex; align-items: center; justify-content: space-between;
      font-size: 8.5pt; color: #5a6b7d; border-bottom: 0.6pt solid #cfdae6; margin-bottom: 6px; }
    .pdf-page-head b { color: #10202f; }
    .pdf-page-body { width: ${contentW}px; }
    .pdf-page-foot { position: absolute; left: ${margin}px; right: ${margin}px; bottom: ${margin * 0.6}px;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border-top: 0.6pt solid #cfdae6; padding-top: 4px; font-size: 8pt; color: #5a6b7d; }
    .pdf-page-foot .page-no { font-variant-numeric: tabular-nums; direction: ltr; }
    .pdf-wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 56pt; font-weight: 700; color: rgba(15,23,42,0.06); transform: rotate(-30deg); pointer-events: none; }
  `;
  document.head.appendChild(style);

  const stage = document.createElement("div");
  stage.className = "pdf-stage";
  const root = document.createElement("div");
  root.className = "doc-root";
  root.dir = "rtl";
  root.style.cssText = `width:${contentW}px;box-sizing:border-box;background:#fff;`;
  root.innerHTML = html;
  stage.appendChild(root);
  document.body.appendChild(stage);

  try {
    await waitForFonts();
    await waitForImages(root);

    // ---- بناء الصفحات ----
    interface PageCtx { page: HTMLElement; body: HTMLElement; index: number }
    const pages: PageCtx[] = [];
    let current: PageCtx;

    const createPage = (index: number): PageCtx => {
      const page = document.createElement("div");
      page.className = "pdf-page";
      const body = document.createElement("div");
      body.className = "pdf-page-body";
      page.append(body);
      stage.appendChild(page);
      return { page, body, index };
    };

    const newPage = (): PageCtx => {
      current = createPage(pages.length);
      pages.push(current);
      return current;
    };

    current = newPage();

    const available = (ctx: PageCtx): number =>
      contentH - FOOTER_PX - (ctx.index > 0 ? RUNNING_HEAD_PX + 6 : 0);


    const overflowing = (ctx: PageCtx): boolean => ctx.body.scrollHeight > available(ctx);

    const placeBlock = (el: HTMLElement): void => {
      current.body.appendChild(el);
      if (!overflowing(current)) return;
      if (current.body.childElementCount === 1) return; // الكتلة وحدها أطول من الصفحة: نتركها
      current.body.removeChild(el);
      newPage();
      current.body.appendChild(el);
    };

    const placeTable = (table: HTMLTableElement): void => {
      const allRows: HTMLTableRowElement[] = [];
      for (const section of Array.from(table.tBodies)) allRows.push(...Array.from(section.rows));
      if (!allRows.length) allRows.push(...Array.from(table.rows));
      // صفوف التذييل (الإجماليات) تُنقل كصفوف عادية كي لا تُفقد عند تقسيم الصفحات
      if (table.tFoot) allRows.push(...Array.from(table.tFoot.rows));
      const head = table.tHead ? (table.tHead.cloneNode(true) as HTMLTableSectionElement) : null;

      const startShell = (): { shell: HTMLTableElement; body: HTMLTableSectionElement } => {
        const shell = table.cloneNode(false) as HTMLTableElement;
        if (head) shell.appendChild(head.cloneNode(true));
        const tbody = document.createElement("tbody");
        shell.appendChild(tbody);
        current.body.appendChild(shell);
        return { shell, body: tbody };
      };

      let shell: HTMLTableElement;
      let tbody: HTMLTableSectionElement;
      const restartTable = (): void => {
        if (shell) shell.remove();
        newPage();
        ({ shell, body: tbody } = startShell());
      };
      ({ shell, body: tbody } = startShell());

      for (const row of allRows) {
        const clone = row.cloneNode(true) as HTMLTableRowElement;
        const rowsBefore = tbody.rows.length;
        tbody.appendChild(clone);
        if (!overflowing(current)) continue;

        tbody.removeChild(clone);
        if (rowsBefore === 0) {
          // أول صف لا يتسع: ننقل الجدول كله (مع رأسه) إلى صفحة جديدة،
          // إلا إذا كان الجدول وحده في الصفحة فلا داعي لصفحة فارغة.
          if (current.body.childElementCount > 1) restartTable();
          tbody.appendChild(clone);
          continue;
        }
        // لا نقطع صفاً أبداً: صفحة جديدة + تكرار رأس الجدول
        restartTable();
        tbody.appendChild(clone);
      }
    };

    const blocks: Block[] = [];
    for (const child of Array.from(root.children) as HTMLElement[]) flatten(child, blocks);
    for (const block of blocks) {
      if (block.kind === "table") placeTable(block.el as HTMLTableElement);
      else placeBlock(block.el);
    }

    // حذف الصفحات الفارغة التي قد تنشأ عند ترحيل جدول قبل أول صف
    for (let i = pages.length - 1; i > 0; i -= 1) {
      if (pages[i].body.childElementCount === 0) {
        pages[i].page.remove();
        pages.splice(i, 1);
      }
    }
    pages.forEach((ctx, i) => { ctx.index = i; });

    // ---- الترويسة المتكررة والتذييل والعلامة المائية بعد معرفة العدد النهائي ----
    const total = pages.length;
    for (const ctx of pages) {
      if (ctx.index > 0) {
        const head = document.createElement("div");
        head.className = "pdf-page-head";
        head.innerHTML = `<span>تابع: <b>${escapeHtml(opts.runningTitle || "تقرير")}</b></span>`;
        ctx.page.insertBefore(head, ctx.body);
      }
      if (opts.watermark) {
        const wm = document.createElement("div");
        wm.className = "pdf-wm";
        wm.textContent = opts.watermark;
        ctx.page.appendChild(wm);
      }
      const foot = document.createElement("div");
      foot.className = "pdf-page-foot";
      const left = [opts.footerText, opts.printedBy ? `طُبع بواسطة: ${opts.printedBy}` : "", opts.printedAt || ""]
        .filter(Boolean).join(" • ");
      foot.innerHTML =
        `<span>${escapeHtml(left)}</span>` +
        `<span class="page-no">صفحة ${ctx.index + 1} من ${total}</span>`;
      ctx.page.appendChild(foot);
    }

    // ---- التصوير والدمج في PDF ----
    const [{ default: html2canvas }, { default: JsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const orientation = paper.w > paper.h ? "landscape" : "portrait";
    const pdf = new JsPDF({ unit: "mm", format: [paper.w, paper.h], orientation, compress: true });
    const scale = opts.scale ?? 2;

    for (let i = 0; i < pages.length; i += 1) {
      const canvas = await html2canvas(pages[i].page, {
        scale,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        windowWidth: pageW,
      });
      const img = canvas.toDataURL("image/jpeg", 0.95);
      if (i > 0) pdf.addPage([paper.w, paper.h], orientation);
      pdf.addImage(img, "JPEG", 0, 0, paper.w, paper.h, undefined, "FAST");
      // تحرير ذاكرة اللوحة بعد إضافتها (التقارير الطويلة قد تستهلك ذاكرة كبيرة)
      canvas.width = 0;
      canvas.height = 0;
    }

    pdf.save(fileName);
  } finally {
    stage.remove();
    style.remove();
  }
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
