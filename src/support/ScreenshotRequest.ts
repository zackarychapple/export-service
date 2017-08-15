export interface IScreenshotRequest {
  urls: string[];
  exportName: string;
  orientation: 'portrait'| 'landscape';
  exportType: 'pdf' | 'image';
  delay: number;
  flagName: string;
}
