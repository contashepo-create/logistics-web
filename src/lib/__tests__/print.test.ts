import { describe, it, expect } from "vitest";
import { DEFAULT_PRINT_SETTINGS, PRINT_TEMPLATES, getTemplate, paperDimensions, printCss } from "../print";

describe("إعدادات الطباعة", () => {
  it("A4 طولي = 210×297 مم", () => {
    expect(paperDimensions({ ...DEFAULT_PRINT_SETTINGS, paper: "A4", orientation: "portrait" })).toEqual({ w: 210, h: 297 });
  });
  it("A4 عرضي يقلب الأبعاد", () => {
    expect(paperDimensions({ ...DEFAULT_PRINT_SETTINGS, paper: "A4", orientation: "landscape" })).toEqual({ w: 297, h: 210 });
  });
  it("A5 و Letter مدعومان", () => {
    expect(paperDimensions({ ...DEFAULT_PRINT_SETTINGS, paper: "A5" })).toEqual({ w: 148, h: 210 });
    expect(paperDimensions({ ...DEFAULT_PRINT_SETTINGS, paper: "Letter" })).toEqual({ w: 216, h: 279 });
  });
  it("يبني @page بالهوامش وحجم الخط المطلوبين", () => {
    const css = printCss({ ...DEFAULT_PRINT_SETTINGS, margin_mm: 20, font_size_pt: 12 });
    expect(css).toContain("@page { size: 210mm 297mm; margin: 20mm; }");
    expect(css).toContain("font-size: 12.0pt");
  });
  it("يلغي التظليل والخطوط الشبكية عند تعطيلهما", () => {
    const css = printCss({ ...DEFAULT_PRINT_SETTINGS, zebra: false, grid_lines: false });
    expect(css).not.toContain("nth-child(even)");
    expect(css).toContain("border: none;");
  });
  it("لا يسمح بحقن CSS عبر لون القالب", () => {
    const css = printCss({ ...DEFAULT_PRINT_SETTINGS, accent_color: "#fff;}INJECTED{color:red" });
    expect(css).not.toContain("INJECTED");
    expect(css).toContain(DEFAULT_PRINT_SETTINGS.accent_color);
  });
});

describe("قوالب الفواتير الاحترافية المنقولة من pro-acc", () => {
  it("توجد ستة قوالب بمعرّفات فريدة ووصف واضح", () => {
    expect(PRINT_TEMPLATES).toHaveLength(6);
    const ids = PRINT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual(["modern", "classic", "compact", "elegant", "logistics", "thermal"]);
    for (const t of PRINT_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("getTemplate يعيد القالب المطلوب ويتحمّل المعرّف الخاطئ", () => {
    expect(getTemplate("elegant").id).toBe("elegant");
    expect(getTemplate("nope").id).toBe("modern");
  });

  it("كل قالب ينتج CSS مختلفاً عن غيره", () => {
    const css = PRINT_TEMPLATES.map((t) => printCss({ ...DEFAULT_PRINT_SETTINGS, template: t.id }));
    expect(new Set(css).size).toBe(6);
  });

  it("اللون الرئيسي ينعكس في القالب", () => {
    const css = printCss({ ...DEFAULT_PRINT_SETTINGS, template: "classic", accent_color: "#aa0055" });
    expect(css.toLowerCase()).toContain("#aa0055");
  });

  it("القالب المضغوط أكثف والأنيق أوسع", () => {
    const compact = printCss({ ...DEFAULT_PRINT_SETTINGS, template: "compact" });
    const elegant = printCss({ ...DEFAULT_PRINT_SETTINGS, template: "elegant" });
    expect(compact).toContain("padding: 2.5px 5px");
    expect(elegant).toContain("padding: 6px 8px");
    expect(elegant).toContain("line-height: 1.85");
  });

  it("القالب الحراري يهيئ ورقة 80 مم بلا تظليل", () => {
    const css = printCss({ ...DEFAULT_PRINT_SETTINGS, template: "thermal" });
    expect(css).not.toContain("nth-child(even)");
    expect(css).toContain("@page { size: 80mm 297mm; margin: 4mm; }");
    expect(css).toContain("width:72mm");
  });
});
