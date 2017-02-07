export interface TimingObject {
  exportName?:string;
  requestMade?: number;
  chromeStartup?: number;
  pagePreEnable?: number;
  pagePostEnable?: number;
  navigationStart?: number;
  inTakeScreenshot?: number;
  initPDF?: number;
  pdfPiped?: number;
  documentClosed?: number;
  instanceClosed?: number;
  imageSaved?: number;
}
