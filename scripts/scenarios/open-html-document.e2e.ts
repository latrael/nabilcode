import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

function twoPagePdf() {
  const pages = ["Quarterly outlook", "Budget and risks"];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] >>",
    ...pages.flatMap((title, index) => {
      const content = `BT /F1 24 Tf 30 700 Td (${title}) Tj ET`;
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      ];
    }),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return source;
}

test(
  "The document picker opens host HTML with its relative assets",
  WEB,
  async ({ t3, app, screen, browser }) => {
    const files = {
      "outlook.pdf": twoPagePdf(),
      "report.html":
        '<!doctype html><html><head><link rel="stylesheet" href="assets/report.css"></head><body><h1>Quarterly report</h1><img src="assets/logo.svg" alt="Report logo" onload="this.dataset.width = this.naturalWidth"><script src="assets/report.js"></script></body></html>',
      "assets/report.css":
        "body { background: #eff6ff; padding: 32px; font: 20px sans-serif; } h1 { color: #1d4ed8; }",
      "assets/report.js":
        'document.body.dataset.assetsLoaded = getComputedStyle(document.querySelector("h1")).color;',
      "assets/logo.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#1d4ed8"/><text x="20" y="48" fill="white" font-size="24">REPORT</text></svg>',
    };
    const reports = await t3.project("reports", files);
    const project = await t3.project("demo", files);
    const thread = await t3.thread({ project, title: "Review documents", messages: ["Start"] });
    await t3.open(thread);
    await expect(screen.getByText("fixture turn complete", { exact: false })).toBeVisible();

    const mac = (await browser.evaluate(() => navigator.platform)).includes("Mac");
    await browser.keyboard.press(mac ? "Meta+p" : "Control+p");
    await screen.getByRole("button", "This computer").tap();
    await screen.getByRole("combobox").fill(`${reports}/report.html`);
    await expect(screen.getByText("Checking file…")).toBeHidden();
    await app.screenshot("document-path");
    const result = screen.getByRole("option", "report.html", { exact: false });
    await expect(result).toBeVisible();
    await result.tap();

    const document = browser.frameLocator('iframe[title$="report.html"]');
    await expect(document.getByRole("heading", "Quarterly report")).toBeVisible();
    await expect(document.locator("body")).toHaveAttribute(
      "data-assets-loaded",
      "rgb(29, 78, 216)",
    );
    await expect(document.getByRole("image", "Report logo")).toBeVisible();
    await expect(document.getByRole("image", "Report logo")).toHaveAttribute("data-width", "160");
    await app.screenshot("rendered-html");
    await screen.getByRole("button", "Show HTML source").tap();
    await expect(screen.getByRole("button", "Show rendered page")).toBeVisible();
    await expect(browser.locator("[data-file-content-focus]")).toHaveCount(0);

    await screen.getByRole("treeitem", "report.html", { exact: true }).tap();
    const boardDocument = browser.frameLocator('iframe[title="report.html"]');
    await expect(boardDocument.getByRole("heading", "Quarterly report")).toBeVisible();
    await expect(boardDocument.locator("body")).toHaveAttribute(
      "data-assets-loaded",
      "rgb(29, 78, 216)",
    );
    await app.screenshot("html-board-card");
    await screen.getByRole("button", "Close report.html").tap();
    await screen.getByRole("treeitem", "outlook.pdf", { exact: true }).tap();
    await expect(screen.getByText("1 / 2 pages")).toBeVisible();
    await screen.getByRole("searchbox", "Find in PDF").fill("Budget");
    await expect(screen.getByText("2 / 2 pages")).toBeVisible();
    await expect(browser.locator("[data-pdf-text-layer]").last()).toContainText("Budget and risks");
    await app.screenshot("pdf-last-page");
  },
);
