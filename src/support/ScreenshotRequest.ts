export interface IScreenshotRequest {
  url: string;
  orientation: 'portrait'| 'landscape';
  exportType: 'pdf' | 'image';
  delay: number;
  flagName: string;
}
