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

interface Sftp {
  /**
   * Executes command on ssh-server
   * @param command 
   * @param onSucess 
   * @param onFail 
   */
  exec(command: String, onSucess: (res: ExecResult)=>void, onFail: (err: any) => void): void;
  /**
   * Connects to SFTP server
   * @param host Hostname of the server
   * @param port port numer
   * @param username Username 
   * @param password Password or private key file to authenticate the server
   * @param onSuccess Callback function on success returns url of copied file/dir
   * @param onFail Callback function on error returns error object
   */
  connectUsingPassoword(host: String, port: Number, username: String, password: String, onSuccess: () => void, onFail: (err: any) => void): void;
  
  /**
   * Connects to SFTP server
   * @param host Hostname of the server
   * @param port port numer
   * @param username Username 
   * @param keyFile Password or private key file to authenticate the server
   * @param passphrase Passphrase for keyfile
   * @param onSuccess Callback function on success returns url of copied file/dir
   * @param onFail Callback function on error returns error object
   */
  connectUsingKeyFile(host: String, port: Number, username: String, keyFile: String, passphrase: String, onSuccess: () => void, onFail: (err: any) => void): void;

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
  openShellUsingPassword(host: String, port: Number, username: String, password: String, cols: Number, rows: Number, onEvent: (event: ShellEvent) => void, onFail: (err: any) => void): void;
  openShellUsingKeyFile(host: String, port: Number, username: String, keyFile: String, passphrase: String, cols: Number, rows: Number, onEvent: (event: ShellEvent) => void, onFail: (err: any) => void): void;
  writeShell(sessionId: String, data: String, onSuccess: () => void, onFail: (err: any) => void): void;
  resizeShell(sessionId: String, cols: Number, rows: Number, onSuccess: () => void, onFail: (err: any) => void): void;
  closeShell(sessionId: String, onSuccess: () => void, onFail: (err: any) => void): void;
}

declare var sftp: Sftp;
