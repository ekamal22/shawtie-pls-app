export interface MediaUploadGrant {
  readonly url: string;
  readonly expiresAt: Date;
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

export interface MediaDownloadGrant {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface MediaObjectStore {
  createUploadGrant(input: {
    readonly objectKey: string;
    readonly sha256: string;
    readonly expiresAt: Date;
  }): Promise<MediaUploadGrant>;
  verifyObject(input: {
    readonly objectKey: string;
    readonly expectedBytes: bigint;
    readonly sha256: string;
  }): Promise<boolean>;
  createDownloadGrant(input: {
    readonly objectKey: string;
    readonly expiresAt: Date;
  }): Promise<MediaDownloadGrant>;
  deleteObject(objectKey: string): Promise<void>;
}
