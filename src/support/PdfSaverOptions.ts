// See https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF for details
export interface PdfSaverOptions {
  landscape?: boolean;
  displayHeaderFooter?: boolean;
  printBackground?: boolean;
  scale?: number;
  paperWidth?: number;
  paperHeight?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  pageRanges?: string;
  ignoreInvalidPageRanges?: boolean;
}