interface Stats {
  canRead: boolean;
  canWrite: boolean;
  exists: boolean; //indicates if file can be found on device storage
  isDirectory: boolean;
  isFile: boolean;
  isVirtual: boolean;
  lastModified: number;
  length: number;
  name: string;
  type: string;
  uri: string;
}

interface ExecResult{
  code: Number;
  result: String;
}

/** Result of a completed file transfer. */
interface TransferResult {
  bytes: number;
}

interface ShellEvent {
  type: "ready" | "data" | "exit" | "error";
  sessionId?: string;
  data?: string;
  exitCode?: number;
  message?: string;
}

interface SftpProfileInfo {
  hostname: string;
  port: number;
  username: string;
  authType: "password" | "key";
}

interface Sftp {
  /**
   * Executes command on ssh-server
   * @param command 
   * @param onSucess 
   * @param onFail 
   */
  exec(command: String, onSucess: (res: ExecResult)=>void, onFail: (err: any) => void): void;
  /** Connects using credentials held by the native profile store. */
  connectUsingProfile(profileId: String, onSuccess: () => void, onFail: (err: any) => void, timeout?: Number): void;
  /** Tests a profile once and returns its remote working directory. */
  testProfile(profileId: String, requestId: String, timeout: Number, onSuccess: (home: String) => void, onFail: (err: any) => void): void;
  /** Cancels an in-flight profile connection or test. */
  cancelConnection(requestId: String, onSuccess: () => void, onFail: (err: any) => void): void;
  saveProfile(profileId: String | null, host: String, port: Number, username: String, authType: String, password: String, keyFile: String, passphrase: String, onSuccess: (profileId: String) => void, onFail: (err: any) => void): void;
  editProfile(profileId: String | null, host: String, port: Number, username: String, authType: String, password: String, keyFile: String, passphrase: String, onSuccess: (profile: SftpProfileInfo & {profileId: string}) => void, onFail: (err: any) => void): void;
  getProfileInfo(profileId: String, onSuccess: (profile: SftpProfileInfo & {profileId: string}) => void, onFail: (err: any) => void): void;
  deleteProfile(profileId: String, onSuccess: () => void, onFail: (err: any) => void): void;

  /**
   * Downloads a file from the server.
   * @param filename remote path
   * @param localFilename local destination, a `file://` or `content://` URI
   * @param onSuccess receives the number of bytes written
   * @param onFail
   */
  getFile(filename: String, localFilename: String, onSuccess: (res: TransferResult) => void, onFail: (err: any) => void): void;

  /**
   * Uploads a file to the server.
   * @param filename remote path
   * @param localFilename local source, a `file://` or `content://` URI
   * @param onSuccess receives the number of bytes read
   * @param onFail
   */
  putFile(filename: String, localFilename: String, onSuccess: (res: TransferResult) => void, onFail: (err: any) => void): void;
  
  /**
   * Closes the connection
   * @param onSuccess 
   * @param onFail 
   */
  close(onSuccess: () => void, onFail: (err: any) => void): void;
  
  /**
   * Gets wether server is connected or not.
   * @param onSuccess 
   * @param onFail 
   */
  isConnected(onSuccess: (connectionId: String) => void, onFail: (err: any) => void): void;
  openShellUsingProfile(profileId: String, cols: Number, rows: Number, onEvent: (event: ShellEvent) => void, onFail: (err: any) => void): void;
  writeShell(sessionId: String, data: String, onSuccess: () => void, onFail: (err: any) => void): void;
  resizeShell(sessionId: String, cols: Number, rows: Number, onSuccess: () => void, onFail: (err: any) => void): void;
  closeShell(sessionId: String, onSuccess: () => void, onFail: (err: any) => void): void;

  /**
   * Answers a host key confirmation the plugin asked for.
   * The plugin calls `window.__acodeSftpConfirm(request)`, and the page reports
   * the answer back through this action.
   */
  resolveConfirmation(callbackId: String, confirmed: boolean, onSuccess: () => void, onFail: (err: any) => void): void;

  /** Shows a native toast, used for notices raised off the UI thread. */
  showToast(message: String, onSuccess: () => void, onFail: (err: any) => void): void;
}

interface SftpConfirmationRequest {
  id: string;
  title: string;
  message: string;
  acceptLabel: string;
  cancelLabel: string;
}

declare var sftp: Sftp;
