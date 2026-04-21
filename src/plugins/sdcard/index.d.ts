interface Storage {
  /**
   * Name of the storage
   */
  name: string;
  /**
   * UUID of the storage
   */
  uuid: string;
}

interface DirListItem {
  name: string;
  mime: string;
  isDirectory: Boolean;
  isFile: Boolean;
  uri: string;
}

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

interface DocumentFile {
  canWrite: boolean;
  filename: string;
  length: number;
  type: string;
  uri: string;
}

interface SDcard {
  /**
   * Copy file/directory to given destination
   * @param src Source url
   * @param dest Destination url
   * @param onSuccess Callback function on success returns url of copied file/dir
   * @param onFail Callback function on error returns error object
   */
  copy(
    src: string,
    dest: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Creates new directory at given source url.
   * @param src Source url
   * @param dirName New directory name
   * @param onSuccess Callback function on success returns url of new directory
   * @param onFail callback function on error returns error object
   */
  createDir(
    src: string,
    dirName: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Creates new file at given source url.
   * @param src Source url
   * @param fileName New file name
   * @param onSuccess Callback function on success returns url of new directory
   * @param onFail Callback function on error returns error object
   */
  createFile(
    src: string,
    fileName: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Deletes file/directory
   * @param src Source url of file/directory
   * @param onSuccess Callback function on success returns source url
   * @param onFail Callback function on error returns error object
   */
  delete(
    src: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Checks if given file/directory
   * @param src File/Directory url
   * @param onSuccess Callback function on success returns string "TRUE" or "FALSE"
   * @param onFail Callback function on error returns error object
   */
  exists(
    src: string,
    onSuccess: (exists: 'TRUE' | 'FALSE') => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Converts virtual URL to actual url
   * @param src Virtual address returned by other methods
   * @param onSuccess Callback function on success returns actual url
   * @param onFail Callback function on error returns error object
   */
  formatUri(
    src: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Gets actual url for relative path to src
   * e.g. getPath(src, "../path/to/file.txt") => actual url
   * @param src Directory url
   * @param path Relative file/directory path
   * @param onSuccess Callback function on success returns actual url
   * @param onFail Callback function on error returns error object
   */
  getPath(
    src: string,
    path: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Requests user for storage permission
   * @param uuid UUID returned from listStorages method
   * @param onSuccess Callback function on success returns url for the storage root
   * @param onFail Callback function on error returns error object
   */
  getStorageAccessPermission(
    uuid: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Lists all the storages
   * @param onSuccess Callback function on success returns list of storages
   * @param onFail Callback function on error returns error object
   */
  listStorages(
    onSuccess: (storages: Array<Storage>) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Gets list of files/directory in the given directory
   * @param src Directory url
   * @param onSuccess Callback function on success returns list of files/directory
   * @param onFail Callback function on error returns error object
   */
  listDir(
    src: string,
    onSuccess: (list: Array<DirListItem>) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Move file/directory to given destination
   * @param src Source url
   * @param dest Destination url
   * @param onSuccess Callback function on success returns url of moved file/dir
   * @param onFail Callback function on error returns error object
   */
  move(
    src: string,
    dest: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Opens file provider to select file
   * @param onSuccess Callback function on success returns url of selected file
   * @param onFail Callback function on error returns error object
   * @param mimeType MimeType of file to be selected
   */
  openDocumentFile(
    onSuccess: (url: DocumentFile) => void,
    onFail: (err: any) => void,
    mimeType: string,
  ): void;
  /**
   * Opens gallery to select image
   * Returns a temporary URI grant for the selected image.
   * Use read/stats on the returned URI if you need to inspect or preview it.
   * @param onSuccess Callback function on success returns URI of selected image
   * @param onFail Callback function on error returns error object
   * @param mimeType MimeType of file to be selected
   */
  getImage(
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
    mimeType: string,
  ): void;
  /**
   * Renames the given file/directory to given new name
   * @param src Url of file/directory
   * @param newname New name
   * @param onSuccess Callback function on success returns url of renamed file
   * @param onFail Callback function on error returns error object
   */
  rename(
    src: string,
    newname: string,
    onSuccess: (url: string) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Writes new content to the given file.
   * @param src file url
   * @param content new file content
   * @param onSuccess Callback function on success returns "OK"
   * @param onFail Callback function on error returns error object
   */
  write(
    src: string,
    content: string,
    onSuccess: (res: 'OK') => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Writes new content to the given file.
   * @param src file url
   * @param content new file content
   * @param isBinary is data binary
   * @param onSuccess Callback function on success returns "OK"
   * @param onFail Callback function on error returns error object
   */
  write(
    src: string,
    content: string,
    isBinary: Boolean,
    onSuccess: (res: 'OK') => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Gets stats of given file
   * @param src file/directory url
   * @param onSuccess Callback function on success returns file/directory stats
   * @param onFail Callback function on error returns error object
   */
  stats(
    src: string,
    onSuccess: (stats: Stats) => void,
    onFail: (err: any) => void,
  ): void;
  /**
   * Listens for file changes
   * @param src File url
   * @param listener Callback function on file change returns file stats
   */
  watchFile(
    src: string,
    listener: () => void,
  ): {
    unwatch: () => void;
  };
}

declare var sdcard: SDcard;
