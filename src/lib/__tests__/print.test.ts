import { describe, it, expect } from "vitest";
import { DEFAULT_PRINT_SETTINGS, paperDimensions, printCss } from "../print";

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
    expect(css).toContain("font-size: 12pt");
  });
  it("يلغي التظليل والخطوط الشبكية عند تعطيلهما", () => {
    const css = printCss({ ...DEFAULT_PRINT_SETTINGS, zebra: false, grid_lines: false });
    expect(css).not.toContain("nth-child(even)");
    expect(css).toContain("border: none;");
  });
});
