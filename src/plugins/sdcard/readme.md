# Write/modify content on external storage

Using this plugin, cordova apps can check for external storages and write/modify files.

## Usage

```ts
interface SDcard {

  /**
   * Copy file/directory to given destination
   * @param src Source url
   * @param dest Destination url
   * @param onSuccess Callback function on success returns url of copied file/dir
   * @param onFail Callback function on error returns error object
   */
  copy(src: String, dest: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Creates new directory at given source url.
   * @param src Source url
   * @param dirName New directory name
   * @param onSuccess Callback function on success returns url of new directory
   * @param onFail callback function on error returns error object
   */
  createDir(src: String, dirName: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Creates new file at given source url.
   * @param src Source url
   * @param dirName New file name
   * @param onSuccess Callback function on success returns url of new directory
   * @param onFail Callback function on error returns error object
   */
  createFile(src: String, fileName: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Deletes file/directory
   * @param src Source url of file/directory
   * @param onSuccess Callback function on success returns source url
   * @param onFail Callback function on error returns error object
   */
  delete(src: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Checks if given file/directory
   * @param src File/Directory url
   * @param onSuccess Callback function on success returns string "TRUE" or "FALSE"
   * @param onFail Callback function on error returns error object
   */
  exists(src: String, onSuccess: (exists: "TRUE" | "FALSE") => void, onFail: (err: any) => void): void;
  /**
   * Converts virtual URL to actual url
   * @param src Virtual address returned by other methods
   * @param onSuccess Callback function on success returns actual url
   * @param onFail Callback function on error returns error object
   */
  formatUri(src: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Gets actual url for relative path to src
   * e.g. getPath(src, "../path/to/file.txt") => actual url
   * @param src Directory url
   * @param path Relative file/direcotry path
   * @param onSuccess Callback function on success returns actual url
   * @param onFail Callback function on error returns error object
   */
  getPath(src: String, path: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Requests user for storage permission
   * @param uuid UUID returned from listStorages method
   * @param onSuccess Callback function on success returns url for the storage root
   * @param onFail Callback function on error returns error object
   */
  getStorageAccessPermission(uuid: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Lists all the storages
   * @param onSuccess Callback function on success returns list of storages
   * @param onFail Callback function on error returns error object
   */
  listStorages(onSuccess: (storages: Array<Storage>) => void, onFail: (err: any) => void): void;
  /**
   * Gets list of files/directory in the given directory
   * @param src Directory url
   * @param onSuccess Callback function on success returns list of files/directory
   * @param onFail Callback function on error returns error object
   */
  listDir(src: String, onSuccess: (list: Array<DirListItem>) => void, onFail: (err: any) => void): void;
  /**
   * Move file/directory to given destination
   * @param src Source url
   * @param dest Destination url
   * @param onSuccess Callback function on success returns url of moved file/dir
   * @param onFail Callback function on error returns error object
   */
  move(src: String, dest: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Opens file provider to select file
   * @param onSuccess Callback function on success returns url of selected file
   * @param onFail Callback function on error returns error object
   * @param mimeType MimeType of file to be selected
   */
  openDocumentFile(onSuccess: (url: String) => void, onFail: (err: any) => void, mimeType: String): void;
  /**
   * Opens gallery/photo picker to select an image
   * Returns a temporary URI grant for the selected image.
   * Use read/stats on the returned URI if you need to inspect or preview it.
   * @param onSuccess Callback function on success returns URI of selected image
   * @param onFail Callback function on error returns error object
   * @param mimeType MimeType of file to be selected
   */
  getImage(onSuccess: (url: String) => void, onFail: (err: any) => void, mimeType: String): void;
  /**
   * Renames the given file/directory to given new name
   * @param src Url of file/directory
   * @param newname New name
   * @param onSuccess Callback function on success returns url of renamed file
   * @param onFail Callback function on error returns error object
   */
  rename(src: String, newname: String, onSuccess: (url: String) => void, onFail: (err: any) => void): void;
  /**
   * Writes new content to the given file.
   * @param src file url
   * @param content new file content
   * @param onSuccess Callback function on success returns "OK"
   * @param onFail Callback function on error returns error object
   */
  write(src: String, content: String, onSuccess: (res: "OK") => void, onFail: (err: any) => void): void;
  /**
   * Gets stats of given file
   * @param src file/directory url
   * @param onSuccess Callback function on success returns file/directory stats
   * @param onFail Callback function on error returns error object
   */
  stats(src: String, onSuccess: (stats: Stats) => void, onFail: (err: any) => void): void;
}

interface Storage {
  /**
   * Name of the storage
   */
  name: String;
  /**
   * UUID of the storage
   */
  uuid: String;
}

interface DirListItem {
  name: String;
  mime: String;
  isDirectory: Boolean;
  isFile: Boolean;
  uri: String;
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
```
