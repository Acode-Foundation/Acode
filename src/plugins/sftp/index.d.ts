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
  connectUsingProfile(profileId: String, onSuccess: () => void, onFail: (err: any) => void): void;
  saveProfile(profileId: String | null, host: String, port: Number, username: String, authType: String, password: String, keyFile: String, passphrase: String, onSuccess: (profileId: String) => void, onFail: (err: any) => void): void;
  editProfile(profileId: String | null, host: String, port: Number, username: String, authType: String, alias: String, onSuccess: (profile: SftpProfileInfo & {profileId: string, alias: string}) => void, onFail: (err: any) => void): void;
  deleteProfile(profileId: String, onSuccess: () => void, onFail: (err: any) => void): void;

  /**
   * Gets file from the server.
   * @param filename 
   * @param localFilename copy/shadow of remote file.
   * @param onSuccess 
   * @param onFail 
   */
  getFile(filename: String, localFilename: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  
  /**
   * Uploaded the file to server
   * @param filename 
   * @param localFilename copy/shadow of remote file.
   * @param onSuccess 
   * @param onFail 
   */
  putFile(filename: String, localFilename: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  
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
}

declare var sftp: Sftp;
