export interface ScreenshotRequest {
  url: URL;
  orientation: 'portirate'| 'landscape';
  exportType: 'pdf' | 'image';
}