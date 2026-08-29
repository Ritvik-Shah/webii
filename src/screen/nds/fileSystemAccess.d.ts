// TS's bundled DOM lib includes the base FileSystemFileHandle type but not
// the File System Access API's permission methods or window.
// showOpenFilePicker -- both are part of a separate, still-evolving spec.
// Minimal ambient augmentation covering only what filePersistence.ts uses.
export {};

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }

  interface FileSystemFileHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface OpenFilePickerOptions {
    types?: { description?: string; accept: Record<string, string[]> }[];
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
  }

  interface Window {
    showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  }
}
