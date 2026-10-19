/**
 * Server-side PDF and DOCX rendering of one report version (P07). Both formats are built from the same
 * snapshot the Markdown and JSON exports use, so the three artifacts always describe the same content.
 * The PDF embeds DejaVu Sans, which covers the Vietnamese diacritics the standard PDF fonts cannot draw.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

export interface RenderableReport {
  title: string;
  reportId: string;
  version: number;
  summary: string;
  sections: { title: string; content: string }[];
  findings: { title: string; severity: string; status: string; findingVersion: number; detail: string }[];
}

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT_REGULAR = join(fontDir, 'DejaVuSans.ttf');
const FONT_BOLD = join(fontDir, 'DejaVuSans-Bold.ttf');

function meta(report: RenderableReport): string {
  return `Report ${report.reportId}, version ${report.version}`;
}

export function renderReportPdf(report: RenderableReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: report.title, Subject: meta(report) } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('report-regular', FONT_REGULAR);
    doc.registerFont('report-bold', FONT_BOLD);
    doc.font('report-bold').fontSize(18).text(report.title);
    doc.font('report-regular').fontSize(10).fillColor('#555555').text(meta(report)).fillColor('#000000');
    doc.moveDown();
    doc.font('report-regular').fontSize(11).text(report.summary);
    for (const section of report.sections) {
      doc.moveDown();
      doc.font('report-bold').fontSize(13).text(section.title);
      doc.font('report-regular').fontSize(11).text(section.content);
    }
    for (const finding of report.findings) {
      doc.moveDown();
      doc.font('report-bold').fontSize(13).text(finding.title);
      doc.font('report-regular').fontSize(9).fillColor('#555555')
        .text(`${finding.severity}, ${finding.status}, finding v${finding.findingVersion}`).fillColor('#000000');
      doc.font('report-regular').fontSize(11).text(finding.detail);
    }
    doc.end();
  });
}

export async function renderReportDocx(report: RenderableReport): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(report.title)] }),
    new Paragraph({ children: [new TextRun({ text: meta(report), color: '555555' })] }),
    new Paragraph({ children: [new TextRun(report.summary)] }),
  ];
  for (const section of report.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.title)] }));
    children.push(new Paragraph({ children: [new TextRun(section.content)] }));
  }
  for (const finding of report.findings) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(finding.title)] }));
    children.push(new Paragraph({ children: [new TextRun({ text: `${finding.severity}, ${finding.status}, finding v${finding.findingVersion}`, color: '555555' })] }));
    children.push(new Paragraph({ children: [new TextRun(finding.detail)] }));
  }
  const document = new Document({ creator: 'Raptix', title: report.title, sections: [{ children }] });
  return Packer.toBuffer(document);
}
