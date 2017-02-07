export interface IScreenshotRequest {
  url: string;
  exportName: string;
  orientation: 'portrait'| 'landscape';
  exportType: 'pdf' | 'image';
  delay: number;
  flagName: string;
}
