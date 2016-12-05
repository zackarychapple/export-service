export interface ScreenshotRequest {
  url: URL;
  orientation: 'portrait'| 'landscape';
  exportType: 'pdf' | 'image';
  delay:number;
}